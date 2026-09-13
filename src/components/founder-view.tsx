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
// drafts, no drags, no box tool), the panel offers no edit, move, or delete
// control, and the only writes are the founder's own reply and resolve. A
// denied exchange or a session that stopped verifying (rotation, revocation)
// is one generic message with no project data.
//
// The view reads first (D078): the list of marks names each one by its
// comment and element, the panel shows the chosen mark's name, status, and
// thread, and nothing here prints coordinates, versions, or hashes. On a
// phone the list comes first, then the screenshot, then the panel; tapping
// an entry scrolls the screenshot into view with that mark in the middle.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import type { AnnotationView, PinListResponse, PinStatusResponse } from "../lib/annotations";
import { markKindNoun, markLabel, pinsOf, rectanglesOf } from "../lib/canvas/marks";
import { PIN_STATUS_LABELS, pinFeedbackPath } from "../lib/feedback-counts";
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
  // Every live mark on the capture: pins and rectangles (D079) alike.
  const [pinsState, setPinsState] = useState<{
    captureId: string;
    status: "loading" | "ready" | "failed";
    pins: AnnotationView[];
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
  // Resolve / reopen in flight (D075).
  const [statusState, setStatusState] = useState<"idle" | "saving" | "failed">("idle");
  const cameras = useRef(new Map<string, CaptureCameraState>());
  // Each tap on a list entry (D078) bumps this so the canvas centers the
  // chosen mark, and scrolls the screenshot into view on a narrow screen.
  const [revealSignal, setRevealSignal] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);

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
      // Reading the thread marks the pin seen for this founder (D075); the
      // list's unread marker clears locally once the server has recorded it.
      try {
        const seen = await fetch(pinFeedbackPath(id, annotationId, "seen"), {
          method: "POST",
          headers: { [EDITOR_CSRF_HEADER]: readFounderCsrfProof() },
        });
        if (seen.ok) {
          setPinsState((current) =>
            current && current.captureId === id
              ? {
                  ...current,
                  pins: current.pins.map((pin) =>
                    pin.id === annotationId ? { ...pin, unreadReplies: 0 } : pin,
                  ),
                }
              : current,
          );
        }
      } catch {
        // Best effort: the marker stays until the next successful read.
      }
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

  // Resolve or reopen the selected pin as the founder (D075). The returned
  // record replaces the listed pin and the status entry joins the thread;
  // a lost capability is named as such, like a denied reply.
  const setPinStatus = useCallback(
    async (action: "resolve" | "reopen") => {
      if (!captureId || !selectedPinId || statusState === "saving") return;
      setStatusState("saving");
      try {
        const response = await fetch(pinFeedbackPath(captureId, selectedPinId, action), {
          method: "POST",
          headers: { [EDITOR_CSRF_HEADER]: readFounderCsrfProof() },
        });
        if (!response.ok) {
          setStatusState("failed");
          if (response.status === 401 || response.status === 403) setReplyState("denied");
          return;
        }
        const payload = (await response.json()) as PinStatusResponse;
        setPinsState((current) =>
          current && current.captureId === captureId
            ? {
                ...current,
                pins: current.pins.map((pin) =>
                  pin.id === payload.annotation.id ? payload.annotation : pin,
                ),
              }
            : current,
        );
        const entry = payload.entry;
        if (entry) {
          setThreadState((current) =>
            current && current.annotationId === selectedPinId
              ? {
                  ...current,
                  entries: current.entries.some((existing) => existing.id === entry.id)
                    ? current.entries
                    : [...current.entries, entry],
                }
              : current,
          );
        }
        setStatusState("idle");
      } catch {
        setStatusState("failed");
      }
    },
    [captureId, selectedPinId, statusState],
  );

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

  /**
   * A tap on a list entry (D078): select the mark, ask the canvas to center
   * it, and on a narrow screen, where the list sits above the screenshot,
   * scroll the screenshot into view so the reader lands on the picture.
   * Tapping the chosen entry again only clears the selection.
   */
  const chooseFromList = useCallback(
    (pin: AnnotationView) => {
      if (pin.id === selectedPinId) {
        setSelectedPinId(null);
        return;
      }
      setSelectedPinId(pin.id);
      setRevealSignal((value) => value + 1);
      const narrow = window.matchMedia?.("(max-width: 48rem)")?.matches ?? false;
      if (!narrow) return;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
      bodyRef.current?.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "start" });
    },
    [selectedPinId],
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
          Click a mark, or its entry in the list, to read the note and reply.
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
              {/* Every mark on this capture, in number order, above the canvas
                  (D075): the founder's list of what is waiting for them. Each
                  entry is the mark's name (D078: kind, number, comment, and
                  element), its status, and an unread marker. Choosing an
                  entry selects the mark everywhere and brings it into view. */}
              <section className="founder-pins" aria-label="Pins on this capture">
                <h3 className="visually-hidden">Pins on this capture</h3>
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
                  <ol className="founder-pin-list" data-testid="founder-pin-list">
                    {activePins.map((pin) => (
                      <li key={pin.id}>
                        <button
                          type="button"
                          aria-current={pin.id === selectedPinId ? "true" : undefined}
                          data-status={pin.status}
                          onClick={() => chooseFromList(pin)}
                        >
                          {markLabel(pin)}
                          <span className="pin-status">
                            {" "}
                            · {PIN_STATUS_LABELS[pin.status] ?? pin.status}
                          </span>
                          {pin.unreadReplies > 0 ? (
                            <span className="pin-unread"> · {pin.unreadReplies} new</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>
              <div className="workspace-body" ref={bodyRef}>
                <CaptureCanvas
                  key={attempt.id}
                  readOnly
                  captureId={attempt.id}
                  pageUrl={activePage.normalizedUrl}
                  variant={variantLabel(attempt.variant)}
                  attempt={attempt.attempt}
                  width={attempt.documentWidth!}
                  height={attempt.documentHeight!}
                  pins={pinsOf(activePins)}
                  rectangles={rectanglesOf(activePins)}
                  selectedPinId={selectedPinId}
                  onSelectPin={setSelectedPinId}
                  savedCamera={cameras.current.get(attempt.id) ?? null}
                  onCameraChange={handleCameraChange}
                  revealSelected={revealSignal}
                />
                <aside
                  className="workspace-panel"
                  aria-label="Selected pin and replies"
                  data-testid="founder-panel"
                >
                  <h4>Selection</h4>
                  {selectedPin ? (
                    <div className="panel-pin" data-testid="panel-pin">
                      {/* The mark's name (D078), its status, and the thread.
                          No coordinates, no element internals: the name
                          already says what the mark points at. */}
                      <p
                        className="panel-mark-name"
                        data-testid="panel-mark-name"
                        data-kind={selectedPin.kind}
                      >
                        <strong>{markLabel(selectedPin)}</strong>
                      </p>
                      <p
                        className="panel-status"
                        data-testid="panel-status"
                        data-status={selectedPin.status}
                      >
                        Status: {PIN_STATUS_LABELS[selectedPin.status] ?? selectedPin.status}
                      </p>
                      {/* The founder's one lifecycle control (D075): "done" is
                          their statement; the editor can reopen, and so can
                          they. Nothing else about the pin is editable here. */}
                      <p className="panel-actions">
                        <button
                          type="button"
                          disabled={statusState === "saving"}
                          onClick={() =>
                            void setPinStatus(
                              selectedPin.status === "resolved" ? "reopen" : "resolve",
                            )
                          }
                        >
                          {statusState === "saving"
                            ? "Saving…"
                            : selectedPin.status === "resolved"
                              ? `Reopen ${markKindNoun(selectedPin.kind)}`
                              : `Resolve ${markKindNoun(selectedPin.kind)}`}
                        </button>
                      </p>
                      {statusState === "failed" ? (
                        <p role="alert" className="capture-error">
                          That status change could not be saved. Try again.
                        </p>
                      ) : null}
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
