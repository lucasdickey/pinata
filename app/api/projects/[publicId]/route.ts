// /api/projects/[publicId] — one project's durable page/device hierarchy.
//
// The workspace reads its whole organization from here on every load, so a
// reload, a process restart, or a redeployment returns the same public ID,
// root, normalized URLs, order, ownership, and capture attempts. Nothing in
// this path trusts browser-local state (VAL-PROJECT-003, VAL-PROJECT-004).

import { sessionCookie } from "../../../../src/lib/server/auth/cookies";
import { requireEditor } from "../../../../src/lib/server/auth/guard";
import { getDatabase } from "../../../../src/lib/server/db/client";
import { ERRORS, isSecureRequest, jsonError } from "../../../../src/lib/server/http";
import { readProjectHierarchy } from "../../../../src/lib/server/projects/hierarchy";

interface RouteContext {
  params: Promise<{ publicId: string }>;
}

function withRenewal(response: Response, renewedToken: string | null, secure: boolean): Response {
  if (renewedToken) response.headers.append("set-cookie", sessionCookie(renewedToken, secure));
  return response;
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
  let project;
  try {
    project = await readProjectHierarchy(db, publicId, Date.now());
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  // A tombstoned project and one that never existed are indistinguishable.
  if (!project) return deny(404, ERRORS.rejected);
  return withRenewal(Response.json({ project }), auth.renewedToken, secure);
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
