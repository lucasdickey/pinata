// Admission-gated capture dispatch (VAL-CAPTURE-001, VAL-CAPTURE-002,
// VAL-CAPTURE-007).
//
// This is the only path from a committed `pending` attempt to claimed work,
// and the durable concurrency lease is claimed first: when every Browserless
// slot is held, the attempt stays `pending` and the caller gets the
// quota-exceeded outcome, so unscheduled work remains resumable by any later
// authorized client. Admission runs next: an unsafe target is failed here,
// before a provider client is built, so no rejected URL can produce a
// Browserless job, a screenshot, or a manifest. A safe target claims the
// attempt with the fenced transition and persists both the requested and the
// final public URL, which is what the provider step then captures.
//
// Lease ownership: on success the lease stays held and the caller releases it
// once execution has finalized the row; on admission rejection this module
// releases the lease it claimed. A lost fence releases nothing — the winning
// dispatch owns the one slot this attempt can hold.

import { captureOutcome } from "../../boundaries";
import { eq } from "drizzle-orm";
import { schema, type Database } from "../db/client";
import type { CaptureVariant } from "../db/schema";
import { admitCaptureTarget, type AdmissionDeps, type AdmissionOutcome } from "./admission";
import { claimCaptureLease, releaseCaptureLease } from "./leases";
import { applyCaptureTransition } from "./transitions";

export interface DispatchInput {
  captureId: string;
}

export interface DispatchDeps extends AdmissionDeps {
  now?: () => number;
}

export interface AdmittedCapture {
  captureId: string;
  variant: CaptureVariant | string;
  requestedUrl: string;
  finalUrl: string;
  hops: number;
}

export type DispatchResult =
  | { ok: true; capture: AdmittedCapture }
  | { ok: false; error: "not-found" }
  /** The attempt is not `pending`: already claimed, terminal, or fenced. */
  | { ok: false; error: "not-dispatchable" }
  /**
   * Every durable concurrency slot is held. Nothing was consumed: the
   * attempt is still `pending` and a later dispatch may schedule it.
   */
  | { ok: false; error: "quota" }
  | { ok: false; error: "rejected"; outcome: AdmissionOutcome };

/**
 * Admit one pending attempt's target and claim it for provider work. On
 * rejection the attempt moves straight to `failed` with the catalog outcome
 * and its bounded public message; the target URL is never echoed back.
 */
export async function dispatchCapture(
  db: Database,
  input: DispatchInput,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const rows = await db
    .select()
    .from(schema.captures)
    .where(eq(schema.captures.id, input.captureId))
    .limit(1);
  const capture = rows[0];
  if (!capture) return { ok: false, error: "not-found" };
  if (capture.status !== "pending") return { ok: false, error: "not-dispatchable" };

  const now = deps.now?.() ?? Date.now();

  // Durable admission: no slot, no provider job. The attempt is untouched —
  // it remains pending and resumable rather than failed.
  const lease = await claimCaptureLease(db, capture.id, now);
  if (!lease.ok) return { ok: false, error: "quota" };

  const admission = await admitCaptureTarget(capture.requestedUrl, deps);

  if (!admission.ok) {
    const outcome = captureOutcome(admission.outcome);
    const transition = await applyCaptureTransition(db, {
      captureId: capture.id,
      from: "pending",
      to: "failed",
      now,
      errorCode: outcome.code,
      errorMessage: outcome.publicMessage,
    });
    // The row never reached `capturing`, so the slot frees immediately
    // rather than at lease expiry.
    await releaseCaptureLease(db, capture.id);
    if (transition === "fenced") return { ok: false, error: "not-dispatchable" };
    return { ok: false, error: "rejected", outcome: admission.outcome };
  }

  const transition = await applyCaptureTransition(db, {
    captureId: capture.id,
    from: "pending",
    to: "capturing",
    now,
    finalUrl: admission.target.finalUrl,
  });
  if (transition === "fenced") {
    // A concurrent dispatch won this attempt. The lease this claim took is
    // the same slot the winner's execution runs under (one attempt holds one
    // slot), so it must NOT be released here — the winner releases it when
    // execution finalizes the row.
    return { ok: false, error: "not-dispatchable" };
  }

  return {
    ok: true,
    capture: {
      captureId: capture.id,
      variant: capture.variant,
      requestedUrl: admission.target.requestedUrl,
      finalUrl: admission.target.finalUrl,
      hops: admission.target.hops,
    },
  };
}
