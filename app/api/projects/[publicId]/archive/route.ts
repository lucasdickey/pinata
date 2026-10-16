// /api/projects/[publicId]/archive — take a project out of the editor's
// project list (D108).
//
// POST archives. Nothing else about the project changes: pages, captures,
// pins, threads, and the founder link all stay as they were (D110).
// DELETE restores an archived project to the active list.
//
// Editor-only, with the standard mutation boundary: same-origin Origin,
// session + CSRF proof. POST carries no body. A missing or tombstoned
// project is the same generic 404 as every other project read.

import {
  appendEditorRenewal,
  type SessionRenewal,
} from "../../../../../src/lib/server/auth/cookies";
import { requireEditorMutation } from "../../../../../src/lib/server/auth/guard";
import { getDatabase } from "../../../../../src/lib/server/db/client";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
} from "../../../../../src/lib/server/http";
import { archiveProject, unarchiveProject } from "../../../../../src/lib/server/projects/archive";

interface RouteContext {
  params: Promise<{ publicId: string }>;
}

function withRenewal(response: Response, renewal: SessionRenewal | null, secure: boolean): Response {
  response.headers.set("cache-control", "no-store");
  return appendEditorRenewal(response, renewal, secure);
}

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
  let result;
  try {
    result = await archiveProject(db, publicId, Date.now());
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  if (!result.ok) return deny(404, ERRORS.rejected);
  return withRenewal(
    Response.json({ archived: { publicId, archivedAt: result.archivedAt } }),
    auth.renewal,
    secure,
  );
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
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
  try {
    const result = await unarchiveProject(db, publicId, Date.now());
    if (!result.ok) return deny(404, ERRORS.rejected);
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  return withRenewal(Response.json({ unarchived: { publicId } }), auth.renewal, secure);
}
