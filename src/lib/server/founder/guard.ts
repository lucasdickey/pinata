// Server-only founder authorization boundary. A founder read or reply calls
// one of these immediately before data access — never trusting client
// routing — and the binding is re-evaluated against the durable project row
// on every request: a rotated or revoked capability, a tombstoned project,
// and a foreign project all end in the same generic denial as an anonymous
// call, with no data and no hint of which check failed.
//
// Routes that admit either role (asset bytes, pin lists, thread reads) try
// the editor guard first and fall back to the founder guard only when a
// founder cookie is actually present, so the editor-only denial shape is
// byte-identical to what those routes answered before founders existed.

import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { EDITOR_CSRF_HEADER, FOUNDER_SESSION_COOKIE } from "../../auth-constants";
import { getSessionSecret } from "../auth/secrets";
import { schema, type Database } from "../db/client";
import { ERRORS, jsonError, parseCookieHeader } from "../http";
import { founderBindingIsCurrent } from "./capability";
import {
  renewFounderSessionToken,
  verifyFounderSessionToken,
  type FounderSessionPayload,
} from "./session";

export type FounderAuthResult =
  | { ok: true; session: FounderSessionPayload; renewedToken: string | null }
  | { ok: false; response: Response };

function denied(status: number, message: string): FounderAuthResult {
  return { ok: false, response: jsonError(status, message) };
}

/** True when the request carries a founder session cookie at all. */
export function hasFounderCookie(request: Request): boolean {
  return Boolean(parseCookieHeader(request.headers.get("cookie"))[FOUNDER_SESSION_COOKIE]);
}

/**
 * Authorize a founder read: a valid signed session whose project/version
 * binding is still current in the durable store. Returns a renewed token
 * when the session is inside its renewal threshold.
 */
export async function requireFounder(request: Request, db: Database): Promise<FounderAuthResult> {
  const secret = getSessionSecret();
  if (!secret) return denied(503, ERRORS.unavailable);
  const token = parseCookieHeader(request.headers.get("cookie"))[FOUNDER_SESSION_COOKIE];
  if (!token) return denied(401, ERRORS.authRequired);
  const result = verifyFounderSessionToken(token, secret, Date.now());
  if (result.status !== "valid") return denied(401, ERRORS.authRequired);
  // Live authority: rotation and revocation change the row, not the cookie.
  const current = await founderBindingIsCurrent(db, result.payload.pid, result.payload.ver);
  if (!current) return denied(401, ERRORS.authRequired);
  const renewedToken = result.renew
    ? renewFounderSessionToken(result.payload, secret, Date.now())
    : null;
  return { ok: true, session: result.payload, renewedToken };
}

/**
 * Authorize a founder mutation (a reply): a current session plus the
 * session-bound double-submit CSRF proof. The Origin check belongs to the
 * route, as it does for editor mutations.
 */
export async function requireFounderMutation(
  request: Request,
  db: Database,
): Promise<FounderAuthResult> {
  const base = await requireFounder(request, db);
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

/**
 * True when the capture belongs to the founder session's project. Resolved
 * through the project hierarchy so a capture of any other project — or no
 * project at all — is simply not the founder's.
 */
export async function founderOwnsCapture(
  db: Database,
  session: FounderSessionPayload,
  captureId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.captures.id })
    .from(schema.captures)
    .innerJoin(schema.pages, eq(schema.captures.pageId, schema.pages.id))
    .where(and(eq(schema.captures.id, captureId), eq(schema.pages.projectId, session.pid)))
    .limit(1);
  return rows.length === 1;
}

/**
 * Authorize a founder read of one capture: a current session that owns the
 * capture's project. A foreign capture is the same generic 401 as no
 * session — never a 404 that would confirm the capture exists.
 */
export async function requireFounderForCapture(
  request: Request,
  db: Database,
  captureId: string,
): Promise<FounderAuthResult> {
  const auth = await requireFounder(request, db);
  if (!auth.ok) return auth;
  if (!(await founderOwnsCapture(db, auth.session, captureId))) {
    return denied(401, ERRORS.authRequired);
  }
  return auth;
}

/** The mutation counterpart of requireFounderForCapture. */
export async function requireFounderMutationForCapture(
  request: Request,
  db: Database,
  captureId: string,
): Promise<FounderAuthResult> {
  const auth = await requireFounderMutation(request, db);
  if (!auth.ok) return auth;
  if (!(await founderOwnsCapture(db, auth.session, captureId))) {
    return denied(401, ERRORS.authRequired);
  }
  return auth;
}
