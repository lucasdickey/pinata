"use client";

// The editor working surface at /pins (D069). It carries the durable project
// list and nothing that competes with it: the branded hero, the always-open
// project form, and the static example render moved to the public landing
// and to /pins/new, because on this route they cost a screenful of the space
// the canvas actually needs. What stays is a compact header (home, new
// project, sign out), the workspace, and the hub links.
//
// This component still owns the capture-progress polling loop and the
// capture-dispatch driver, so any pending attempt — including one committed
// by /pins/new a moment ago — is driven to completion on this load. The
// live refresh (D097) that keeps founder replies and status changes current
// runs in the workspace, and calls back here for the hierarchy re-read.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import {
  CAPTURE_DISPATCH_REDRIVE_DELAY_MS,
  nextDispatchBatch,
  pendingDispatchTargets,
  postCaptureDispatch,
} from "../lib/capture-dispatch";
import { captureWorkInProgress, nextCapturePoll } from "../lib/capture-polling";
import { readCsrfProof } from "../lib/csrf";
import { LandingLinks } from "./landing";
import { ProjectWorkspace, type WorkspaceProject } from "./project-workspace";

type ListState =
  | { status: "loading" }
  | { status: "ready"; projects: WorkspaceProject[] }
  | { status: "failed" };

export function EditorHome({ liveRefreshMs }: { liveRefreshMs?: number } = {}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [list, setList] = useState<ListState>({ status: "loading" });
  // Single-flight guard for the failure-state retry: while one retry read is
  // in flight there is no way to start a second, so a transient failure can
  // never multiply reads.
  const [retrying, setRetrying] = useState(false);

  // The last hierarchy answer as text, so the live refresh (D097) can tell a
  // changed hierarchy from an identical one without a deep compare.
  const lastPayload = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) {
        setList({ status: "failed" });
        return;
      }
      const text = await response.text();
      const payload = JSON.parse(text) as { projects: WorkspaceProject[] };
      lastPayload.current = text;
      setList({ status: "ready", projects: payload.projects });
    } catch {
      setList({ status: "failed" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The live refresh's hierarchy read (D097). Unlike `load`, a failure here
  // leaves the list exactly as it was — a network blip in a background tick
  // must never swap the workspace for the failure state — and an answer
  // identical to the last one is dropped, so a quiet tick re-renders nothing.
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) return;
      const text = await response.text();
      if (text === lastPayload.current) return;
      const payload = JSON.parse(text) as { projects: WorkspaceProject[] };
      if (!Array.isArray(payload.projects)) return;
      lastPayload.current = text;
      setList((current) =>
        current.status === "ready" ? { status: "ready", projects: payload.projects } : current,
      );
    } catch {
      // Best effort: the next tick, or the next write, reads again.
    }
  }, []);

  // Capture-progress polling (VAL-CAPTURE-012): while any attempt is pending
  // or capturing, re-read the hierarchy on the published backoff schedule.
  // Polling is read-only — it issues only the hierarchy GET, so it can never
  // create or duplicate an attempt — and it stops as soon as every attempt
  // is terminal or computed stale, or at the published deadline.
  const poll = useRef<{ startedAt: number | null; count: number }>({
    startedAt: null,
    count: 0,
  });
  useEffect(() => {
    if (list.status !== "ready") return;
    const inProgress = list.projects.some((project) =>
      project.pages.some((page) =>
        page.devices.some((device) => captureWorkInProgress(device.attempts)),
      ),
    );
    if (!inProgress) {
      poll.current = { startedAt: null, count: 0 };
      return;
    }
    const now = Date.now();
    if (poll.current.startedAt === null) poll.current = { startedAt: now, count: 0 };
    const startedAt = poll.current.startedAt ?? now;
    const decision = nextCapturePoll({
      inProgress: true,
      elapsedMs: now - startedAt,
      pollCount: poll.current.count,
    });
    if (decision.action === "stop") return;
    const timer = setTimeout(() => {
      poll.current.count += 1;
      void load();
    }, decision.delayMs);
    return () => clearTimeout(timer);
  }, [list, load]);

  // Capture-dispatch driver, kept as the fallback (D076): the server now
  // continues capture work itself after project creation and retry, but any
  // committed pending attempt this tab can see is still dispatched from here
  // on any load or reload, so a continuation that never ran leaves nothing
  // stranded. Dispatches go through the one scoped route, at most
  // MAX_ACTIVE_CAPTURES in flight; a quota-exceeded answer defers the attempt
  // for one re-drive delay and the polling loop's next read re-drives it once
  // a slot has had time to free. When the server and this tab try the same
  // attempt, the fenced claim answers one of them 409 and the driver treats
  // that as a conflict: one re-read, one deferral, no retry storm.
  const dispatchInFlight = useRef(new Set<string>());
  const dispatchDeferred = useRef(new Map<string, number>());
  useEffect(() => {
    if (list.status !== "ready") return;
    const batch = nextDispatchBatch(
      pendingDispatchTargets(list.projects),
      dispatchInFlight.current,
      dispatchDeferred.current,
      Date.now(),
    );
    for (const captureId of batch) {
      dispatchInFlight.current.add(captureId);
      void (async () => {
        const outcome = await postCaptureDispatch(captureId);
        dispatchInFlight.current.delete(captureId);
        if (outcome === "settled" || outcome === "conflict") {
          // The attempt resolved (or another client owns it now): re-read so
          // the workspace surfaces the catalog outcome and the next pending
          // attempt gets the freed slot. A conflict is deferred too: if the
          // re-read somehow still shows the row pending, the driver waits out
          // one re-drive delay instead of storming the fence.
          if (outcome === "conflict") {
            dispatchDeferred.current.set(
              captureId,
              Date.now() + CAPTURE_DISPATCH_REDRIVE_DELAY_MS,
            );
          } else {
            dispatchDeferred.current.delete(captureId);
          }
          void load();
          return;
        }
        // quota / transient: the attempt stays pending. Defer it; the polling
        // loop's next read re-drives it — never a tight retry loop.
        dispatchDeferred.current.set(
          captureId,
          Date.now() + CAPTURE_DISPATCH_REDRIVE_DELAY_MS,
        );
      })();
    }
  }, [list, load]);

  async function logout() {
    if (pending) return;
    setPending(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { [EDITOR_CSRF_HEADER]: readCsrfProof() },
      });
    } finally {
      // /pins is editor-only, so signing out has to leave the route, not
      // just re-render it (D069). Navigate explicitly rather than relying on
      // a refresh to pick up the server-side redirect.
      router.replace("/");
      router.refresh();
    }
  }

  async function retryList() {
    if (retrying) return;
    setRetrying(true);
    try {
      await load();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <main className="pins-main">
      {/* One compact bar instead of the hero: identity, the route to the
          project form, and sign out. Everything else on this screen belongs
          to the workspace. */}
      <header className="pins-header">
        <Link href="/" className="wordmark">
          pinata
        </Link>
        <p className="pins-identity">Signed in as Lucas (editor).</p>
        <nav className="pins-actions" aria-label="Editor actions">
          <Link href="/pins/new" className="pins-new-link">
            New project
          </Link>
          <button type="button" onClick={logout} disabled={pending}>
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </nav>
      </header>

      {/* The list is one explicit state machine (VAL-AUTH-008/009): loading,
          empty, populated, and failure are mutually exclusive and announced,
          and a failure keeps logout and the open form intact while offering
          exactly one single-flight retry. */}
      {/* The region keeps its accessible name without spending a heading on
          it: once projects load, the rail's own disclosure is the heading
          for the list (see ProjectWorkspace). */}
      <section aria-label="Projects" aria-busy={list.status === "loading"}>
        {list.status === "loading" ? <p role="status">Loading projects…</p> : null}
        {list.status === "failed" ? (
          <div className="list-failure">
            <p role="alert">Projects could not be loaded. Your work is untouched.</p>
            <button type="button" onClick={() => void retryList()} disabled={retrying}>
              {retrying ? "Retrying…" : "Try again"}
            </button>
          </div>
        ) : null}
        {list.status === "ready" && list.projects.length === 0 ? (
          <p className="list-empty">
            No projects yet. <Link href="/pins/new">Create your first project</Link> to
            capture a page.
          </p>
        ) : null}
        {list.status === "ready" && list.projects.length > 0 ? (
          <ProjectWorkspace
            projects={list.projects}
            onChanged={() => void load()}
            onRefresh={refresh}
            liveRefreshMs={liveRefreshMs}
          />
        ) : null}
      </section>

      <LandingLinks />
    </main>
  );
}
