// Server-only request schemas for pin annotation mutations. Strict: unknown
// fields, non-finite coordinates, blank or over-limit bodies, and
// out-of-bounds idempotency keys are rejected before any lookup or
// persistence, and nothing is echoed back on failure.

import { z } from "zod";
import {
  FEEDBACK_BODY_MAX_CHARS,
  IDEMPOTENCY_KEY_MAX_CHARS,
  IDEMPOTENCY_KEY_MIN_CHARS,
} from "../../boundaries";

/** A finite JSON number: NaN and the infinities are not geometry. */
const finiteNumber = z.number().refine((value) => Number.isFinite(value));

/** The pin tip in screenshot-natural CSS pixels (bounds checked per capture). */
export const pinTipSchema = z.strictObject({
  x: finiteNumber,
  y: finiteNumber,
});

/** POST /api/captures/[captureId]/annotations body: one pin, one intent key. */
export const createPinBodySchema = z.strictObject({
  tip: pinTipSchema,
  body: z.string().min(1).max(FEEDBACK_BODY_MAX_CHARS),
  idempotencyKey: z.string().min(IDEMPOTENCY_KEY_MIN_CHARS).max(IDEMPOTENCY_KEY_MAX_CHARS),
});

export type CreatePinBody = z.infer<typeof createPinBodySchema>;

/** PATCH .../annotations/[annotationId] body: the moved tip, nothing else. */
export const movePinBodySchema = z.strictObject({
  tip: pinTipSchema,
});

export type MovePinBody = z.infer<typeof movePinBodySchema>;
