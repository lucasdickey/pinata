// Server-only request schemas for the auth routes. Strict: any field beyond
// the documented shape is rejected, and nothing is echoed back on failure.

import { z } from "zod";
import { EDITOR_PASSWORD_MAX_CHARS } from "../../boundaries";

/** POST /api/auth/login body: exactly one bounded password string. */
export const loginBodySchema = z.strictObject({
  password: z.string().min(1).max(EDITOR_PASSWORD_MAX_CHARS),
});
