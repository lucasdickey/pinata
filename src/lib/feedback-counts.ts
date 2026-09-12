// Client-safe helpers for the feedback loop (D075): status labels, comment
// excerpts, the per-pin route paths, and the arithmetic behind the unread
// and open badges. Pure functions only, so the counts the rail, the project
// header, and the founder list show are unit-testable without a DOM.
//
// The hierarchy read carries counts per capture and per project for the
// requesting role. Viewing a pin's thread marks it seen on the server, and
// the workspace lowers its local counts by the same amount until the next
// hierarchy read confirms them; `SeenAdjustments` holds those local
// subtractions, keyed by capture id.

import type { FeedbackCounts, PinStatus } from "./annotations";

export const PIN_STATUS_LABELS: Record<PinStatus, string> = {
  open: "Open",
  replied: "Replied",
  resolved: "Resolved",
};

/** Replies read locally since the last hierarchy read, per capture id. */
export type SeenAdjustments = Record<string, number>;

/** The shape the helpers below need from a project; the wire type has more. */
export interface FeedbackSource {
  feedback?: FeedbackCounts;
  captureFeedback?: Record<string, FeedbackCounts>;
  pages: { devices: { attempts: { id: string }[] }[] }[];
}

export function emptyFeedback(): FeedbackCounts {
  return { pins: 0, open: 0, resolved: 0, unreadReplies: 0 };
}

/** A pin's comment, collapsed to one line and cut to `max` characters. */
export function pinExcerpt(body: string, max = 80): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1).trimEnd()}…`;
}

/** The counts for one capture, with local seen adjustments applied. */
export function captureFeedback(
  project: FeedbackSource,
  captureId: string | null,
  adjustments: SeenAdjustments = {},
): FeedbackCounts {
  if (!captureId) return emptyFeedback();
  const counts = project.captureFeedback?.[captureId];
  if (!counts) return emptyFeedback();
  return {
    ...counts,
    unreadReplies: Math.max(0, counts.unreadReplies - (adjustments[captureId] ?? 0)),
  };
}

/** The project's counts, with the local seen adjustments of its captures applied. */
export function projectFeedback(
  project: FeedbackSource,
  adjustments: SeenAdjustments = {},
): FeedbackCounts {
  const counts = project.feedback ?? emptyFeedback();
  let read = 0;
  for (const page of project.pages) {
    for (const device of page.devices) {
      for (const attempt of device.attempts) read += adjustments[attempt.id] ?? 0;
    }
  }
  return { ...counts, unreadReplies: Math.max(0, counts.unreadReplies - read) };
}

/**
 * The short badge text for a rail entry: unread first because it is the
 * thing that changed, then what is still open. Null when there is nothing
 * to say, so an untouched capture shows no badge at all.
 */
export function feedbackBadge(counts: FeedbackCounts): string | null {
  const parts: string[] = [];
  if (counts.unreadReplies > 0) parts.push(`${counts.unreadReplies} new`);
  if (counts.open > 0) parts.push(`${counts.open} open`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The longer summary for a project header. */
export function feedbackSummary(counts: FeedbackCounts): string {
  const pins = `${counts.pins} pin${counts.pins === 1 ? "" : "s"}`;
  if (counts.pins === 0) return pins;
  return `${pins} · ${counts.open} open · ${counts.resolved} resolved · ${counts.unreadReplies} unread ${
    counts.unreadReplies === 1 ? "reply" : "replies"
  }`;
}

/** The per-pin feedback route for one action. */
export function pinFeedbackPath(
  captureId: string,
  annotationId: string,
  action: "resolve" | "reopen" | "seen",
): string {
  return `/api/captures/${encodeURIComponent(captureId)}/annotations/${encodeURIComponent(
    annotationId,
  )}/${action}`;
}
