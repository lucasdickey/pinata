// Server-only request schemas for thread replies and the founder exchange.
// Strict: unknown fields, blank or over-limit bodies, and out-of-bounds
// idempotency keys are rejected before any lookup, and nothing is echoed
// back on failure.

import { z } from "zod";
import {
  FEEDBACK_BODY_MAX_CHARS,
  IDEMPOTENCY_KEY_MAX_CHARS,
  IDEMPOTENCY_KEY_MIN_CHARS,
} from "../../boundaries";
import { FOUNDER_TOKEN_LENGTH } from "../founder/capability";

/** POST .../annotations/[annotationId]/thread body: one bounded reply. */
export const appendThreadEntryBodySchema = z.strictObject({
  body: z.string().min(1).max(FEEDBACK_BODY_MAX_CHARS),
  idempotencyKey: z.string().min(IDEMPOTENCY_KEY_MIN_CHARS).max(IDEMPOTENCY_KEY_MAX_CHARS),
});

export type AppendThreadEntryBody = z.infer<typeof appendThreadEntryBodySchema>;

/** POST /api/founder/[publicId]/session body: the fragment token, once. */
export const founderExchangeBodySchema = z.strictObject({
  token: z.string().length(FOUNDER_TOKEN_LENGTH),
});

export type FounderExchangeBody = z.infer<typeof founderExchangeBodySchema>;
