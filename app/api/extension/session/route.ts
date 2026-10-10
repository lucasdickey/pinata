// /api/extension/session — the Chrome extension's sign-in (D132).
//
// POST exchanges the editor password for a bearer token, behind exactly the
// login route's boundary (VAL-AUTH-001, VAL-AUTH-006, D098): application/json,
// a hard byte cap, a strict schema, fail-closed store and secret checks, the
// same two throttle buckets — so guessing through the extension spends the
// same budget as guessing on the page — an atomic reservation, and only then
// the timing-safe verifier. There is no Origin check: the extension's
// requests come from its own origin, and what this route returns is a token
// in the body, never a cookie, so a page that posts here learns nothing it
// can read and signs nobody in.
//
// GET reports whether a token is still good (and renews a day-old one in the
// response headers); DELETE signs the token out.

import { AUTH_REQUEST_MAX_BYTES, EDITOR_SESSION_ABSOLUTE_LIFETIME_MS } from "../../../../src/lib/boundaries";
import { isAuthDisabled } from "../../../../src/lib/server/auth/bypass";
import {
  appendExtensionRenewal,
  requireExtension,
} from "../../../../src/lib/server/auth/extension-guard";
import {
  createExtensionToken,
  revokeExtensionToken,
} from "../../../../src/lib/server/auth/extension-token";
import { verifyEditorPassword } from "../../../../src/lib/server/auth/password";
import { loginBodySchema } from "../../../../src/lib/server/auth/schemas";
import { getEditorPassword, getSessionSecret } from "../../../../src/lib/server/auth/secrets";
import {
  checkLoginThrottle,
  loginClientFromRequest,
  LOGIN_THROTTLE_SCOPE,
  recordLoginSuccess,
  reserveLoginAttempt,
  type LoginReservation,
} from "../../../../src/lib/server/auth/throttle";
import { getDatabase } from "../../../../src/lib/server/db/client";
import { ERRORS, jsonError, readBoundedJson } from "../../../../src/lib/server/http";

/** The token the local-only bypass hands out; any bearer passes under it. */
const BYPASS_TOKEN = "auth-disabled-local";

function noStore(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  return response;
}

function throttledResponse(retryAfterMs: number): Response {
  const response = jsonError(429, ERRORS.throttled);
  response.headers.set("retry-after", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return response;
}

export async function POST(request: Request): Promise<Response> {
  const body = await readBoundedJson(request, AUTH_REQUEST_MAX_BYTES);
  if (!body.ok) {
    const status = body.error === "too-large" ? 413 : body.error === "content-type" ? 415 : 400;
    return jsonError(status, ERRORS.invalidRequest);
  }
  const parsed = loginBodySchema.safeParse(body.value);
  if (!parsed.success) return jsonError(400, ERRORS.invalidRequest);

  // The local-only bypass (D052) signs the editor in without a password on
  // the page, so it does here too; the flag is ignored on Vercel.
  if (isAuthDisabled()) {
    const expiresAt = new Date(Date.now() + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS).toISOString();
    return noStore(Response.json({ token: BYPASS_TOKEN, expiresAt }, { status: 201 }));
  }

  const db = getDatabase();
  if (!db) return jsonError(503, ERRORS.unavailable);
  const secret = getSessionSecret();
  if (!secret) return jsonError(503, ERRORS.unavailable);

  const client = loginClientFromRequest(request);
  let reservation: LoginReservation;
  try {
    const throttle = await checkLoginThrottle(db, Date.now(), LOGIN_THROTTLE_SCOPE, client);
    if (throttle.throttled) return throttledResponse(throttle.retryAfterMs);
    reservation = await reserveLoginAttempt(db, Date.now(), LOGIN_THROTTLE_SCOPE, client);
    if (reservation.throttled) return throttledResponse(reservation.retryAfterMs);
  } catch {
    return jsonError(503, ERRORS.unavailable);
  }

  if (!verifyEditorPassword(parsed.data.password, getEditorPassword())) {
    return jsonError(401, ERRORS.wrongPassword);
  }

  try {
    await recordLoginSuccess(db, reservation, Date.now(), LOGIN_THROTTLE_SCOPE, client);
  } catch {
    return jsonError(503, ERRORS.unavailable);
  }

  const { token, payload } = createExtensionToken(secret, Date.now());
  return noStore(
    Response.json({ token, expiresAt: new Date(payload.exp).toISOString() }, { status: 201 }),
  );
}

export async function GET(request: Request): Promise<Response> {
  const auth = requireExtension(request);
  if (!auth.ok) return noStore(auth.response);
  const exp =
    auth.renewal?.exp ?? auth.payload?.exp ?? Date.now() + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS;
  return noStore(
    appendExtensionRenewal(Response.json({ expiresAt: new Date(exp).toISOString() }), auth.renewal),
  );
}

export async function DELETE(request: Request): Promise<Response> {
  const auth = requireExtension(request);
  if (!auth.ok) return noStore(auth.response);
  if (auth.payload) revokeExtensionToken(auth.payload.sid, auth.payload.exp);
  return noStore(new Response(null, { status: 204 }));
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
