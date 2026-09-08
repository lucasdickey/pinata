// Server-only request schemas for the project routes. Strict: unknown fields,
// wrong types, oversized strings, and oversized arrays are rejected before
// any normalization or persistence, and nothing is echoed back on failure.

import { z } from "zod";
import {
  IDEMPOTENCY_KEY_MAX_CHARS,
  IDEMPOTENCY_KEY_MIN_CHARS,
  MAX_SUBMITTED_URL_ROWS,
  MAX_URL_BYTES,
  PROJECT_TITLE_MAX_CHARS,
} from "../../boundaries";

/**
 * POST /api/projects body. The row array is optional (a root-only project is
 * the default form); per-row admissibility is decided by the URL boundary,
 * not here, so the caller receives one correction per offending row.
 */
export const createProjectBodySchema = z.strictObject({
  title: z.string().max(PROJECT_TITLE_MAX_CHARS).optional(),
  rootUrl: z.string().max(MAX_URL_BYTES),
  urls: z.array(z.string().max(MAX_URL_BYTES)).max(MAX_SUBMITTED_URL_ROWS).optional(),
  idempotencyKey: z.string().min(IDEMPOTENCY_KEY_MIN_CHARS).max(IDEMPOTENCY_KEY_MAX_CHARS),
});

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;
