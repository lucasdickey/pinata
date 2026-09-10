// POST /api/founder/[publicId]/session — the one-time exchange of a founder
// link's fragment token for a founder capability session (REQUIREMENTS 7,
// ARCHITECTURE "Founder").
//
// The token never travels in a path or query string: the founder page reads
// it from the URL fragment, scrubs the fragment, and posts it here exactly
// once over the same origin. Boundary order: exact same-origin Origin,
// application/json content type, hard byte cap, strict schema, then the
// timing-safe digest comparison against the live project row. Every failure
// — unknown or tombstoned project, revoked or never-issued capability, wrong
// or rotated token — is the same bounded generic 404 that echoes nothing,
// so the route is not an oracle for project existence. Success sets the
// HttpOnly founder session cookie bound to the project and capability
// version, plus the browser-readable CSRF proof.

import { AUTH_REQUEST_MAX_BYTES } from "../../../../../src/lib/boundaries";
import { getSessionSecret } from "../../../../../src/lib/server/auth/secrets";
import { getDatabase } from "../../../../../src/lib/server/db/client";
import { exchangeFounderToken } from "../../../../../src/lib/server/founder/capability";
import {
  founderCsrfCookie,
  founderSessionCookie,
} from "../../../../../src/lib/server/founder/cookies";
import { createFounderSession } from "../../../../../src/lib/server/founder/session";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
  readBoundedJson,
} from "../../../../../src/lib/server/http";
import { founderExchangeBodySchema } from "../../../../../src/lib/server/threads/schemas";

interface RouteContext {
  params: Promise<{ publicId: string }>;
}

/** Founder responses are never cacheable: authority is revocable. */
function noStore(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!hasSameOrigin(request)) return noStore(jsonError(403, ERRORS.rejected));

  const body = await readBoundedJson(request, AUTH_REQUEST_MAX_BYTES);
  if (!body.ok) {
    const status = body.error === "too-large" ? 413 : body.error === "content-type" ? 415 : 400;
    return noStore(jsonError(status, ERRORS.invalidRequest));
  }
  const parsed = founderExchangeBodySchema.safeParse(body.value);
  if (!parsed.success) return noStore(jsonError(400, ERRORS.invalidRequest));

  // Fail closed on configuration before any lookup, so a misconfigured
  // deployment cannot serve as a token or project oracle.
  const secret = getSessionSecret();
  if (!secret) return noStore(jsonError(503, ERRORS.unavailable));
  const db = getDatabase();
  if (!db) return noStore(jsonError(503, ERRORS.unavailable));

  const { publicId } = await context.params;
  let grant;
  try {
    grant = await exchangeFounderToken(db, publicId, parsed.data.token);
  } catch {
    return noStore(jsonError(503, ERRORS.unavailable));
  }
  if (!grant) return noStore(jsonError(404, ERRORS.rejected));

  const secure = isSecureRequest(request);
  const { token, payload } = createFounderSession(
    secret,
    { projectId: grant.projectId, version: grant.version },
    Date.now(),
  );
  const response = Response.json({ ok: true, expiresAt: new Date(payload.exp).toISOString() });
  response.headers.append("set-cookie", founderSessionCookie(token, secure));
  response.headers.append("set-cookie", founderCsrfCookie(payload.csrf, secure));
  return noStore(response);
}

function methodNotAllowed(): Response {
  return noStore(jsonError(405, ERRORS.invalidRequest));
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
