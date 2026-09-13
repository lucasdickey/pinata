"use client";

// One compact line of capture progress for the selected project, and the
// project-level retry for whatever failed (D076).
//
// The line reads the `progress` block the hierarchy computes on the server:
// how many page devices are done, which page is capturing right now, and a
// rough time left from what this project's finished attempts actually took.
// Nothing here is derived from timers on the client, so a reload shows the
// same line the server would give anyone else.
//
// When attempts have failed and nothing is still moving, the line turns into
// the failure list — every reason comes from the outcome catalog, never a
// provider detail — with one button that retries every failed page device
// through the same scoped retry route the per-device control uses, one
// idempotency key per device so a double click cannot schedule two.

import { useRef, useState } from "react";
import { CAPTURE_OUTCOMES } from "../lib/boundaries";
import { EDITOR_CSRF_HEADER } from "../lib/auth-constants";
import { readCsrfProof } from "../lib/csrf";

/** The additive progress block on a hierarchy project (server-computed). */
export interface ProjectProgress {
  total: number;
  done: number;
  failed: number;
  inProgress: number;
  capturingPage: string | null;
  estimatedRemainingMs: number | null;
}

/** The slice of a workspace project this component reads. */
export interface ProgressProject {
  projectId: string;
  progress?: ProjectProgress;
  pages: ReadonlyArray<{
    id: string;
    normalizedUrl: string;
    devices: ReadonlyArray<{
      variant: string;
      retryable: boolean;
      latest: { state: string; errorCode: string | null } | null;
    }>;
  }>;
}

const outcomeMessages = new Map(
  CAPTURE_OUTCOMES.map((outcome) => [outcome.code, outcome.publicMessage] as const),
);

/** "https://chickpea.co/pricing/" reads as "chickpea.co/pricing". */
export function shortPageName(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.host}${path}${parsed.search}`;
  } catch {
    return url;
  }
}

/** Whole minutes, rounded up, in plain words. */
export function describeRemaining(ms: number): string {
  if (ms < 60_000) return "less than a minute left";
  const minutes = Math.ceil(ms / 60_000);
  return minutes === 1 ? "about 1 minute left" : `about ${minutes} minutes left`;
}

const variantNames: Record<string, string> = { desktop: "Desktop", mobile: "Mobile" };

/** The one-line summary for a project's progress block. */
export function progressLine(progress: ProjectProgress): string | null {
  if (progress.total === 0) return null;
  if (progress.inProgress > 0) {
    const parts = [`Capturing ${progress.done + progress.failed + 1} of ${progress.total}`];
    if (progress.capturingPage) parts.push(shortPageName(progress.capturingPage));
    if (progress.estimatedRemainingMs !== null) {
      parts.push(describeRemaining(progress.estimatedRemainingMs));
    }
    return parts.join(" · ");
  }
  if (progress.failed > 0) {
    const noun = progress.failed === 1 ? "capture" : "captures";
    return `${progress.done} of ${progress.total} captured · ${progress.failed} ${noun} failed`;
  }
  const noun = progress.total === 1 ? "capture" : "captures";
  return `All ${progress.total} ${noun} ready`;
}

interface FailedDevice {
  pageId: string;
  variant: string;
  page: string;
  reason: string;
}

function failedDevices(project: ProgressProject): FailedDevice[] {
  const failed: FailedDevice[] = [];
  for (const page of project.pages) {
    for (const device of page.devices) {
      if (device.latest?.state !== "failed" || !device.retryable) continue;
      failed.push({
        pageId: page.id,
        variant: device.variant,
        page: shortPageName(page.normalizedUrl),
        reason:
          (device.latest.errorCode ? outcomeMessages.get(device.latest.errorCode) : undefined) ??
          "That capture did not complete.",
      });
    }
  }
  return failed;
}

export function CaptureProgress({
  project,
  onChanged,
}: {
  project: ProgressProject;
  onChanged: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per (page, device) retry intent; refreshed only once the server
  // accepted or conflicted, so a repeated click replays the same intent.
  const keys = useRef(new Map<string, string>());

  const progress = project.progress;
  if (!progress) return null;
  const line = progressLine(progress);
  if (!line) return null;

  const failed = progress.inProgress === 0 ? failedDevices(project) : [];

  async function retryFailed() {
    if (retrying || failed.length === 0) return;
    setRetrying(true);
    setError(null);
    let accepted = 0;
    try {
      for (const target of failed) {
        const id = `${target.pageId}:${target.variant}`;
        const key = keys.current.get(id) ?? crypto.randomUUID();
        keys.current.set(id, key);
        let response: Response;
        try {
          response = await fetch(`/api/pages/${encodeURIComponent(target.pageId)}/captures`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              [EDITOR_CSRF_HEADER]: readCsrfProof(),
            },
            body: JSON.stringify({ variant: target.variant, idempotencyKey: key }),
          });
        } catch {
          continue;
        }
        if (response.ok || response.status === 409) keys.current.delete(id);
        if (response.ok) accepted += 1;
      }
      if (accepted < failed.length) {
        setError(
          accepted === 0
            ? "Those captures could not be retried. Reload and try again."
            : "Some captures could not be retried. Reload and try again.",
        );
      }
      if (accepted > 0) onChanged();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="capture-progress" data-testid="capture-progress">
      <p role="status" className="capture-progress-line">
        {line}
      </p>
      {failed.length > 0 ? (
        <div className="capture-progress-failed">
          <ul aria-label="Failed captures">
            {failed.map((target) => (
              <li key={`${target.pageId}:${target.variant}`}>
                {variantNames[target.variant] ?? target.variant} — {target.page}: {target.reason}
              </li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className="capture-error">
              {error}
            </p>
          ) : null}
          <button type="button" disabled={retrying} onClick={() => void retryFailed()}>
            {retrying
              ? "Retrying…"
              : failed.length === 1
                ? "Retry the failed capture"
                : `Retry ${failed.length} failed captures`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
