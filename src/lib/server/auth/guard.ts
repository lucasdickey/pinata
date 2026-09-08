// Server-only authorization boundary. Every protected read or mutation calls
// requireEditor (or requireEditorMutation) immediately before data access —
// never trust client routing. Anonymous callers, non-editor actors, forged,
// expired, and logged-out sessions all receive the same generic denial.

import { timingSafeEqual } from "node:crypto";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../auth-constants";
import { ERRORS, jsonError, parseCookieHeader } from "../http";
import { getSessionSecret } from "./secrets";
import {
  renewEditorSessionToken,
  verifyEditorSessionToken,
  type EditorSessionPayload,
} from "./session";

export type EditorAuthResult =
  | { ok: true; session: EditorSessionPayload; renewedToken: string | null }
  | { ok: false; response: Response };

function denied(status: number, message: string): EditorAuthResult {
  return { ok: false, response: jsonError(status, message) };
}

/**
 * Authorize an editor read. Returns the verified session, plus a renewed
 * token when the session is inside its renewal threshold (the caller must
 * set it as a cookie).
 */
export function requireEditor(request: Request): EditorAuthResult {
  const secret = getSessionSecret();
  if (!secret) return denied(503, ERRORS.unavailable);
  const token = parseCookieHeader(request.headers.get("cookie"))[EDITOR_SESSION_COOKIE];
  if (!token) return denied(401, ERRORS.authRequired);
  const result = verifyEditorSessionToken(token, secret, Date.now());
  if (result.status !== "valid") return denied(401, ERRORS.authRequired);
  const renewedToken = result.renew
    ? renewEditorSessionToken(result.payload, secret, Date.now())
    : null;
  return { ok: true, session: result.payload, renewedToken };
}

/**
 * Authorize an editor mutation: a valid session plus the session-bound
 * double-submit CSRF proof in the mutation header. The Origin check belongs
 * to the route (hasSameOrigin) so pre-session routes like login can apply
 * their own policy.
 */
export function requireEditorMutation(request: Request): EditorAuthResult {
  const base = requireEditor(request);
  if (!base.ok) return base;
  const proof = request.headers.get(EDITOR_CSRF_HEADER);
  if (!proof) return denied(403, ERRORS.rejected);
  const expected = Buffer.from(base.session.csrf, "utf8");
  const provided = Buffer.from(proof, "utf8");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return denied(403, ERRORS.rejected);
  }
  return base;
}
