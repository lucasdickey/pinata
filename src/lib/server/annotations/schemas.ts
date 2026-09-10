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

/**
 * The explicit context decision every create must carry: the capture-local
 * id of one manifest element, or null for "No element". The key is required
 * — an undecided draft cannot save — and the server derives the snapshot
 * from the persisted manifest; a client-authored metadata object is
 * impossible here (strict keys, and the value is an id or null only).
 */
const elementDecisionSchema = z.union([z.string().min(1).max(64), z.null()]);

/**
 * POST /api/captures/[captureId]/annotations body: one pin, one bounded
 * comment, one explicit context decision, one intent key.
 */
export const createPinBodySchema = z.strictObject({
  tip: pinTipSchema,
  body: z.string().min(1).max(FEEDBACK_BODY_MAX_CHARS),
  elementId: elementDecisionSchema,
  idempotencyKey: z.string().min(IDEMPOTENCY_KEY_MIN_CHARS).max(IDEMPOTENCY_KEY_MAX_CHARS),
});

export type CreatePinBody = z.infer<typeof createPinBodySchema>;

/** The optimistic-concurrency precondition every pin mutation carries. */
const expectedRevisionSchema = z.number().int().positive();

/**
 * PATCH .../annotations/[annotationId] body: a moved tip, a new original
 * body, or both — always with the revision the write is based on.
 */
export const updatePinBodySchema = z
  .strictObject({
    tip: pinTipSchema.optional(),
    body: z.string().min(1).max(FEEDBACK_BODY_MAX_CHARS).optional(),
    expectedRevision: expectedRevisionSchema,
  })
  .refine((value) => value.tip !== undefined || value.body !== undefined);

export type UpdatePinBody = z.infer<typeof updatePinBodySchema>;

/** DELETE .../annotations/[annotationId] body: the revision precondition. */
export const deletePinBodySchema = z.strictObject({
  expectedRevision: expectedRevisionSchema,
});

export type DeletePinBody = z.infer<typeof deletePinBodySchema>;
