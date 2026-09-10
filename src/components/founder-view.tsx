"use client";

// The founder's read/reply-only project view at /f/[publicId]
// (REQUIREMENTS 6 and 7, ARCHITECTURE "Founder").
//
// The capability arrives in the URL fragment. On mount the view reads it
// once, scrubs the fragment from the address bar before anything else, and
// exchanges it through one same-origin POST for the HttpOnly founder
// session; a return visit without a fragment simply reads with the cookie
// it already holds. Every read after that goes through founder-authorized
// routes: the project hierarchy, the per-capture pin list, the private
// asset, and the per-pin thread.
//
// There is no editing surface here at all: the canvas mounts read-only (no
// Place pin mode, no drafts, no drags), the panel offers no edit, move, or
// delete control, and the only write is the founder's own reply. A denied
// exchange or a session that stopped verifying (rotation, revocation) is one
// generic message with no project data.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import type { PinAnnotationView, PinListResponse } from "../lib/annotations";
import { readFounderCsrfProof } from "../lib/founder-csrf";
import type { ThreadAppendResponse, ThreadEntryView, ThreadListResponse } from "../lib/threads";
import { CaptureCanvas, type CaptureCameraState } from "./capture-canvas";
import { variantLabel } from "./capture-panel";
import type { AttemptView, WorkspaceProject } from "./project-workspace";
import { ThreadView, type ReplySendState, type ThreadStatus } from "./thread-view";

type Phase =
  | { status: "exchanging" }
  | { status: "loading" }
  | { status: "ready"; project: WorkspaceProject }
  | { status: "denied" }
  | { status: "failed" };

interface Selection {
  pageId: string;
  variant: string;
}

/** The founder sees only captures that are ready to read. */
function readyAttempt(project: WorkspaceProject, selection: Selection | null): AttemptView | null {
  if (!selection) return null;
  const page = project.pages.find((candidate) => candidate.id === selection.pageId);
  const device = page?.devices.find((candidate) => candidate.variant === selection.variant);
  if (!device || !device.selectedCaptureId) return null;
  const attempt = device.attempts.find((candidate) => candidate.id === device.selectedCaptureId);
  return attempt && attempt.state === "ready" && attempt.documentWidth && attempt.documentHeight
    ? attempt
    : null;
}

/** The first readable plane, in submitted page order then Desktop, Mobile. */
function firstReadable(project: WorkspaceProject): Selection | null {
  for (const page of project.pages) {
    for (const device of page.devices) {
      if (device.usable) return { pageId: page.id, variant: device.variant };
    }
  }
  return null;
}

export function FounderView({ publicId }: { publicId: string }) {
  const [phase, setPhase] = useState<Phase>({ status: "exchanging" });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pinsState, setPinsState] = useState<{
    captureId: string;
    status: "loading" | "ready" | "failed";
    pins: PinAnnotationView[];
  } | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [threadState, setThreadState] = useState<{
    annotationId: string;
    status: ThreadStatus;
    entries: ThreadEntryView[];
  } | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyKey, setReplyKey] = useState<string | null>(null);
  const [replyState, setReplyState] = useState<ReplySendState>("idle");
  const cameras = useRef(new Map<string, CaptureCameraState>());

  const loadProject = useCallback(async () => {
    setPhase({ status: "loading" });
    try {
      const response = await fetch(`/api/founder/${encodeURIComponent(publicId)}`, {
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 404) {
        setPhase({ status: "denied" });
        return;
      }
      if (!response.ok) {
        setPhase({ status: "failed" });
        return;
      }
      const payload = (await response.json()) as { project: WorkspaceProject };
      setPhase({ status: "ready", project: payload.project });
      setSelection((current) => current ?? firstReadable(payload.project));
    } catch {
      setPhase({ status: "failed" });
    }
  }, [publicId]);

  // The one-time exchange. Guarded so a StrictMode double-effect cannot
  // read an already-scrubbed fragment and race the first exchange.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const run = async () => {
      const token = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      if (token) {
        // Scrub first: the capability must not linger in the address bar,
        // history, or any later referrer.
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
        try {
          const response = await fetch(
            `/api/founder/${encodeURIComponent(publicId)}/session`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ token }),
            },
          );
          if (!response.ok) {
            setPhase({ status: "denied" });
            return;
          }
        } catch {
          setPhase({ status: "failed" });
          return;
        }
      }
      await loadProject();
    };
    void run();
  }, [publicId, loadProject]);

  const project = phase.status === "ready" ? phase.project : null;
  const attempt = project ? readyAttempt(project, selection) : null;
  const activePage = project?.pages.find((page) => page.id === selection?.pageId) ?? null;
  const captureId = attempt?.id ?? null;

  const pinsRequestRef = useRef<string | null>(null);
  const loadPins = useCallback(async (id: string) => {
    pinsRequestRef.current = id;
    setPinsState({ captureId: id, status: "loading", pins: [] });
    try {
      const response = await fetch(`/api/captures/${encodeURIComponent(id)}/annotations`, {
        cache: "no-store",
      });
      if (pinsRequestRef.current !== id) return;
      if (!response.ok) {
        setPinsState({ captureId: id, status: "failed", pins: [] });
        return;
      }
      const payload = (await response.json()) as PinListResponse;
      if (pinsRequestRef.current !== id) return;
      setPinsState({
        captureId: id,
        status: "ready",
        pins: Array.isArray(payload.annotations) ? payload.annotations : [],
      });
    } catch {
      if (pinsRequestRef.current !== id) return;
      setPinsState({ captureId: id, status: "failed", pins: [] });
    }
  }, []);

  useEffect(() => {
    setSelectedPinId(null);
    if (captureId) {
      void loadPins(captureId);
    } else {
      pinsRequestRef.current = null;
      setPinsState(null);
    }
  }, [captureId, loadPins]);

  const threadRequestRef = useRef<string | null>(null);
  const loadThread = useCallback(async (id: string, annotationId: string) => {
    threadRequestRef.current = annotationId;
    setThreadState({ annotationId, status: "loading", entries: [] });
    try {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(id)}/annotations/${encodeURIComponent(annotationId)}/thread`,
        { cache: "no-store" },
      );
      if (threadRequestRef.current !== annotationId) return;
      if (!response.ok) {
        setThreadState({ annotationId, status: "failed", entries: [] });
        return;
      }
      const payload = (await response.json()) as ThreadListResponse;
      if (threadRequestRef.current !== annotationId) return;
      setThreadState({
        annotationId,
        status: "ready",
        entries: Array.isArray(payload.entries) ? payload.entries : [],
      });
    } catch {
      if (threadRequestRef.current !== annotationId) return;
      setThreadState({ annotationId, status: "failed", entries: [] });
    }
  }, []);

  useEffect(() => {
    setReplyBody("");
    setReplyKey(null);
    setReplyState("idle");
    if (captureId && selectedPinId) {
      void loadThread(captureId, selectedPinId);
    } else {
      threadRequestRef.current = null;
      setThreadState(null);
    }
  }, [captureId, selectedPinId, loadThread]);

  const sendReply = useCallback(async () => {
    if (!captureId || !selectedPinId || replyState === "sending") return;
    if (replyBody.trim().length === 0) return;
    const key = replyKey ?? crypto.randomUUID();
    setReplyKey(key);
    setReplyState("sending");
    try {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(captureId)}/annotations/${encodeURIComponent(selectedPinId)}/thread`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [EDITOR_CSRF_HEADER]: readFounderCsrfProof(),
          },
          body: JSON.stringify({ body: replyBody, idempotencyKey: key }),
        },
      );
      if (!response.ok) {
        // A lost capability (rotation, revocation) is named as such; a quota
        // answer says to wait; anything else keeps the text for a retry.
        setReplyState(
          response.status === 401 || response.status === 403
            ? "denied"
            : response.status === 429
              ? "throttled"
              : "failed",
        );
        return;
      }
      const payload = (await response.json()) as ThreadAppendResponse;
      setThreadState((current) =>
        current && current.annotationId === selectedPinId
          ? {
              ...current,
              status: "ready",
              entries: current.entries.some((entry) => entry.id === payload.entry.id)
                ? current.entries
                : [...current.entries, payload.entry],
            }
          : current,
      );
      setReplyBody("");
      setReplyKey(null);
      setReplyState("idle");
    } catch {
      setReplyState("failed");
    }
  }, [captureId, selectedPinId, replyState, replyBody, replyKey]);

  const activePins = useMemo(
    () =>
      pinsState && pinsState.captureId === captureId && pinsState.status === "ready"
        ? pinsState.pins
        : [],
    [pinsState, captureId],
  );
  const selectedPin = activePins.find((pin) => pin.id === selectedPinId) ?? null;
  const handleCameraChange = useCallback(
    (state: CaptureCameraState) => {
      if (captureId) cameras.current.set(captureId, state);
    },
    [captureId],
  );

  if (phase.status === "exchanging" || phase.status === "loading") {
    return (
      <main className="founder-shell">
        <p role="status">Opening the review…</p>
      </main>
    );
  }
  if (phase.status === "denied") {
    return (
      <main className="founder-shell">
        <h1>This link is not valid</h1>
        <p data-testid="founder-denied">
          The review link may have been replaced or turned off. Ask Lucas for a fresh link.
        </p>
      </main>
    );
  }
  if (phase.status === "failed" || !project) {
    return (
      <main className="founder-shell">
        <h1>Something went wrong</h1>
        <p role="alert">The review could not be opened right now. Reload to try again.</p>
      </main>
    );
  }

  return (
    <main className="founder-shell" data-testid="founder-view">
      <header className="founder-header">
        <p className="founder-badge">Viewing as founder</p>
        <h1>{project.title}</h1>
        <p className="founder-root">{project.rootUrl}</p>
        <p className="workspace-hint">
          This is a static screenshot of each page with Lucas&apos;s pins on it. Drag to pan,
          scroll or pinch to zoom, or use the camera buttons. Click a numbered pin, or its entry
          in the Pins list, to read the comment and reply. Pins cannot be added, moved, or edited
          from this view, and replies are permanent.
        </p>
      </header>

      <div className="workspace">
        <nav className="workspace-tree" aria-label="Pages and devices">
          <ol>
            {project.pages.map((page) => (
              <li key={page.id}>
                <span className="page-url">{page.normalizedUrl}</span>
                <ul className="page-devices">
                  {page.devices
                    .filter((device) => device.usable)
                    .map((device) => {
                      const isActive =
                        selection?.pageId === page.id && selection.variant === device.variant;
                      return (
                        <li key={device.variant}>
                          <button
                            type="button"
                            aria-label={`${variantLabel(device.variant)} capture of ${page.normalizedUrl}`}
                            aria-current={isActive ? "true" : undefined}
                            onClick={() => setSelection({ pageId: page.id, variant: device.variant })}
                          >
                            {variantLabel(device.variant)}
                          </button>
                        </li>
                      );
                    })}
                  {page.devices.every((device) => !device.usable) ? (
                    <li className="device-status">No capture to show yet</li>
                  ) : null}
                </ul>
              </li>
            ))}
          </ol>
        </nav>

        <section className="workspace-detail" aria-label="Selected capture">
          {attempt && activePage ? (
            <>
              <h2>
                {variantLabel(attempt.variant)} — {activePage.normalizedUrl}
              </h2>
              <div className="workspace-body">
                <CaptureCanvas
                  key={attempt.id}
                  readOnly
                  captureId={attempt.id}
                  pageUrl={activePage.normalizedUrl}
                  variant={variantLabel(attempt.variant)}
                  attempt={attempt.attempt}
                  width={attempt.documentWidth!}
                  height={attempt.documentHeight!}
                  pins={activePins}
                  selectedPinId={selectedPinId}
                  onSelectPin={setSelectedPinId}
                  savedCamera={cameras.current.get(attempt.id) ?? null}
                  onCameraChange={handleCameraChange}
                />
                <aside
                  className="workspace-panel"
                  aria-label="Selected pin and replies"
                  data-testid="founder-panel"
                >
                  <h4>Selection</h4>
                  {selectedPin ? (
                    <div className="panel-pin" data-testid="panel-pin">
                      <p>
                        <strong>Pin {selectedPin.number}</strong> at natural pixel (
                        {Math.round(selectedPin.tip.x)}, {Math.round(selectedPin.tip.y)})
                      </p>
                      <p className="panel-snapshot" data-testid="panel-snapshot">
                        {selectedPin.elementSnapshot
                          ? `Element: ${selectedPin.elementSnapshot.kind} <${
                              selectedPin.elementSnapshot.tag || "element"
                            }> — “${(
                              selectedPin.elementSnapshot.text ||
                              selectedPin.elementSnapshot.accessibleName ||
                              selectedPin.elementSnapshot.tag
                            ).slice(0, 80)}”`
                          : "Element: No element"}
                      </p>
                      {threadState && threadState.annotationId === selectedPin.id ? (
                        <ThreadView
                          originalBody={selectedPin.body}
                          status={threadState.status}
                          entries={threadState.entries}
                          replyBody={replyBody}
                          onReplyBodyChange={setReplyBody}
                          onSendReply={() => void sendReply()}
                          sendState={replyState}
                          composerLabel="Reply as founder"
                          sendLabel="Send reply"
                        />
                      ) : null}
                    </div>
                  ) : (
                    <p className="panel-empty">Nothing selected.</p>
                  )}

                  <h4>Pins on this capture</h4>
                  {pinsState?.status === "loading" ? (
                    <p className="panel-note">Loading pins…</p>
                  ) : null}
                  {pinsState?.status === "failed" ? (
                    <p className="panel-note">Pins could not be loaded. Reload to try again.</p>
                  ) : null}
                  {pinsState?.status === "ready" && activePins.length === 0 ? (
                    <p className="panel-note">No pins on this capture yet.</p>
                  ) : null}
                  {activePins.length > 0 ? (
                    <ol className="pin-list" aria-label="Saved pins">
                      {activePins.map((pin) => (
                        <li key={pin.id}>
                          <button
                            type="button"
                            aria-current={pin.id === selectedPinId ? "true" : undefined}
                            onClick={() =>
                              setSelectedPinId(pin.id === selectedPinId ? null : pin.id)
                            }
                          >
                            Pin {pin.number} — at ({Math.round(pin.tip.x)},{" "}
                            {Math.round(pin.tip.y)})
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </aside>
              </div>
            </>
          ) : (
            <div className="capture-stage" data-testid="capture-stage">
              <p>No capture to show yet.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
