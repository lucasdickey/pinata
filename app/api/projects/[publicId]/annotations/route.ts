// GET /api/projects/[publicId]/annotations — every live pin in one project
// (D077), in page, device, version, number order, each carrying the capture
// it belongs to and the page and device that capture sits on.
//
// Editor session only for now: the founder view keeps its per-capture read.
// The answer is the same shape as the per-capture list plus the location
// fields, computed for the editor's unread counts, and never cached. A
// missing or tombstoned project is the same generic 404 as every other
// project read.

import { sessionCookie } from "../../../../../src/lib/server/auth/cookies";
import { requireEditor } from "../../../../../src/lib/server/auth/guard";
import { listProjectPins } from "../../../../../src/lib/server/annotations/project-pins";
import { getDatabase } from "../../../../../src/lib/server/db/client";
import { ERRORS, isSecureRequest, jsonError } from "../../../../../src/lib/server/http";

interface RouteContext {
  params: Promise<{ publicId: string }>;
}

function finish(response: Response, renewedToken: string | null, secure: boolean): Response {
  response.headers.set("cache-control", "no-store");
  if (renewedToken) response.headers.append("set-cookie", sessionCookie(renewedToken, secure));
  return response;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = requireEditor(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const deny = (status: number, message: string) =>
    finish(jsonError(status, message), auth.renewedToken, secure);

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);

  const { publicId } = await context.params;
  let result;
  try {
    result = await listProjectPins(db, publicId, Date.now());
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  if (!result.ok) return deny(404, ERRORS.rejected);
  return finish(
    Response.json({ annotations: result.annotations }),
    auth.renewedToken,
    secure,
  );
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
