"use client";

// The project → page → device navigation and capture-status panel
// (VAL-PROJECT-003, VAL-PROJECT-005).
//
// Every page shown here was explicitly submitted and is listed only under the
// project that owns it, in submitted order. Each page exposes exactly Desktop
// and Mobile, exactly one of which is active at a time, and the panel shows
// the selected version of that one capture. A failing device never removes a
// sibling that succeeded: the sibling stays listed, usable, and in order.
//
// The screenshot stage is deliberately inert — it renders a static capture,
// never live source markup, so there is no link, iframe, or handler here that
// could navigate to the captured site.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAPTURE_OUTCOMES, FEEDBACK_BODY_MAX_CHARS } from "../lib/boundaries";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";
import type { PinAnnotationView, PinListResponse, PinMutationResponse } from "../lib/annotations";
import type { NaturalPoint } from "../lib/canvas/camera";
import { CaptureCanvas, type CaptureCameraState } from "./capture-canvas";

export interface AttemptView {
  id: string;
  variant: string;
  attempt: number;
  state: "pending" | "capturing" | "stale" | "ready" | "failed";
  errorCode: string | null;
  imageHash: string | null;
  /** Natural screenshot dimensions; null until the capture is ready. */
  documentWidth: number | null;
  documentHeight: number | null;
}

export interface DeviceView {
  variant: string;
  attempts: AttemptView[];
  latest: AttemptView | null;
  selectedCaptureId: string | null;
  selectedAttempt: number | null;
  usable: boolean;
  retryable: boolean;
}

export interface WorkspacePage {
  id: string;
  normalizedUrl: string;
  sortIndex: number;
  devices: DeviceView[];
}

export interface WorkspaceProject {
  projectId: string;
  publicId: string;
  title: string;
  rootUrl: string;
  pages: WorkspacePage[];
  counts: { pages: number; attempts: number; ready: number; failed: number; inProgress: number };
}

interface Selection {
  pageId: string;
  variant: string;
  /** Explicitly chosen version, or null to follow the server default. */
  captureId: string | null;
}

const VARIANT_LABELS: Record<string, string> = { desktop: "Desktop", mobile: "Mobile" };

const STATE_LABELS: Record<AttemptView["state"], string> = {
  pending: "Queued",
  capturing: "Capturing",
  stale: "Stopped responding",
  ready: "Ready",
  failed: "Failed",
};

const outcomeMessages = new Map(
  CAPTURE_OUTCOMES.map((outcome) => [outcome.code, outcome.publicMessage] as const),
);

function variantLabel(variant: string): string {
  return VARIANT_LABELS[variant] ?? variant;
}

/** What the device row shows: the usable capture wins over a later failure. */
function deviceStatus(device: DeviceView): string {
  if (device.usable && device.latest?.state !== "ready") {
    return `Ready (v${device.selectedAttempt}) · newest ${STATE_LABELS[
      device.latest?.state ?? "pending"
    ].toLowerCase()}`;
  }
  return device.latest ? STATE_LABELS[device.latest.state] : "Not captured";
}

/**
 * The screen-fixed selection/comment/metadata panel (VAL-CANVAS-002,
 * VAL-PIN-001, VAL-PIN-003). It lives outside the transformed canvas, so
 * panning and zooming never move it. Exactly one canvas object can be
 * selected at a time: an open draft shows the comment editor (Save persists
 * the pin with its server-assigned number, Cancel discards it), a saved pin
 * shows its number and comment, and the pins list keeps every mark
 * reachable by keyboard. The capture identity facts follow the active
 * plane.
 */
function CapturePanel({
  attempt,
  pageUrl,
  variant,
  ready,
  draftTip,
  draftBody,
  onDraftBodyChange,
  onSaveDraft,
  onCancelDraft,
  saveState,
  pinsStatus,
  pins,
  selectedPinId,
  onSelectPin,
  moveError,
}: {
  attempt: AttemptView | null;
  pageUrl: string;
  variant: string;
  /** Whether the active capture is annotatable (ready). */
  ready: boolean;
  /** The active plane's transient draft pin tip, in natural pixels. */
  draftTip: NaturalPoint | null;
  draftBody: string;
  onDraftBodyChange: (value: string) => void;
  onSaveDraft: () => void;
  onCancelDraft: () => void;
  saveState: "idle" | "saving" | "failed";
  pinsStatus: "loading" | "ready" | "failed" | null;
  pins: PinAnnotationView[];
  selectedPinId: string | null;
  onSelectPin: (annotationId: string | null) => void;
  moveError: string | null;
}) {
  const selectedPin = pins.find((pin) => pin.id === selectedPinId) ?? null;
  return (
    <aside
      className="workspace-panel"
      aria-label="Selection and capture details"
      data-testid="capture-panel"
    >
      <h4>Selection</h4>
      {draftTip ? (
        <div className="panel-draft" data-testid="panel-draft">
          <p className="panel-empty">
            Draft pin at natural pixel ({Math.round(draftTip.x)}, {Math.round(draftTip.y)}) — not
            saved yet.
          </p>
          <label className="panel-field">
            Comment
            <textarea
              value={draftBody}
              onChange={(event) => onDraftBodyChange(event.target.value)}
              maxLength={FEEDBACK_BODY_MAX_CHARS}
              rows={3}
              placeholder="What should change here?"
            />
          </label>
          <p className="panel-actions">
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={saveState === "saving" || draftBody.trim().length === 0}
            >
              {saveState === "saving" ? "Saving…" : "Save pin"}
            </button>
            <button type="button" onClick={onCancelDraft} disabled={saveState === "saving"}>
              Cancel
            </button>
          </p>
          {saveState === "failed" ? (
            <p role="alert" className="capture-error">
              That pin could not be saved. Your draft and comment are still here — try again.
            </p>
          ) : null}
        </div>
      ) : selectedPin ? (
        <div className="panel-pin" data-testid="panel-pin">
          <p>
            <strong>Pin {selectedPin.number}</strong> at natural pixel (
            {Math.round(selectedPin.tip.x)}, {Math.round(selectedPin.tip.y)})
          </p>
          <p className="panel-pin-body">{selectedPin.body}</p>
          <p className="panel-note">
            Drag the pin on the screenshot to move it. Editing a saved comment arrives in the
            next update.
          </p>
        </div>
      ) : (
        <p className="panel-empty">Nothing selected.</p>
      )}
      {moveError ? (
        <p role="alert" className="capture-error">
          {moveError}
        </p>
      ) : null}

      {ready ? (
        <>
          <h4>Pins on this capture</h4>
          {pinsStatus === "loading" ? <p className="panel-note">Loading pins…</p> : null}
          {pinsStatus === "failed" ? (
            <p className="panel-note">
              Pins could not be loaded. Switch to another capture and back to retry.
            </p>
          ) : null}
          {pinsStatus === "ready" && pins.length === 0 ? (
            <p className="panel-note">
              No pins yet. Choose Place pin above the screenshot, then click or tap the page to
              drop the first one.
            </p>
          ) : null}
          {pins.length > 0 ? (
            <ol className="pin-list" aria-label="Saved pins">
              {pins.map((pin) => (
                <li key={pin.id}>
                  <button
                    type="button"
                    aria-current={pin.id === selectedPinId ? "true" : undefined}
                    onClick={() => onSelectPin(pin.id === selectedPinId ? null : pin.id)}
                  >
                    Pin {pin.number} — at ({Math.round(pin.tip.x)}, {Math.round(pin.tip.y)})
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : null}

      <h4>Capture</h4>
      <dl className="panel-facts">
        <dt>Page</dt>
        <dd className="panel-url">{pageUrl}</dd>
        <dt>Device</dt>
        <dd>{variantLabel(variant)}</dd>
        <dt>Version</dt>
        <dd>{attempt ? `v${attempt.attempt}` : "—"}</dd>
        <dt>State</dt>
        <dd>{attempt ? STATE_LABELS[attempt.state] : "Not captured"}</dd>
        {attempt?.state === "ready" &&
        attempt.documentWidth !== null &&
        attempt.documentHeight !== null ? (
          <>
            <dt>Natural size</dt>
            <dd>
              {attempt.documentWidth} × {attempt.documentHeight} px
            </dd>
          </>
        ) : null}
        {attempt?.imageHash ? (
          <>
            <dt>Image hash</dt>
            <dd>
              <code>{attempt.imageHash.slice(0, 12)}…</code>
            </dd>
          </>
        ) : null}
      </dl>
    </aside>
  );
}

function findDevice(project: WorkspaceProject | undefined, selection: Selection | null) {
  if (!project || !selection) return null;
  const page = project.pages.find((candidate) => candidate.id === selection.pageId);
  if (!page) return null;
  const device = page.devices.find((candidate) => candidate.variant === selection.variant);
  if (!device) return null;
  return { page, device };
}

export function ProjectWorkspace({
  projects,
  onChanged,
}: {
  projects: WorkspaceProject[];
  onChanged: () => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Per-capture session camera memory: each plane restores its own camera
  // when revisited, and no camera is ever shared between planes or written
  // anywhere. Reload clears it (in-memory only).
  const cameras = useRef(new Map<string, CaptureCameraState>());
  // The active plane's transient draft tip, mirrored here only so the
  // screen-fixed panel can announce it. The canvas remains the source of
  // truth and clears it on switch via the keyed remount.
  const [draftTip, setDraftTip] = useState<NaturalPoint | null>(null);
  // One idempotency key per draft intent: generated when the draft appears,
  // held across safe retries of the same save, and released when the draft
  // resolves (saved, cancelled, or escaped).
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "failed">("idle");
  // Incremented to make the canvas drop its unsaved draft (after a save or
  // a Cancel); the canvas reports the cleared draft back through
  // onDraftChange.
  const [draftResetSignal, setDraftResetSignal] = useState(0);
  // This plane's persisted pins, loaded per selection and scoped strictly to
  // the capture id they were fetched for — another plane's pins can never
  // render here.
  const [pinsState, setPinsState] = useState<{
    captureId: string;
    status: "loading" | "ready" | "failed";
    pins: PinAnnotationView[];
  } | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  // One idempotency key per retry intent: it is refreshed only after the
  // server has accepted or conflicted, so a double click cannot schedule two.
  const retryKeys = useRef(new Map<string, string>());

  const fallback = useMemo<Selection | null>(() => {
    const page = projects[0]?.pages[0];
    const variant = page?.devices[0]?.variant;
    return page && variant ? { pageId: page.id, variant, captureId: null } : null;
  }, [projects]);

  const active = useMemo(() => {
    const chosen = selection ?? fallback;
    const owner = projects.find((project) =>
      project.pages.some((page) => page.id === chosen?.pageId),
    );
    const found = findDevice(owner, chosen);
    return found && chosen ? { ...found, project: owner!, selection: chosen } : null;
  }, [projects, selection, fallback]);

  const retry = useCallback(
    async (pageId: string, variant: string) => {
      if (retrying) return;
      const target = `${pageId}:${variant}`;
      const key = retryKeys.current.get(target) ?? crypto.randomUUID();
      retryKeys.current.set(target, key);
      setRetrying(true);
      setRetryError(null);
      try {
        const response = await fetch(`/api/pages/${encodeURIComponent(pageId)}/captures`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [EDITOR_CSRF_HEADER]: readCsrfProof(),
          },
          body: JSON.stringify({ variant, idempotencyKey: key }),
        });
        if (response.ok || response.status === 409) retryKeys.current.delete(target);
        if (!response.ok) {
          setRetryError("That capture could not be retried. Reload and try again.");
          return;
        }
        // The attempt is committed; re-read the hierarchy rather than
        // patching local state.
        setSelection((current) => (current ? { ...current, captureId: null } : current));
        onChanged();
      } catch {
        setRetryError("That capture could not be retried. Reload and try again.");
      } finally {
        setRetrying(false);
      }
    },
    [onChanged, retrying],
  );

  if (projects.length === 0) return null;

  // The shown attempt is the explicit selection or the server default; when
  // a device has no ready capture at all, its latest attempt still names the
  // unavailable state (failed/stale/queued) rather than a bare "not
  // captured".
  const selectedAttempt =
    (active?.device.attempts.find(
      (attempt) => attempt.id === (active.selection.captureId ?? active.device.selectedCaptureId),
    ) ??
      active?.device.latest) ||
    null;

  // A draft belongs to exactly one plane: switching page, device, or version
  // drops the panel's mirror (the canvas drops its own on remount), along
  // with the pin selection and any move error.
  const selectedCaptureId = selectedAttempt?.id ?? null;
  const selectedReady =
    selectedAttempt?.state === "ready" &&
    selectedAttempt.documentWidth !== null &&
    selectedAttempt.documentHeight !== null
      ? selectedAttempt
      : null;

  const loadPins = useCallback(async (captureId: string) => {
    setPinsState({ captureId, status: "loading", pins: [] });
    try {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(captureId)}/annotations`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setPinsState({ captureId, status: "failed", pins: [] });
        return;
      }
      const payload = (await response.json()) as PinListResponse;
      setPinsState({
        captureId,
        status: "ready",
        pins: Array.isArray(payload.annotations) ? payload.annotations : [],
      });
    } catch {
      setPinsState({ captureId, status: "failed", pins: [] });
    }
  }, []);

  useEffect(() => {
    setDraftTip(null);
    setSelectedPinId(null);
    setMoveError(null);
    setSaveState("idle");
    if (selectedReady) {
      void loadPins(selectedReady.id);
    } else {
      setPinsState(null);
    }
  }, [selectedCaptureId, selectedReady, loadPins]);

  // The draft's idempotency key lives exactly as long as the draft: one key
  // per placement intent, so a retried save replays and a double submit can
  // never create two pins. Resolving the draft releases the key.
  useEffect(() => {
    if (draftTip) {
      setDraftKey((current) => current ?? crypto.randomUUID());
    } else {
      setDraftKey(null);
      setDraftBody("");
      setSaveState("idle");
    }
  }, [draftTip]);

  // The pins the canvas may render: only the ones fetched for the capture
  // that is actually selected, never a stale or sibling plane's.
  const activePins =
    pinsState && pinsState.captureId === selectedCaptureId && pinsState.status === "ready"
      ? pinsState.pins
      : [];

  // Stable canvas callbacks: the canvas's resize-follow effect keys off
  // these identities, so inline arrows would re-create its observer on
  // every unrelated workspace re-render (a pins load, say) and re-apply
  // the camera over a restored plane.
  const selectedReadyId = selectedReady?.id ?? null;
  const handleCameraChange = useCallback(
    (state: CaptureCameraState) => {
      if (selectedReadyId) cameras.current.set(selectedReadyId, state);
    },
    [selectedReadyId],
  );

  const saveDraft = useCallback(async () => {
    if (!draftTip || !selectedReady || !draftKey || saveState === "saving") return;
    setSaveState("saving");
    setMoveError(null);
    try {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(selectedReady.id)}/annotations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [EDITOR_CSRF_HEADER]: readCsrfProof(),
          },
          body: JSON.stringify({ tip: draftTip, body: draftBody, idempotencyKey: draftKey }),
        },
      );
      if (!response.ok) {
        // Recoverable: the draft, its comment, and its key survive so a
        // retry replays the same intent instead of duplicating it.
        setSaveState("failed");
        return;
      }
      // Saved: the canvas drops the draft (reporting null back), and the
      // authoritative list is re-read rather than patched locally.
      setDraftResetSignal((value) => value + 1);
      await loadPins(selectedReady.id);
    } catch {
      setSaveState("failed");
    }
  }, [draftTip, selectedReady, draftKey, draftBody, saveState, loadPins]);

  const cancelDraft = useCallback(() => {
    // Same mechanism as a successful save: the canvas drops the draft and
    // reports null, which releases the body and key. No write ever leaves.
    setDraftResetSignal((value) => value + 1);
  }, []);

  const movePin = useCallback(
    async (annotationId: string, tip: NaturalPoint) => {
      const captureId = selectedReady?.id;
      if (!captureId) return;
      // Optimistic local update: the pin stays where it was dropped while
      // the one revisioned write commits. A failure re-reads the
      // authoritative list, so a rejected move snaps back — never a false
      // success and never a ghost.
      setPinsState((current) =>
        current && current.captureId === captureId
          ? {
              ...current,
              pins: current.pins.map((pin) => (pin.id === annotationId ? { ...pin, tip } : pin)),
            }
          : current,
      );
      setMoveError(null);
      try {
        const response = await fetch(
          `/api/captures/${encodeURIComponent(captureId)}/annotations/${encodeURIComponent(annotationId)}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              [EDITOR_CSRF_HEADER]: readCsrfProof(),
            },
            body: JSON.stringify({ tip }),
          },
        );
        if (!response.ok) {
          setMoveError("That pin move could not be saved. The saved position was restored.");
          await loadPins(captureId);
          return;
        }
        const payload = (await response.json()) as PinMutationResponse;
        setPinsState((current) =>
          current && current.captureId === captureId
            ? {
                ...current,
                pins: current.pins.map((pin) =>
                  pin.id === annotationId ? payload.annotation : pin,
                ),
              }
            : current,
        );
      } catch {
        setMoveError("That pin move could not be saved. The saved position was restored.");
        await loadPins(captureId);
      }
    },
    [selectedReady, loadPins],
  );

  return (
    <div className="workspace">
      <nav className="workspace-tree" aria-label="Projects, pages, and devices">
        <ul>
          {projects.map((project) => (
            <li key={project.projectId}>
              <h3>{project.title}</h3>
              <p className="project-counts">
                {project.counts.pages} pages · {project.counts.ready} ready ·{" "}
                {project.counts.failed} failed · {project.counts.inProgress} in progress
              </p>
              <ol>
                {project.pages.map((page) => (
                  <li key={page.id}>
                    <span className="page-url">{page.normalizedUrl}</span>
                    <ul className="page-devices">
                      {page.devices.map((device) => {
                        const isActive =
                          active?.page.id === page.id && active.device.variant === device.variant;
                        return (
                          <li key={device.variant}>
                            <button
                              type="button"
                              // The visible label is just "Desktop"; the page
                              // it belongs to has to be in the accessible
                              // name or every project repeats two identical
                              // buttons.
                              aria-label={`${variantLabel(device.variant)} capture of ${page.normalizedUrl}`}
                              aria-current={isActive ? "true" : undefined}
                              onClick={() =>
                                setSelection({
                                  pageId: page.id,
                                  variant: device.variant,
                                  captureId: null,
                                })
                              }
                            >
                              {variantLabel(device.variant)}
                              <span className="device-status"> — {deviceStatus(device)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </nav>

      {active ? (
        <section className="workspace-detail" aria-label="Selected capture">
          <h3>
            {variantLabel(active.device.variant)} — {active.page.normalizedUrl}
          </h3>

          {/* Self-documenting canvas (VAL-CANVAS-009): plain-language
              instructions for every interaction this build actually has —
              pan, zoom, drop a pin, save it with a comment, and open a saved
              pin's comment — so the page alone teaches the workflow. */}
          <p className="workspace-hint">
            This is a static screenshot of the page. Navigate mode: drag to
            pan, scroll or pinch to zoom, or use the camera buttons to fit
            the whole page, fit its width, or view it at natural size.
            Navigate never creates or moves a mark. Place pin mode: click or
            tap the screenshot to drop a pin, write a comment in the panel,
            and press Save pin — Escape or Cancel discards the draft — and
            drag a pin to move it. Click a saved pin, or its entry in the
            Pins list, to read its comment.
          </p>

          {active.device.attempts.length > 1 ? (
            <ul className="capture-versions" aria-label="Capture versions">
              {active.device.attempts.map((attempt) => (
                <li key={attempt.id}>
                  <button
                    type="button"
                    aria-current={attempt.id === selectedAttempt?.id ? "true" : undefined}
                    onClick={() =>
                      setSelection({
                        pageId: active.page.id,
                        variant: active.device.variant,
                        captureId: attempt.id,
                      })
                    }
                  >
                    Version {attempt.attempt} — {STATE_LABELS[attempt.state]}
                    {attempt.id === active.device.selectedCaptureId ? " (default)" : ""}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="workspace-body">
            {selectedReady ? (
              // Keyed by capture id so every selection change remounts the
              // plane: drafts and transient state die with the old plane,
              // and the session camera memory restores this plane's own
              // camera (or the entire-capture view on first visit).
              <CaptureCanvas
                key={selectedReady.id}
                captureId={selectedReady.id}
                pageUrl={active.page.normalizedUrl}
                variant={variantLabel(active.device.variant)}
                attempt={selectedReady.attempt}
                width={selectedReady.documentWidth!}
                height={selectedReady.documentHeight!}
                pins={activePins}
                selectedPinId={selectedPinId}
                onSelectPin={setSelectedPinId}
                onMovePin={(annotationId, tip) => void movePin(annotationId, tip)}
                savedCamera={cameras.current.get(selectedReady.id) ?? null}
                onCameraChange={handleCameraChange}
                onDraftChange={setDraftTip}
                draftResetSignal={draftResetSignal}
              />
            ) : (
              // Unavailable/empty states are non-annotatable: no canvas, no
              // pin affordance, and a named next action (wait, or retry).
              <div className="capture-stage" data-testid="capture-stage">
                <p>
                  No capture to show yet:{" "}
                  {selectedAttempt ? STATE_LABELS[selectedAttempt.state] : "not captured"}.
                </p>
              </div>
            )}
            <CapturePanel
              attempt={selectedAttempt}
              pageUrl={active.page.normalizedUrl}
              variant={active.device.variant}
              ready={selectedReady !== null}
              draftTip={draftTip}
              draftBody={draftBody}
              onDraftBodyChange={setDraftBody}
              onSaveDraft={() => void saveDraft()}
              onCancelDraft={cancelDraft}
              saveState={saveState}
              pinsStatus={
                pinsState && pinsState.captureId === selectedCaptureId ? pinsState.status : null
              }
              pins={activePins}
              selectedPinId={selectedPinId}
              onSelectPin={setSelectedPinId}
              moveError={moveError}
            />
          </div>

          {active.device.latest?.state === "failed" && active.device.latest.errorCode ? (
            <p role="alert" className="capture-error">
              {outcomeMessages.get(active.device.latest.errorCode) ??
                "That capture did not complete."}
            </p>
          ) : null}
          {active.device.latest?.state === "stale" ? (
            <p role="alert" className="capture-error">
              This attempt stopped responding. Retry to schedule a fresh one.
            </p>
          ) : null}
          {retryError ? (
            <p role="alert" className="capture-error">
              {retryError}
            </p>
          ) : null}

          {active.device.retryable ? (
            <button
              type="button"
              disabled={retrying}
              onClick={() => void retry(active.page.id, active.device.variant)}
            >
              {retrying
                ? "Retrying…"
                : `Retry ${variantLabel(active.device.variant)} capture`}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
