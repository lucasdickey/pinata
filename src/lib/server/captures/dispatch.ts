// Admission-gated capture dispatch (VAL-CAPTURE-001, VAL-CAPTURE-002).
//
// This is the only path from a committed `pending` attempt to claimed work,
// and admission runs first: an unsafe target is failed here, before a
// provider client is built, so no rejected URL can produce a Browserless job,
// a screenshot, or a manifest. A safe target claims the attempt with the
// fenced transition and persists both the requested and the final public URL,
// which is what the provider step then captures.

import { captureOutcome } from "../../boundaries";
import { eq } from "drizzle-orm";
import { schema, type Database } from "../db/client";
import type { CaptureVariant } from "../db/schema";
import { admitCaptureTarget, type AdmissionDeps, type AdmissionOutcome } from "./admission";
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
  if (transition === "fenced") return { ok: false, error: "not-dispatchable" };

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
