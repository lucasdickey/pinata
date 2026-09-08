// POST /api/auth/logout — authoritative editor logout (VAL-AUTH-004).
//
// Same-origin only. When a currently valid session is presented, the
// session-bound CSRF proof is required and the session id is revoked
// server-side so the pre-logout cookie cannot be replayed. The response
// always clears both cookies with matching attributes, so a repeated or
// already-expired logout is safely idempotent.

import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../../../src/lib/auth-constants";
import { clearCsrfCookie, clearSessionCookie } from "../../../../src/lib/server/auth/cookies";
import { getSessionSecret } from "../../../../src/lib/server/auth/secrets";
import {
  revokeEditorSession,
  verifyEditorSessionToken,
} from "../../../../src/lib/server/auth/session";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
  parseCookieHeader,
} from "../../../../src/lib/server/http";

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);

  const secret = getSessionSecret();
  const token = parseCookieHeader(request.headers.get("cookie"))[EDITOR_SESSION_COOKIE];

  if (secret && token) {
    const result = verifyEditorSessionToken(token, secret, Date.now());
    if (result.status === "valid") {
      // A live session may only be ended by its own CSRF proof.
      const proof = request.headers.get(EDITOR_CSRF_HEADER);
      if (proof !== result.payload.csrf) return jsonError(403, ERRORS.rejected);
      revokeEditorSession(result.payload.sid, result.payload.exp);
    }
  }

  const secure = isSecureRequest(request);
  const response = Response.json({ ok: true });
  response.headers.append("set-cookie", clearSessionCookie(secure));
  response.headers.append("set-cookie", clearCsrfCookie(secure));
  return response;
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
