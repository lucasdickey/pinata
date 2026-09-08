// GET /api/editor/session — the minimal protected editor read. It exists so
// the authorization boundary has a concrete target: anonymous, forged,
// expired, logged-out, and non-editor callers receive the same generic 401
// with no editor data, and a session inside its renewal threshold is renewed
// here (VAL-AUTH-003).

import { csrfCookie, sessionCookie } from "../../../../src/lib/server/auth/cookies";
import { requireEditor } from "../../../../src/lib/server/auth/guard";
import { ERRORS, isSecureRequest, jsonError } from "../../../../src/lib/server/http";

export async function GET(request: Request): Promise<Response> {
  const auth = requireEditor(request);
  if (!auth.ok) return auth.response;

  const response = Response.json({
    authenticated: true,
    actor: "editor",
    expiresAt: new Date(auth.session.exp).toISOString(),
  });
  if (auth.renewedToken) {
    const secure = isSecureRequest(request);
    response.headers.append("set-cookie", sessionCookie(auth.renewedToken, secure));
    response.headers.append("set-cookie", csrfCookie(auth.session.csrf, secure));
  }
  return response;
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
