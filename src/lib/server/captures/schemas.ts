// Server-only request schema for capture mutations. Strict: unknown fields,
// unknown variants, and out-of-bounds keys are rejected before any lookup or
// persistence, and nothing is echoed back on failure.

import { z } from "zod";
import { IDEMPOTENCY_KEY_MAX_CHARS, IDEMPOTENCY_KEY_MIN_CHARS } from "../../boundaries";
import { CAPTURE_VARIANTS } from "../db/schema";

/** POST /api/pages/[pageId]/captures body: one target, one intent key. */
export const retryCaptureBodySchema = z.strictObject({
  variant: z.enum(CAPTURE_VARIANTS),
  idempotencyKey: z.string().min(IDEMPOTENCY_KEY_MIN_CHARS).max(IDEMPOTENCY_KEY_MAX_CHARS),
});

export type RetryCaptureBody = z.infer<typeof retryCaptureBodySchema>;
