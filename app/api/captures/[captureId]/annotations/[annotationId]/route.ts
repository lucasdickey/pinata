// /api/captures/[captureId]/annotations/[annotationId] — move one pin
// (VAL-CANVAS-008 commit half, VAL-PIN-002 boundary half).
//
// The route names both the capture and the pin, and the store honors that
// binding: a pin addressed through another capture's route is simply not
// found, never rebound to a different plane. A move is one revisioned write
// of the clamped natural-pixel tip; number, body, capture binding, and
// metadata snapshot are untouched by it.
//
// Boundary order matches every other mutation: same-origin Origin, session +
// CSRF, content type and hard byte cap, strict schema, then the durable
// write. Errors are bounded and generic.

import { ANNOTATION_REQUEST_MAX_BYTES } from "../../../../../../src/lib/boundaries";
import { sessionCookie } from "../../../../../../src/lib/server/auth/cookies";
import { requireEditorMutation } from "../../../../../../src/lib/server/auth/guard";
import { movePin } from "../../../../../../src/lib/server/annotations/pins";
import { movePinBodySchema } from "../../../../../../src/lib/server/annotations/schemas";
import { getDatabase } from "../../../../../../src/lib/server/db/client";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
  readBoundedJson,
} from "../../../../../../src/lib/server/http";

interface RouteContext {
  params: Promise<{ captureId: string; annotationId: string }>;
}

function withRenewal(response: Response, renewedToken: string | null, secure: boolean): Response {
  if (renewedToken) response.headers.append("set-cookie", sessionCookie(renewedToken, secure));
  return response;
}

/** Commit the drag-end tip of one pin as a single revisioned update. */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);

  const auth = requireEditorMutation(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const deny = (status: number, message: string) =>
    withRenewal(jsonError(status, message), auth.renewedToken, secure);

  const body = await readBoundedJson(request, ANNOTATION_REQUEST_MAX_BYTES);
  if (!body.ok) {
    const status = body.error === "too-large" ? 413 : body.error === "content-type" ? 415 : 400;
    return deny(status, ERRORS.invalidRequest);
  }
  const parsed = movePinBodySchema.safeParse(body.value);
  if (!parsed.success) return deny(400, ERRORS.invalidRequest);

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);

  const { captureId, annotationId } = await context.params;
  let result;
  try {
    result = await movePin(db, { captureId, annotationId, tip: parsed.data.tip });
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  if (!result.ok) {
    if (result.error === "not-found") return deny(404, ERRORS.rejected);
    return deny(400, ERRORS.invalidRequest);
  }

  return withRenewal(Response.json({ annotation: result.annotation }), auth.renewedToken, secure);
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const GET = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
