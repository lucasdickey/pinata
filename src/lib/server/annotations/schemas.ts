// Server-only request schemas for annotation mutations (pins and, since
// D079, rectangles). Strict: unknown fields, non-finite coordinates, blank or
// over-limit bodies, and out-of-bounds idempotency keys are rejected before
// any lookup or persistence, and nothing is echoed back on failure.
//
// The geometry key names the kind: `tip` is a pin, `rect` is a rectangle. A
// body carrying both, or neither, is invalid. Capture-bound checks (inside
// the document, at least the minimum size) happen in the store, which is the
// only place the capture's dimensions are known.

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
 * A rectangle's box in screenshot-natural CSS pixels. The shape is checked
 * here; the size minimum and the capture bounds are checked in the store.
 */
export const rectangleSchema = z.strictObject({
  x: finiteNumber,
  y: finiteNumber,
  width: finiteNumber,
  height: finiteNumber,
});

/**
 * The explicit context decision every create must carry: the capture-local
 * id of one manifest element, or null for "No element". The key is required
 * — an undecided draft cannot save — and the server derives the snapshot
 * from the persisted manifest; a client-authored metadata object is
 * impossible here (strict keys, and the value is an id or null only).
 */
const elementDecisionSchema = z.union([z.string().min(1).max(64), z.null()]);

const bodySchema = z.string().min(1).max(FEEDBACK_BODY_MAX_CHARS);
const idempotencyKeySchema = z
  .string()
  .min(IDEMPOTENCY_KEY_MIN_CHARS)
  .max(IDEMPOTENCY_KEY_MAX_CHARS);

/**
 * POST /api/captures/[captureId]/annotations body: one geometry (a pin tip
 * or a rectangle), one bounded comment, one explicit context decision, one
 * intent key.
 */
export const createAnnotationBodySchema = z.union([
  z.strictObject({
    tip: pinTipSchema,
    body: bodySchema,
    elementId: elementDecisionSchema,
    idempotencyKey: idempotencyKeySchema,
  }),
  z.strictObject({
    rect: rectangleSchema,
    body: bodySchema,
    elementId: elementDecisionSchema,
    idempotencyKey: idempotencyKeySchema,
  }),
]);

export type CreateAnnotationBody = z.infer<typeof createAnnotationBodySchema>;

/** The optimistic-concurrency precondition every annotation mutation carries. */
const expectedRevisionSchema = z.number().int().positive();

/**
 * PATCH .../annotations/[annotationId] body: new geometry (a moved tip for a
 * pin, a moved or resized box for a rectangle), a new original body, or
 * both — always with the revision the write is based on. The geometry key
 * must match the annotation's kind; the store rejects a mismatch.
 */
export const updateAnnotationBodySchema = z
  .strictObject({
    tip: pinTipSchema.optional(),
    rect: rectangleSchema.optional(),
    body: bodySchema.optional(),
    expectedRevision: expectedRevisionSchema,
  })
  .refine(
    (value) => value.tip !== undefined || value.rect !== undefined || value.body !== undefined,
  )
  .refine((value) => value.tip === undefined || value.rect === undefined);

export type UpdateAnnotationBody = z.infer<typeof updateAnnotationBodySchema>;

/** DELETE .../annotations/[annotationId] body: the revision precondition. */
export const deleteAnnotationBodySchema = z.strictObject({
  expectedRevision: expectedRevisionSchema,
});

export type DeleteAnnotationBody = z.infer<typeof deleteAnnotationBodySchema>;
