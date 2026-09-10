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

import { useCallback, useMemo, useRef, useState } from "react";
import { CAPTURE_OUTCOMES } from "../lib/boundaries";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";

export interface AttemptView {
  id: string;
  variant: string;
  attempt: number;
  state: "pending" | "capturing" | "stale" | "ready" | "failed";
  errorCode: string | null;
  imageHash: string | null;
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
 * The ready-capture stage with its view-mode control. Fit view is the
 * default: the entire capture is visible at once (contain, no scrolling).
 * "Natural size" restores the scrollable 1:1 view for reading fine detail.
 * The component is keyed by capture id, so every selection change resets
 * the stage to entire-in-view.
 */
function CaptureStageView({
  attempt,
  pageUrl,
  variant,
}: {
  attempt: AttemptView;
  pageUrl: string;
  variant: string;
}) {
  const [naturalSize, setNaturalSize] = useState(false);
  const name = `Screenshot of ${pageUrl} (${variantLabel(variant)}, version ${attempt.attempt})`;
  return (
    <>
      <p className="capture-view-toggle">
        <button
          type="button"
          aria-pressed={naturalSize}
          onClick={() => setNaturalSize((current) => !current)}
        >
          {naturalSize
            ? "Show the entire capture in view"
            : "View at natural size (scrollable)"}
        </button>
      </p>
      {/* A static image of the captured page: no link, no embedded
          document, and no handler that could navigate to the source. The
          bytes come only from the authorized same-origin asset route
          (/api/captures/[captureId]/asset), which re-verifies the editor
          session on every request — never a public or cross-origin URL. */}
      <div
        className={naturalSize ? "capture-stage" : "capture-stage capture-stage-fit"}
        data-testid="capture-stage"
      >
        <div
          className="capture-stage-scroll"
          role="region"
          aria-label={name}
          // Focusable so keyboard users can scroll the capture in natural
          // size; in fit view the whole image is visible without scrolling.
          tabIndex={0}
        >
          <img className="capture-stage-image" src={`/api/captures/${encodeURIComponent(attempt.id)}/asset`} alt={name} />
        </div>
      </div>
    </>
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

  const selectedAttempt =
    active?.device.attempts.find(
      (attempt) => attempt.id === (active.selection.captureId ?? active.device.selectedCaptureId),
    ) ?? null;

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

          {/* Self-documenting capabilities line: what this surface does
              today, and what is deliberately not here yet. No dead pin
              affordance is rendered. */}
          <p className="workspace-hint">
            Captures are static, read-only screenshots — pins and comments
            arrive with the canvas update. Use natural size to scroll into
            fine detail.
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

          {selectedAttempt?.state === "ready" ? (
            // Keyed by capture id so every selection change resets the
            // stage to the entire-capture-in-view default.
            <CaptureStageView
              key={selectedAttempt.id}
              attempt={selectedAttempt}
              pageUrl={active.page.normalizedUrl}
              variant={active.device.variant}
            />
          ) : (
            <div className="capture-stage" data-testid="capture-stage">
              <p>
                No capture to show yet:{" "}
                {selectedAttempt ? STATE_LABELS[selectedAttempt.state] : "not captured"}.
              </p>
            </div>
          )}

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
