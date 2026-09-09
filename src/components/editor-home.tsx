"use client";

// The authenticated editor shell: the project list read from the durable
// store, the project entry form, and the keyboard-operable logout control.
// The canvas workspace lands with later milestone features.

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
import { ProjectCreateForm } from "./project-create-form";
import { ProjectWorkspace, type WorkspaceProject } from "./project-workspace";

type ListState =
  | { status: "loading" }
  | { status: "ready"; projects: WorkspaceProject[] }
  | { status: "failed" };

export function EditorHome() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [list, setList] = useState<ListState>({ status: "loading" });
  // Single-flight guard for the failure-state retry: while one retry read is
  // in flight there is no way to start a second, so a transient failure can
  // never multiply reads.
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) {
        setList({ status: "failed" });
        return;
      }
      const payload = (await response.json()) as { projects: WorkspaceProject[] };
      setList({ status: "ready", projects: payload.projects });
    } catch {
      setList({ status: "failed" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  // Capture-dispatch driver: the server deliberately schedules nothing, so
  // every committed pending attempt is dispatched from here — after a project
  // is created, after a retry, and on any load or reload that finds pending
  // work, so navigation can never orphan a pending row. Dispatches go through
  // the one scoped route, at most MAX_ACTIVE_CAPTURES in flight; a
  // quota-exceeded answer defers the attempt for one re-drive delay and the
  // polling loop's next read re-drives it once a slot has had time to free.
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
      router.refresh();
    }
  }

  function onCreated() {
    setCreating(false);
    // The transaction already committed; read the hierarchy back from the
    // server rather than trusting the response as local state.
    void load();
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
    <main className="home-main">
      <h1>pinata</h1>
      <p>Signed in as Lucas (editor).</p>

      {/* The list is one explicit state machine (VAL-AUTH-008/009): loading,
          empty, populated, and failure are mutually exclusive and announced,
          and a failure keeps logout and any open form intact while offering
          exactly one single-flight retry. The create control lives inside
          this region so the empty list itself offers the one primary action. */}
      <section aria-labelledby="projects-heading" aria-busy={list.status === "loading"}>
        <h2 id="projects-heading">Projects</h2>
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
            No projects yet. Create your first project to capture a page.
          </p>
        ) : null}
        {list.status === "ready" && list.projects.length > 0 ? (
          <ProjectWorkspace projects={list.projects} onChanged={() => void load()} />
        ) : null}

        {creating ? (
          <ProjectCreateForm onCreated={onCreated} onCancel={() => setCreating(false)} />
        ) : (
          <button type="button" onClick={() => setCreating(true)}>
            New project
          </button>
        )}
      </section>

      <p className="home-nav">
        <Link href="/reqs">Requirements, architecture, milestones, decisions, and evals</Link>
      </p>
      <button type="button" onClick={logout} disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </main>
  );
}
