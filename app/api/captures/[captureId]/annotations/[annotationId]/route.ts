// /api/captures/[captureId]/annotations/[annotationId] — move, resize, edit,
// and delete one annotation, pin or rectangle (VAL-PIN-002, VAL-PIN-008,
// VAL-PIN-009, D079).
//
// The route names both the capture and the annotation, and the store honors
// that binding: one addressed through another capture's route is simply not
// found, never rebound to a different plane. Every mutation carries an
// expectedRevision precondition and commits as one conditional atomic
// write: a stale or concurrent write loses with a 409 and changes no row,
// so exactly one authoritative revision ever exists. A geometry write
// touches only the clamped natural-pixel tip (pins) or box (rectangles) and
// must match the annotation's kind; an edit touches only the original body;
// number, capture binding, and the immutable context snapshot survive both.
// Delete is a tombstone: the row stays so its number is never reused.
//
// Boundary order matches every other mutation: same-origin Origin, session +
// CSRF, content type and hard byte cap, strict schema, then the durable
// write. Errors are bounded and generic.

import { ANNOTATION_REQUEST_MAX_BYTES } from "../../../../../../src/lib/boundaries";
import { sessionCookie } from "../../../../../../src/lib/server/auth/cookies";
import { requireEditorMutation } from "../../../../../../src/lib/server/auth/guard";
import {
  deletePin,
  updatePin,
} from "../../../../../../src/lib/server/annotations/pins";
import {
  deleteAnnotationBodySchema,
  updateAnnotationBodySchema,
} from "../../../../../../src/lib/server/annotations/schemas";
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

type Deny = (status: number, message: string) => Response;

/**
 * Shared boundary pipeline for the item mutations: origin, session + CSRF,
 * bounded JSON, then the handler's own schema and store call. Every
 * response — success or denial — carries the session renewal cookie.
 */
async function withMutationBoundary(
  request: Request,
  handler: (body: unknown, deny: Deny) => Promise<Response>,
): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);

  const auth = requireEditorMutation(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const deny: Deny = (status, message) =>
    withRenewal(jsonError(status, message), auth.renewedToken, secure);

  const body = await readBoundedJson(request, ANNOTATION_REQUEST_MAX_BYTES);
  if (!body.ok) {
    const status = body.error === "too-large" ? 413 : body.error === "content-type" ? 415 : 400;
    return deny(status, ERRORS.invalidRequest);
  }
  const response = await handler(body.value, deny);
  return withRenewal(response, auth.renewedToken, secure);
}

/** Move/resize and/or edit one annotation as a single revisioned write. */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return withMutationBoundary(request, async (value, deny) => {
    const parsed = updateAnnotationBodySchema.safeParse(value);
    if (!parsed.success) return deny(400, ERRORS.invalidRequest);

    const db = getDatabase();
    if (!db) return deny(503, ERRORS.unavailable);

    const { captureId, annotationId } = await context.params;
    let result;
    try {
      result = await updatePin(db, {
        captureId,
        annotationId,
        expectedRevision: parsed.data.expectedRevision,
        tip: parsed.data.tip,
        rect: parsed.data.rect,
        body: parsed.data.body,
      });
    } catch {
      return deny(503, ERRORS.unavailable);
    }
    if (!result.ok) {
      if (result.error === "not-found") return deny(404, ERRORS.rejected);
      if (result.error === "invalid") return deny(400, ERRORS.invalidRequest);
      // Stale/concurrent write: bounded, generic, and nothing changed.
      return deny(409, ERRORS.rejected);
    }

    return Response.json({ annotation: result.annotation });
  });
}

/** Tombstone one annotation. The row — and its retired number — persist. */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return withMutationBoundary(request, async (value, deny) => {
    const parsed = deleteAnnotationBodySchema.safeParse(value);
    if (!parsed.success) return deny(400, ERRORS.invalidRequest);

    const db = getDatabase();
    if (!db) return deny(503, ERRORS.unavailable);

    const { captureId, annotationId } = await context.params;
    let result;
    try {
      result = await deletePin(db, {
        captureId,
        annotationId,
        expectedRevision: parsed.data.expectedRevision,
      });
    } catch {
      return deny(503, ERRORS.unavailable);
    }
    if (!result.ok) {
      if (result.error === "not-found") return deny(404, ERRORS.rejected);
      return deny(409, ERRORS.rejected);
    }

    return Response.json({ deleted: true });
  });
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const GET = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
