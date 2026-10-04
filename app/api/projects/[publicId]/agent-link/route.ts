// /api/projects/[publicId]/agent-link — the editor's control over one
// project's agent link (D121).
//
// GET reads the status (none / active / revoked, plus the version). POST
// creates the link, or rotates it so the old one stops working, and returns
// its path — token included — exactly once; the server keeps only the
// SHA-256 digest. DELETE revokes it. The founder link is never touched.
//
// Editor-only, with the standard mutation boundary: same-origin Origin,
// session + CSRF proof. POST and DELETE carry no body. A missing or
// tombstoned project is the same generic 404 as every other project read.

import {
  appendEditorRenewal,
  type SessionRenewal,
} from "../../../../../src/lib/server/auth/cookies";
import {
  requireEditor,
  requireEditorMutation,
} from "../../../../../src/lib/server/auth/guard";
import { getDatabase } from "../../../../../src/lib/server/db/client";
import {
  issueAgentLink,
  readAgentLinkStatus,
  revokeAgentLink,
} from "../../../../../src/lib/server/agent/link";
import { agentLinkPath } from "../../../../../src/lib/server/agent/respond";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
} from "../../../../../src/lib/server/http";

interface RouteContext {
  params: Promise<{ publicId: string }>;
}

function withRenewal(response: Response, renewal: SessionRenewal | null, secure: boolean): Response {
  response.headers.set("cache-control", "no-store");
  return appendEditorRenewal(response, renewal, secure);
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = requireEditor(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const deny = (status: number, message: string) =>
    withRenewal(jsonError(status, message), auth.renewal, secure);

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);

  const { publicId } = await context.params;
  let link;
  try {
    link = await readAgentLinkStatus(db, publicId);
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  if (!link) return deny(404, ERRORS.rejected);
  return withRenewal(Response.json({ link }), auth.renewal, secure);
}

/** Create or rotate the link; its path (token included) is shown exactly once. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);

  const auth = requireEditorMutation(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const deny = (status: number, message: string) =>
    withRenewal(jsonError(status, message), auth.renewal, secure);

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);

  const { publicId } = await context.params;
  let issued;
  try {
    issued = await issueAgentLink(db, publicId, Date.now());
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  if (!issued) return deny(404, ERRORS.rejected);

  return withRenewal(
    Response.json(
      { link: issued.status, path: agentLinkPath(issued.token) },
      { status: 201 },
    ),
    auth.renewal,
    secure,
  );
}

/** Revoke the link; nothing else changes. */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);

  const auth = requireEditorMutation(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const deny = (status: number, message: string) =>
    withRenewal(jsonError(status, message), auth.renewal, secure);

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);

  const { publicId } = await context.params;
  let result;
  try {
    result = await revokeAgentLink(db, publicId, Date.now());
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  if (!result.ok) {
    return result.error === "not-found" ? deny(404, ERRORS.rejected) : deny(409, ERRORS.rejected);
  }
  return withRenewal(Response.json({ link: result.status }), auth.renewal, secure);
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
