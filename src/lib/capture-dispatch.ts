// The editor's capture-dispatch driver (client half of VAL-CAPTURE-007).
//
// Creating a project commits pending attempts; the server continues them
// after its response (D076), and this client driver is the fallback that
// re-drives whatever is still pending through the scoped dispatch route.
// Both go through the same durable two-lease cap and the same fenced claim,
// so it is safe for both to try. This module is the driver policy, kept pure
// and clock-injected next to the polling policy it cooperates with:
//
// - every pending attempt in the hierarchy is a dispatch target, in
//   deterministic project → page → device order, so two clients looking at
//   the same hierarchy drive the same attempts first;
// - at most MAX_ACTIVE_CAPTURES dispatches are in flight from this client,
//   mirroring the durable cap rather than duplicating it;
// - a quota-exceeded (or otherwise non-finalizing) answer defers the attempt
//   for one re-drive delay instead of looping — the polling loop's next
//   hierarchy read is what re-drives it once a slot has had time to free;
// - an attempt whose dispatch finalized (ready or a catalog failure) is
//   terminal in the very next hierarchy read, so it can never be re-driven.
//
// Dispatch itself is POST /api/captures/:id/dispatch — the one existing
// scoped route. This module adds no endpoint and the hierarchy GET stays
// read-only.

import {
  CAPTURE_OUTCOMES,
  CAPTURE_POLL_INITIAL_INTERVAL_MS,
  MAX_ACTIVE_CAPTURES,
} from "./boundaries";
import { EDITOR_CSRF_HEADER } from "./auth-constants";
import { readCsrfProof } from "./csrf";

/**
 * How long a quota-held or transiently failed attempt waits before the driver
 * may offer it again. One initial poll interval: the polling loop re-reads
 * the hierarchy on at least that cadence while work is pending, so a deferred
 * attempt is re-driven on roughly the next poll tick — after a slot has had
 * time to free — without a tight retry loop.
 */
export const CAPTURE_DISPATCH_REDRIVE_DELAY_MS = CAPTURE_POLL_INITIAL_INTERVAL_MS;

/** The smallest hierarchy shape the driver reads. */
export interface DispatchProjectView {
  pages: ReadonlyArray<{
    devices: ReadonlyArray<{
      attempts: ReadonlyArray<{ id: string; state: string }>;
    }>;
  }>;
}

/**
 * Every attempt the driver should dispatch, in deterministic order. Only
 * `pending` attempts qualify: `capturing` is owned by whichever dispatch
 * claimed it, and terminal or computed-stale attempts will never move again
 * (a stale attempt needs an explicit retry, which itself commits a pending
 * row the driver then picks up).
 */
export function pendingDispatchTargets(
  projects: readonly DispatchProjectView[],
): string[] {
  const targets: string[] = [];
  for (const project of projects) {
    for (const page of project.pages) {
      for (const device of page.devices) {
        for (const attempt of device.attempts) {
          if (attempt.state === "pending") targets.push(attempt.id);
        }
      }
    }
  }
  return targets;
}

/**
 * The next batch of attempts to dispatch now. The batch is bounded so this
 * client never has more than MAX_ACTIVE_CAPTURES dispatches in flight — the
 * durable lease cap is the real enforcement, and a client that stays under it
 * only ever sees quota-exceeded when *other* clients hold the slots.
 * Attempts already in flight or still inside their re-drive delay are
 * skipped, so a re-render or an unchanged hierarchy read can never dispatch
 * the same attempt twice.
 */
export function nextDispatchBatch(
  targets: readonly string[],
  inFlight: ReadonlySet<string>,
  deferredUntil: ReadonlyMap<string, number>,
  now: number,
): string[] {
  const available = MAX_ACTIVE_CAPTURES - inFlight.size;
  if (available <= 0) return [];
  const batch: string[] = [];
  for (const target of targets) {
    if (batch.length >= available) break;
    if (inFlight.has(target)) continue;
    const until = deferredUntil.get(target);
    if (until !== undefined && until > now) continue;
    batch.push(target);
  }
  return batch;
}

export type DispatchOutcome =
  /** The dispatch request settled the attempt: ready, a catalog failure, or
   *  the row is gone — a hierarchy read shows which. */
  | "settled"
  /** Every durable slot is held (by other clients); the attempt stays
   *  pending and must wait for a re-drive. */
  | "quota"
  /** Another dispatch claimed or finalized this attempt first. */
  | "conflict"
  /** The request never produced a trustworthy answer; the attempt may still
   *  be pending and must wait for a re-drive. */
  | "transient";

/**
 * One dispatch through the existing scoped route. The attempt row names the
 * target, so the request carries no body — nothing a client sends can
 * influence what gets captured. The answer is reduced to a coarse outcome so
 * the driver can decide between "observe the new state" and "wait for a
 * slot"; the catalog message itself is surfaced by the hierarchy read, never
 * relayed here.
 */
const terminalOutcomeCodes = new Set(
  CAPTURE_OUTCOMES.filter((outcome) => outcome.consumesAttempt).map((outcome) => outcome.code),
);

export async function postCaptureDispatch(captureId: string): Promise<DispatchOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/captures/${encodeURIComponent(captureId)}/dispatch`, {
      method: "POST",
      headers: { [EDITOR_CSRF_HEADER]: readCsrfProof() },
    });
  } catch {
    return "transient";
  }
  if (typeof response?.status !== "number") return "transient";
  if (response.ok) return "settled";
  if (response.status === 429) return "quota";
  if (response.status === 409) return "conflict";
  // A catalog outcome answer (at any status) means the attempt consumed its
  // row and is terminal: the next hierarchy read surfaces the outcome, and
  // the attempt must never be re-driven. Any other answer is untrustworthy
  // about the row's state: a 4xx is observed like a conflict, a 5xx or an
  // unreadable body waits for a re-drive — never a tight loop.
  const code: string | null = await response
    .json()
    .then((body: unknown) =>
      typeof body === "object" && body !== null && "code" in body
        ? String((body as { code: unknown }).code)
        : null,
    )
    .catch(() => null);
  if (code !== null && terminalOutcomeCodes.has(code)) return "settled";
  if (response.status < 500) return "conflict";
  return "transient";
}
