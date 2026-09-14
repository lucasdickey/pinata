"use client";

// The project overview (D077): one card per capture, in page order, Desktop
// then Mobile, so a reviewer sees the whole project — where the notes are
// and what is left to read — before opening any one plane.
//
// Each card shows a thumbnail of the capture (the same private asset the
// canvas renders, through the authorizing route, sized down by CSS; no new
// storage), the page URL, the capture state, and the pin, open, and unread
// counts the hierarchy read carries (D075). A capture that is not ready
// shows its state where the thumbnail would be. The card is a button that
// opens that capture in the canvas view.

import type { FeedbackCounts } from "../lib/annotations";
import {
  captureCountsLine,
  captureFeedback,
  type SeenAdjustments,
} from "../lib/feedback-counts";
import { STATE_LABELS, variantLabel } from "./capture-panel";
import type { AttemptView, DeviceView, WorkspacePage, WorkspaceProject } from "./project-workspace";

/** One card's worth of facts, derived once per render. */
export interface OverviewCard {
  pageId: string;
  pageUrl: string;
  variant: string;
  /** The capture the card stands for: the default ready one, else the newest. */
  attempt: AttemptView | null;
  ready: boolean;
  stateLabel: string;
  counts: FeedbackCounts;
}

/** The attempt a device's card shows: its selected capture, else its newest. */
function cardAttempt(device: DeviceView): AttemptView | null {
  return (
    device.attempts.find((attempt) => attempt.id === device.selectedCaptureId) ??
    device.latest ??
    null
  );
}

/** Every card in page order, Desktop then Mobile. */
export function overviewCards(
  project: WorkspaceProject,
  adjustments: SeenAdjustments = {},
): OverviewCard[] {
  const cards: OverviewCard[] = [];
  for (const page of project.pages) {
    for (const device of page.devices) {
      const attempt = cardAttempt(device);
      const ready =
        attempt?.state === "ready" &&
        attempt.documentWidth !== null &&
        attempt.documentHeight !== null;
      cards.push({
        pageId: page.id,
        pageUrl: page.normalizedUrl,
        variant: device.variant,
        attempt,
        ready,
        stateLabel: attempt ? STATE_LABELS[attempt.state] : "Not captured",
        counts: captureFeedback(project, attempt?.id ?? null, adjustments),
      });
    }
  }
  return cards;
}

export function ProjectOverview({
  project,
  adjustments,
  onOpenCapture,
}: {
  project: WorkspaceProject;
  adjustments: SeenAdjustments;
  onOpenCapture: (pageId: WorkspacePage["id"], variant: string) => void;
}) {
  const cards = overviewCards(project, adjustments);
  return (
    <section className="project-overview" aria-label="Captures" data-testid="project-overview">
      <ul className="overview-grid">
        {cards.map((card) => {
          const label = variantLabel(card.variant);
          return (
            <li key={`${card.pageId}:${card.variant}`}>
              <button
                type="button"
                className="overview-card"
                data-testid="overview-card"
                data-ready={card.ready ? "true" : "false"}
                aria-label={`Open ${label} capture of ${card.pageUrl}`}
                onClick={() => onOpenCapture(card.pageId, card.variant)}
              >
                {card.ready && card.attempt ? (
                  // The private asset through the authorizing route, scaled by
                  // CSS. Never a public or cross-origin URL.
                  <img
                    className="overview-thumb"
                    src={`/api/captures/${encodeURIComponent(card.attempt.id)}/asset`}
                    alt={`${label} capture of ${card.pageUrl}`}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                ) : (
                  <span className="overview-thumb overview-thumb-empty" data-testid="overview-state">
                    {card.stateLabel}
                  </span>
                )}
                <span className="overview-url">{card.pageUrl}</span>
                <span className="overview-meta" data-testid="overview-meta">
                  {label} · {card.stateLabel}
                  {card.attempt ? ` · v${card.attempt.attempt}` : ""}
                </span>
                <span
                  className="overview-counts"
                  data-testid="overview-counts"
                  data-unread={card.counts.unreadReplies > 0 ? "true" : "false"}
                >
                  {captureCountsLine(card.counts)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
