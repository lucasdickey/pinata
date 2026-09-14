// GET /api/founder/[publicId] — the founder's read of one shared project's
// page/device hierarchy (REQUIREMENTS 7, VAL-THREAD-005).
//
// Authority is live and bound: the founder session must verify, its
// project/version binding must still be current in the durable store (a
// rotated or revoked capability fails here on the very next request), and
// the addressed public id must be the session's own project — a foreign
// public id is the same generic denial as no session at all. The hierarchy
// shape is the editor's; the founder client simply never renders editing
// affordances.

import { founderViewer } from "../../../../src/lib/server/annotations/seen";
import { getDatabase } from "../../../../src/lib/server/db/client";
import { founderSessionCookie } from "../../../../src/lib/server/founder/cookies";
import { requireFounder } from "../../../../src/lib/server/founder/guard";
import { ERRORS, isSecureRequest, jsonError } from "../../../../src/lib/server/http";
import { readProjectHierarchy } from "../../../../src/lib/server/projects/hierarchy";

interface RouteContext {
  params: Promise<{ publicId: string }>;
}

function finish(response: Response, renewedToken: string | null, secure: boolean): Response {
  response.headers.set("cache-control", "no-store");
  if (renewedToken) {
    response.headers.append("set-cookie", founderSessionCookie(renewedToken, secure));
  }
  return response;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const db = getDatabase();
  if (!db) return finish(jsonError(503, ERRORS.unavailable), null, false);

  const auth = await requireFounder(request, db);
  if (!auth.ok) return finish(auth.response, null, false);
  const secure = isSecureRequest(request);

  const { publicId } = await context.params;
  let project;
  try {
    // Feedback counts (D075) are the founder's own: unread means unread by
    // this capability version, not by the editor.
    project = await readProjectHierarchy(
      db,
      publicId,
      Date.now(),
      founderViewer(auth.session.ver),
    );
  } catch {
    return finish(jsonError(503, ERRORS.unavailable), auth.renewedToken, secure);
  }
  // The session is bound to one project; any other public id — existing or
  // not — is the same generic denial as an anonymous read.
  if (!project || project.projectId !== auth.session.pid) {
    return finish(jsonError(401, ERRORS.authRequired), auth.renewedToken, secure);
  }
  return finish(
    Response.json({ actor: "founder", project }),
    auth.renewedToken,
    secure,
  );
}

function methodNotAllowed(): Response {
  const response = jsonError(405, ERRORS.invalidRequest);
  response.headers.set("cache-control", "no-store");
  return response;
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
