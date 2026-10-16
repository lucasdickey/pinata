"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import type { FeedbackCounts } from "../lib/annotations";
import { projectEditorUrl } from "../lib/editor-url";
import {
  captureCountsLine,
  pageFeedback,
  type SeenAdjustments,
} from "../lib/feedback-counts";
import { preferredVariant } from "../lib/pin-order";
import { STATE_LABELS, variantLabel } from "./capture-panel";
import type { AttemptView, DeviceView, WorkspacePage, WorkspaceProject } from "./project-workspace";

interface OverviewDevice {
  variant: string;
  attempt: AttemptView | null;
  ready: boolean;
  stateLabel: string;
}

export interface OverviewCard {
  pageId: string;
  pageUrl: string;
  defaultVariant: string | null;
  devices: OverviewDevice[];
  counts: FeedbackCounts;
}

function cardAttempt(device: DeviceView): AttemptView | null {
  return (
    device.attempts.find((attempt) => attempt.id === device.selectedCaptureId) ??
    device.latest ??
    null
  );
}

export function overviewCards(
  project: WorkspaceProject,
  adjustments: SeenAdjustments = {},
): OverviewCard[] {
  return project.pages.map((page) => ({
    pageId: page.id,
    pageUrl: page.normalizedUrl,
    defaultVariant: preferredVariant(page),
    counts: pageFeedback(project, page, adjustments),
    devices: page.devices.map((device) => {
      const attempt = cardAttempt(device);
      return {
        variant: device.variant,
        attempt,
        ready:
          attempt?.state === "ready" &&
          attempt.documentWidth !== null &&
          attempt.documentHeight !== null,
        stateLabel: attempt ? STATE_LABELS[attempt.state] : "Not captured",
      };
    }),
  }));
}

function PageCard({
  card,
  publicId,
  onOpenCapture,
}: {
  card: OverviewCard;
  publicId: string;
  onOpenCapture: (pageId: string, variant: string) => void;
}) {
  const [selectedVariant, setSelectedVariant] = useState(card.defaultVariant);
  const device = card.devices.find((item) => item.variant === selectedVariant) ?? card.devices[0];
  const label = device ? variantLabel(device.variant) : null;
  const href =
    device?.variant === "desktop" || device?.variant === "mobile"
      ? projectEditorUrl({ project: publicId, page: card.pageId, device: device.variant })
      : null;

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (device) onOpenCapture(card.pageId, device.variant);
  };

  return (
    <li
      className="overview-card"
      data-testid="overview-card"
      data-ready={device?.ready ? "true" : "false"}
    >
      {device && href ? (
        <a
          className="overview-open"
          href={href}
          aria-label={`Open ${label} capture of ${card.pageUrl}`}
          onClick={open}
        >
          {device.ready && device.attempt ? (
            <img
              className="overview-thumb"
              src={`/api/captures/${encodeURIComponent(device.attempt.id)}/asset`}
              alt={`${label} capture of ${card.pageUrl}`}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ) : (
            <span className="overview-thumb overview-thumb-empty" data-testid="overview-state">
              {device.stateLabel}
            </span>
          )}
          <span className="overview-url">{card.pageUrl}</span>
          <span className="overview-meta" data-testid="overview-meta">
            {label} · {device.stateLabel}
            {device.attempt ? ` · v${device.attempt.attempt}` : ""}
          </span>
        </a>
      ) : (
        <span className="overview-url">{card.pageUrl}</span>
      )}
      <div className="overview-device-toggle" role="group" aria-label={`Preview of ${card.pageUrl}`}>
        {card.devices.map((item) => (
          <button
            key={item.variant}
            type="button"
            aria-label={`${variantLabel(item.variant)} preview of ${card.pageUrl}`}
            aria-pressed={item.variant === device?.variant}
            onClick={() => setSelectedVariant(item.variant)}
          >
            {variantLabel(item.variant)}
            <span className="overview-device-state"> · {item.stateLabel}</span>
          </button>
        ))}
      </div>
      <span
        className="overview-counts"
        data-testid="overview-counts"
        data-unread={card.counts.unreadReplies > 0 ? "true" : "false"}
      >
        {captureCountsLine(card.counts)}
      </span>
    </li>
  );
}

export function ProjectOverview({
  project,
  adjustments,
  onOpenCapture,
  trailing,
}: {
  project: WorkspaceProject;
  adjustments: SeenAdjustments;
  onOpenCapture: (pageId: WorkspacePage["id"], variant: string) => void;
  trailing?: ReactNode;
}) {
  const cards = overviewCards(project, adjustments);
  return (
    <section className="project-overview" aria-label="Captures" data-testid="project-overview">
      <ul className="overview-grid">
        {cards.map((card) => (
          <PageCard
            key={`${project.projectId}:${card.pageId}`}
            card={card}
            publicId={project.publicId}
            onOpenCapture={onOpenCapture}
          />
        ))}
        {trailing}
      </ul>
    </section>
  );
}
