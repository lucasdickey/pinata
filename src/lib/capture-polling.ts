// Capture-progress polling policy (VAL-CAPTURE-012).
//
// The workspace re-reads the project hierarchy while any attempt is
// `pending` or `capturing`. This module is the whole policy, pure and
// clock-injected so the published bounds are testable without a browser:
//
// - backoff doubles from the published initial interval up to the published
//   ceiling, so a long capture is polled gently rather than hammered;
// - polling stops as soon as no attempt is in progress — `ready`, `failed`,
//   and computed `stale` are all stop states, so a poller never spins on a
//   row that will never move again;
// - polling stops at the published deadline regardless, which is longer than
//   the stale age so an abandoned attempt is always observed as stale first.
//
// Polling is read-only: it issues hierarchy GETs only, so it can never
// create, duplicate, or mutate an attempt. Retry stays an explicit action.

import {
  CAPTURE_POLL_DEADLINE_MS,
  CAPTURE_POLL_INITIAL_INTERVAL_MS,
  CAPTURE_POLL_MAX_INTERVAL_MS,
} from "./boundaries";

/** The attempt states that keep a poller alive. */
export const IN_PROGRESS_CAPTURE_STATES = ["pending", "capturing"] as const;

export interface CapturePollSnapshot {
  /** True while any attempt is pending or capturing. */
  inProgress: boolean;
  /** Milliseconds since this polling run started. */
  elapsedMs: number;
  /** How many polls this run has already scheduled. */
  pollCount: number;
}

export type CapturePollDecision =
  | { action: "poll"; delayMs: number }
  | { action: "stop"; reason: "settled" | "deadline" };

/** True when at least one attempt is still moving toward an outcome. */
export function captureWorkInProgress(
  attempts: ReadonlyArray<{ state: string }>,
): boolean {
  return attempts.some((attempt) =>
    (IN_PROGRESS_CAPTURE_STATES as readonly string[]).includes(attempt.state),
  );
}

/**
 * The next polling decision for one snapshot. Terminal and computed-stale
 * attempts settle the run; past the deadline the run stops even when work
 * appears unfinished (it can be resumed by a fresh view of the page).
 */
export function nextCapturePoll(snapshot: CapturePollSnapshot): CapturePollDecision {
  if (!snapshot.inProgress) return { action: "stop", reason: "settled" };
  if (snapshot.elapsedMs >= CAPTURE_POLL_DEADLINE_MS) {
    return { action: "stop", reason: "deadline" };
  }
  const delayMs = Math.min(
    CAPTURE_POLL_INITIAL_INTERVAL_MS * 2 ** snapshot.pollCount,
    CAPTURE_POLL_MAX_INTERVAL_MS,
  );
  return { action: "poll", delayMs };
}
