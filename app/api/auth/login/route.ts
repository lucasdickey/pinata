// POST /api/auth/login — the only way to establish an editor session.
//
// Boundary order (VAL-AUTH-001, VAL-AUTH-007): exact same-origin Origin,
// application/json content type, hard byte cap, strict schema, then the
// server-only timing-safe verifier. Every failure is a bounded generic
// response that echoes nothing; only a valid password sets session cookies.

import { AUTH_REQUEST_MAX_BYTES } from "../../../../src/lib/boundaries";
import { csrfCookie, sessionCookie } from "../../../../src/lib/server/auth/cookies";
import { verifyEditorPassword } from "../../../../src/lib/server/auth/password";
import { loginBodySchema } from "../../../../src/lib/server/auth/schemas";
import { getEditorPassword, getSessionSecret } from "../../../../src/lib/server/auth/secrets";
import { createEditorSession } from "../../../../src/lib/server/auth/session";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
  readBoundedJson,
} from "../../../../src/lib/server/http";

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);

  const body = await readBoundedJson(request, AUTH_REQUEST_MAX_BYTES);
  if (!body.ok) {
    const status = body.error === "too-large" ? 413 : body.error === "content-type" ? 415 : 400;
    return jsonError(status, ERRORS.invalidRequest);
  }
  const parsed = loginBodySchema.safeParse(body.value);
  if (!parsed.success) return jsonError(400, ERRORS.invalidRequest);

  // Fail closed when EDITOR_PASSWORD is absent: same generic denial, no
  // variable names, no default credential.
  if (!verifyEditorPassword(parsed.data.password, getEditorPassword())) {
    return jsonError(401, ERRORS.wrongPassword);
  }

  const secret = getSessionSecret();
  if (!secret) return jsonError(503, ERRORS.unavailable);

  // Success replaces any pre-existing (possibly attacker-chosen) cookies.
  const secure = isSecureRequest(request);
  const { token, payload } = createEditorSession(secret, Date.now());
  const response = Response.json({ ok: true, expiresAt: new Date(payload.exp).toISOString() });
  response.headers.append("set-cookie", sessionCookie(token, secure));
  response.headers.append("set-cookie", csrfCookie(payload.csrf, secure));
  return response;
}

// Explicitly answer other common methods with a bounded generic 405 rather
// than falling through to a framework default we do not control.
function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
