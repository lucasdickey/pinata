// POST /api/auth/login — the only way to establish an editor session.
//
// Boundary order (VAL-AUTH-001, VAL-AUTH-006, VAL-AUTH-007, D098): exact
// same-origin Origin, application/json content type, hard byte cap, strict
// schema, fail-closed store and secret checks, a read-only throttle
// pre-check, an atomic attempt reservation, and only then the server-only
// timing-safe verifier. Every failure is a bounded generic response that
// echoes nothing; only a valid password sets session cookies.

import { AUTH_REQUEST_MAX_BYTES } from "../../../../src/lib/boundaries";
import { csrfCookie, sessionCookie } from "../../../../src/lib/server/auth/cookies";
import { verifyEditorPassword } from "../../../../src/lib/server/auth/password";
import { loginBodySchema } from "../../../../src/lib/server/auth/schemas";
import { getEditorPassword, getSessionSecret } from "../../../../src/lib/server/auth/secrets";
import { createEditorSession } from "../../../../src/lib/server/auth/session";
import {
  checkLoginThrottle,
  loginClientFromRequest,
  LOGIN_THROTTLE_SCOPE,
  recordLoginSuccess,
  reserveLoginAttempt,
  type LoginReservation,
} from "../../../../src/lib/server/auth/throttle";
import { getDatabase } from "../../../../src/lib/server/db/client";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
  readBoundedJson,
} from "../../../../src/lib/server/http";

/** Bounded generic 429 with the standard retry guidance header. */
function throttledResponse(retryAfterMs: number): Response {
  const response = jsonError(429, ERRORS.throttled);
  response.headers.set("retry-after", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return response;
}

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);

  const body = await readBoundedJson(request, AUTH_REQUEST_MAX_BYTES);
  if (!body.ok) {
    const status = body.error === "too-large" ? 413 : body.error === "content-type" ? 415 : 400;
    return jsonError(status, ERRORS.invalidRequest);
  }
  const parsed = loginBodySchema.safeParse(body.value);
  if (!parsed.success) return jsonError(400, ERRORS.invalidRequest);

  // The durable store is the guard of record for throttling (VAL-AUTH-006);
  // without it the route fails closed rather than allowing unaccounted
  // attempts.
  const db = getDatabase();
  if (!db) return jsonError(503, ERRORS.unavailable);

  // Check the signing secret before verifying the password so a
  // misconfigured deployment cannot serve as a password-correctness oracle:
  // every attempt receives the identical bounded 503. It also runs before
  // the reservation (D098), so misconfiguration is never counted as abuse
  // and cannot throttle anyone. Fail closed when either editor auth secret
  // is absent — no variable names, no default credential.
  const secret = getSessionSecret();
  if (!secret) return jsonError(503, ERRORS.unavailable);

  // Per-client and global buckets (D098); the client is a digest-keyed
  // address, never stored or echoed.
  const client = loginClientFromRequest(request);
  let reservation: LoginReservation;
  try {
    // Already throttled: reject untouched, so rejected attempts neither
    // inflate the counts nor extend a window.
    const throttle = await checkLoginThrottle(db, Date.now(), LOGIN_THROTTLE_SCOPE, client);
    if (throttle.throttled) return throttledResponse(throttle.retryAfterMs);
    // Reserve the attempt atomically BEFORE verifying (D098). Parallel
    // requests can all pass the read above; only the reservation's returned
    // count decides which of them may reach the verifier.
    reservation = await reserveLoginAttempt(db, Date.now(), LOGIN_THROTTLE_SCOPE, client);
    if (reservation.throttled) return throttledResponse(reservation.retryAfterMs);
  } catch {
    return jsonError(503, ERRORS.unavailable);
  }

  // A mismatch leaves its reservation standing: that is the failure count.
  if (!verifyEditorPassword(parsed.data.password, getEditorPassword())) {
    return jsonError(401, ERRORS.wrongPassword);
  }

  try {
    await recordLoginSuccess(db, reservation, Date.now(), LOGIN_THROTTLE_SCOPE, client);
  } catch {
    return jsonError(503, ERRORS.unavailable);
  }

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
