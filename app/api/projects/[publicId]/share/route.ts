// /api/projects/[publicId]/share — the editor's control over one project's
// founder capability (REQUIREMENTS 7, VAL-THREAD-005).
//
// GET reads the status (none / active / revoked, plus the capability
// version). POST issues the capability — a first link, or a rotation that
// replaces the digest, increments the version, and thereby ends every
// existing founder session — and returns the raw token exactly once; the
// server persists only the SHA-256 digest and can never show the token
// again. DELETE revokes: the digest is cleared and the revocation stamped,
// while every page, capture, pin, and thread entry stays intact.
//
// Editor-only, with the standard mutation boundary: same-origin Origin,
// session + CSRF proof. POST and DELETE carry no body. A missing or
// tombstoned project is the same generic 404 as every other project read.

import { sessionCookie } from "../../../../../src/lib/server/auth/cookies";
import {
  requireEditor,
  requireEditorMutation,
} from "../../../../../src/lib/server/auth/guard";
import { getDatabase } from "../../../../../src/lib/server/db/client";
import {
  issueFounderCapability,
  readShareStatus,
  revokeFounderCapability,
} from "../../../../../src/lib/server/founder/capability";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
} from "../../../../../src/lib/server/http";

interface RouteContext {
  params: Promise<{ publicId: string }>;
}

function withRenewal(response: Response, renewedToken: string | null, secure: boolean): Response {
  response.headers.set("cache-control", "no-store");
  if (renewedToken) response.headers.append("set-cookie", sessionCookie(renewedToken, secure));
  return response;
}

/** The founder route the link points at; the token rides in the fragment. */
export function founderLinkPath(publicId: string): string {
  return `/f/${encodeURIComponent(publicId)}`;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = requireEditor(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const deny = (status: number, message: string) =>
    withRenewal(jsonError(status, message), auth.renewedToken, secure);

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);

  const { publicId } = await context.params;
  let share;
  try {
    share = await readShareStatus(db, publicId);
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  if (!share) return deny(404, ERRORS.rejected);
  return withRenewal(Response.json({ share }), auth.renewedToken, secure);
}

/** Issue or rotate the capability; the token is shown exactly once. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);

  const auth = requireEditorMutation(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const deny = (status: number, message: string) =>
    withRenewal(jsonError(status, message), auth.renewedToken, secure);

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);

  const { publicId } = await context.params;
  let issued;
  try {
    issued = await issueFounderCapability(db, publicId, Date.now());
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  if (!issued) return deny(404, ERRORS.rejected);

  return withRenewal(
    Response.json(
      { share: issued.status, path: founderLinkPath(publicId), token: issued.token },
      { status: 201 },
    ),
    auth.renewedToken,
    secure,
  );
}

/** Revoke the capability; history is untouched. */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);

  const auth = requireEditorMutation(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const deny = (status: number, message: string) =>
    withRenewal(jsonError(status, message), auth.renewedToken, secure);

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);

  const { publicId } = await context.params;
  let result;
  try {
    result = await revokeFounderCapability(db, publicId, Date.now());
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  if (!result.ok) {
    return result.error === "not-found" ? deny(404, ERRORS.rejected) : deny(409, ERRORS.rejected);
  }
  return withRenewal(Response.json({ share: result.status }), auth.renewedToken, secure);
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
