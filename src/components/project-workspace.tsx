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
import { CAPTURE_OUTCOMES } from "../lib/boundaries";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";
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
 * The screen-fixed selection/comment/metadata panel (VAL-CANVAS-002). It
 * lives outside the transformed canvas, so panning and zooming never move
 * it. Exactly one canvas object can be selected at a time and this panel
 * is where its comment, captured element context, and thread render; with
 * no pins in this build it shows the synchronized empty-selection state
 * plus the active capture's identity metadata.
 */
function CapturePanel({
  attempt,
  pageUrl,
  variant,
  draftTip,
}: {
  attempt: AttemptView | null;
  pageUrl: string;
  variant: string;
  /** The active plane's transient draft pin tip, in natural pixels. */
  draftTip: NaturalPoint | null;
}) {
  return (
    <aside
      className="workspace-panel"
      aria-label="Selection and capture details"
      data-testid="capture-panel"
    >
      <h4>Selection</h4>
      {draftTip ? (
        <p className="panel-empty" data-testid="panel-draft">
          Draft pin at natural pixel ({Math.round(draftTip.x)}, {Math.round(draftTip.y)}) — not
          saved yet.
        </p>
      ) : (
        <p className="panel-empty">Nothing selected.</p>
      )}
      <p className="panel-note">
        Place pin mode drops one draft pin on the screenshot; drag it to
        adjust, Escape to cancel. Saving pins with comments arrives with the
        next update.
      </p>
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
  // drops the panel's mirror (the canvas drops its own on remount).
  const selectedCaptureId = selectedAttempt?.id ?? null;
  useEffect(() => {
    setDraftTip(null);
  }, [selectedCaptureId]);

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

          {/* Self-documenting canvas: plain-language instructions for the
              interactions this build actually has, plus what is deliberately
              not here yet. */}
          <p className="workspace-hint">
            Navigate mode: drag to pan, scroll or pinch to zoom, or use the
            camera buttons to fit the whole page, fit its width, or view it
            at natural size. Place pin mode: click or tap the screenshot to
            drop one draft pin, drag it to adjust, Escape to cancel. This is
            a static screenshot: saving pins with comments arrives in the
            next update.
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
            {selectedAttempt?.state === "ready" &&
            selectedAttempt.documentWidth !== null &&
            selectedAttempt.documentHeight !== null ? (
              // Keyed by capture id so every selection change remounts the
              // plane: drafts and transient state die with the old plane,
              // and the session camera memory restores this plane's own
              // camera (or the entire-capture view on first visit).
              <CaptureCanvas
                key={selectedAttempt.id}
                captureId={selectedAttempt.id}
                pageUrl={active.page.normalizedUrl}
                variant={variantLabel(active.device.variant)}
                attempt={selectedAttempt.attempt}
                width={selectedAttempt.documentWidth}
                height={selectedAttempt.documentHeight}
                savedCamera={cameras.current.get(selectedAttempt.id) ?? null}
                onCameraChange={(state) => {
                  cameras.current.set(selectedAttempt.id, state);
                }}
                onDraftChange={setDraftTip}
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
              draftTip={draftTip}
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
