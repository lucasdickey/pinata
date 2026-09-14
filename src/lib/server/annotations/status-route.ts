// The shared handler behind the three per-pin feedback routes (D075):
//
//   POST /api/captures/[captureId]/annotations/[annotationId]/resolve
//   POST /api/captures/[captureId]/annotations/[annotationId]/reopen
//   POST /api/captures/[captureId]/annotations/[annotationId]/seen
//
// Each is authorized for the editor session and for a founder capability
// session bound to the capture's project, with the same same-origin and
// CSRF checks the thread append route uses. None of them reads a request
// body: the route path is the whole intent, and every piece of text the
// change writes is generated on the server. The founder capability grants
// exactly reply, resolve, reopen, and seen; create, move, edit, and delete
// stay editor-only in their own routes.

import { getDatabase } from "../db/client";
import { authorizeCaptureReplier, type CaptureActor } from "../founder/reader";
import { ERRORS, hasSameOrigin, isSecureRequest, jsonError } from "../http";
import { markPinSeen } from "./seen";
import { setPinStatus, type PinStatusAction } from "./status";

interface RouteContext {
  params: Promise<{ captureId: string; annotationId: string }>;
}

export type PinFeedbackAction = PinStatusAction | "seen";

function finish(response: Response, actor: CaptureActor | null): Response {
  response.headers.set("cache-control", "no-store");
  if (actor?.renewCookie) response.headers.append("set-cookie", actor.renewCookie);
  return response;
}

/** Build the POST handler for one of the feedback actions. */
export function pinFeedbackHandler(action: PinFeedbackAction) {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);
    const secure = isSecureRequest(request);
    const db = getDatabase();
    const { captureId, annotationId } = await context.params;
    const auth = await authorizeCaptureReplier(request, db, captureId, secure);
    if (!auth.ok) return finish(auth.response, null);
    const actor = auth.actor;
    const deny = (status: number, message: string) => finish(jsonError(status, message), actor);
    if (!db) return deny(503, ERRORS.unavailable);

    try {
      if (action === "seen") {
        const result = await markPinSeen(db, { captureId, annotationId }, actor.viewer, Date.now());
        if (!result.ok) return deny(404, ERRORS.rejected);
        return finish(Response.json({ seen: true }), actor);
      }
      const result = await setPinStatus(db, {
        captureId,
        annotationId,
        action,
        actorRole: actor.role,
        viewer: actor.viewer,
      });
      if (!result.ok) return deny(404, ERRORS.rejected);
      return finish(
        Response.json({ annotation: result.annotation, entry: result.entry }),
        actor,
      );
    } catch {
      return deny(503, ERRORS.unavailable);
    }
  };
}

/** The 405 every other method on these routes answers with. */
export function feedbackMethodNotAllowed(): Response {
  const response = jsonError(405, ERRORS.invalidRequest);
  response.headers.set("cache-control", "no-store");
  return response;
}
