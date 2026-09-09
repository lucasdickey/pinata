// The persistent capture-attempt status model (VAL-PROJECT-005,
// VAL-CAPTURE-008).
//
// Attempt rows are immutable history: `pending → capturing → ready|failed`,
// one row per attempt, terminal rows never rewritten. Everything a caller
// needs beyond those stored facts is *computed* here so two readers of the
// same rows can never disagree:
//
// - staleness is derived from the published age, not persisted, so an
//   abandoned `capturing` attempt becomes retryable without a background job;
// - the active version is the highest-numbered ready attempt, so a late
//   result from an older attempt can finish and persist on its own row yet
//   never displace a newer ready capture;
// - retry is offered only for a terminal or computed-stale latest attempt,
//   and never for an outcome the catalog marks non-retryable.

import { CAPTURE_OUTCOMES, STALE_CAPTURE_AGE_MS } from "../../boundaries";
import type { CaptureVariant } from "../db/schema";

/** The stored columns the status model reads. */
export interface CaptureAttemptRecord {
  id: string;
  variant: string;
  attempt: number;
  status: string;
  errorCode: string | null;
  imageHash: string | null;
  capturedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Persisted statuses plus the one computed state. */
export type CaptureAttemptState = "pending" | "capturing" | "stale" | "ready" | "failed";

/** One attempt as presented to an authorized reader. */
export interface CaptureAttemptView {
  id: string;
  variant: string;
  attempt: number;
  state: CaptureAttemptState;
  errorCode: string | null;
  imageHash: string | null;
  capturedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface VariantSummary {
  variant: string;
  /** Newest attempt first; the deterministic version order. */
  attempts: CaptureAttemptView[];
  /** The highest-numbered attempt, or null when the variant has no row. */
  latest: CaptureAttemptView | null;
  /** The default selected capture: the highest-numbered ready attempt. */
  selectedCaptureId: string | null;
  selectedAttempt: number | null;
  /** True when a ready capture exists and can be shown/annotated. */
  usable: boolean;
  /** True when a scoped retry may be created for this variant right now. */
  retryable: boolean;
}

const retryableByOutcome = new Map(
  CAPTURE_OUTCOMES.map((outcome) => [outcome.code, outcome.retryable] as const),
);

/** True for the two states no further transition may leave. */
export function isTerminalCaptureState(state: CaptureAttemptState): boolean {
  return state === "ready" || state === "failed";
}

/**
 * The attempt's effective state. `capturing` older than the published stale
 * age computes to `stale`; terminal rows are returned untouched.
 */
export function captureAttemptState(
  row: Pick<CaptureAttemptRecord, "status" | "updatedAt">,
  now: number,
): CaptureAttemptState {
  if (row.status === "capturing" && now - row.updatedAt > STALE_CAPTURE_AGE_MS) return "stale";
  return row.status as CaptureAttemptState;
}

function toView(row: CaptureAttemptRecord, now: number): CaptureAttemptView {
  return {
    id: row.id,
    variant: row.variant,
    attempt: row.attempt,
    state: captureAttemptState(row, now),
    errorCode: row.errorCode,
    imageHash: row.imageHash,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Newest attempt version first, with the immutable id as tie-breaker. */
function byVersionDesc(a: CaptureAttemptRecord, b: CaptureAttemptRecord): number {
  return b.attempt - a.attempt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/**
 * The active capture for a variant: the highest-numbered ready attempt.
 * Wall-clock completion order is deliberately ignored so a late old result
 * cannot win over a newer ready attempt.
 */
export function selectActiveAttempt(
  rows: CaptureAttemptRecord[],
  now: number,
): CaptureAttemptView | null {
  const ready = rows.filter((row) => captureAttemptState(row, now) === "ready");
  if (ready.length === 0) return null;
  return toView([...ready].sort(byVersionDesc)[0]!, now);
}

/** Whether a new attempt may be created for this variant's current state. */
export function isRetryable(latest: CaptureAttemptView | null): boolean {
  if (!latest) return false;
  if (latest.state === "stale") return true;
  if (!isTerminalCaptureState(latest.state)) return false;
  if (latest.state === "failed" && latest.errorCode !== null) {
    return retryableByOutcome.get(latest.errorCode) ?? true;
  }
  return true;
}

/** The complete device-level view of one page variant. */
export function summarizeVariant(
  variant: CaptureVariant | string,
  rows: CaptureAttemptRecord[],
  now: number,
): VariantSummary {
  const attempts = [...rows].sort(byVersionDesc).map((row) => toView(row, now));
  const latest = attempts[0] ?? null;
  const selected = selectActiveAttempt(rows, now);
  return {
    variant,
    attempts,
    latest,
    selectedCaptureId: selected?.id ?? null,
    selectedAttempt: selected?.attempt ?? null,
    usable: selected !== null,
    retryable: isRetryable(latest),
  };
}
