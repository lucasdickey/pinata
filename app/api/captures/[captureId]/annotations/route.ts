// /api/captures/[captureId]/annotations — list and create pins on one
// immutable ready capture (VAL-PIN-001, VAL-CANVAS-001).
//
// Pins bind to exactly one capture's coordinate plane: the route names the
// capture, and the store refuses pending/failed/missing captures with the
// same generic 404, so non-ready attempts are never annotatable. Create is
// durable-idempotent and assigns the server-side monotonic per-capture
// number inside the transaction — cancelled or failed drafts consume no
// number, and deleted numbers are never reused.
//
// Boundary order matches every other mutation: same-origin Origin, session +
// CSRF, content type and hard byte cap, strict schema, then the durable
// write. Errors are bounded and generic; nothing echoes request input.

import { ANNOTATION_REQUEST_MAX_BYTES } from "../../../../../src/lib/boundaries";
import { sessionCookie } from "../../../../../src/lib/server/auth/cookies";
import { requireEditorMutation } from "../../../../../src/lib/server/auth/guard";
import {
  createPinAtomically,
  listPins,
} from "../../../../../src/lib/server/annotations/pins";
import { createPinBodySchema } from "../../../../../src/lib/server/annotations/schemas";
import { getDatabase } from "../../../../../src/lib/server/db/client";
import { authorizeCaptureReader } from "../../../../../src/lib/server/founder/reader";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
  readBoundedJson,
} from "../../../../../src/lib/server/http";

interface RouteContext {
  params: Promise<{ captureId: string }>;
}

function withRenewal(response: Response, renewedToken: string | null, secure: boolean): Response {
  if (renewedToken) response.headers.append("set-cookie", sessionCookie(renewedToken, secure));
  return response;
}

/**
 * List the live pins of one ready capture, numbered in stable order. This
 * is the founder's read path too: a founder session bound to the capture's
 * project is admitted alongside the editor, and every other caller gets the
 * editor-only denial this route always answered.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  // A safe method needs no Origin/CSRF proof, but authority is always live:
  // the session is verified here, immediately before any lookup.
  const secure = isSecureRequest(request);
  const db = getDatabase();
  const { captureId } = await context.params;
  const auth = await authorizeCaptureReader(request, db, captureId, secure);
  if (!auth.ok) return auth.response;
  const finish = (response: Response) => {
    if (auth.actor.renewCookie) response.headers.append("set-cookie", auth.actor.renewCookie);
    return response;
  };

  if (!db) return finish(jsonError(503, ERRORS.unavailable));

  let result;
  try {
    result = await listPins(db, captureId);
  } catch {
    return finish(jsonError(503, ERRORS.unavailable));
  }
  if (!result.ok) return finish(jsonError(404, ERRORS.rejected));
  return finish(Response.json({ annotations: result.annotations }));
}

/** Create one pin: one tip, one bounded comment, one idempotency key. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
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
  const parsed = createPinBodySchema.safeParse(body.value);
  if (!parsed.success) return deny(400, ERRORS.invalidRequest);

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);

  const { captureId } = await context.params;
  let result;
  try {
    result = await createPinAtomically(db, {
      captureId,
      tip: parsed.data.tip,
      body: parsed.data.body,
      elementId: parsed.data.elementId,
      idempotencyKey: parsed.data.idempotencyKey,
    });
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  if (!result.ok) {
    // A missing/non-ready capture and every other refusal are bounded and
    // generic: the answer never names the capture, the payload, or internals.
    if (result.error === "not-found") return deny(404, ERRORS.rejected);
    if (result.error === "invalid") return deny(400, ERRORS.invalidRequest);
    if (result.error === "quota") return deny(429, ERRORS.rejected);
    return deny(409, ERRORS.rejected);
  }

  const response = Response.json(
    { annotation: result.annotation },
    { status: result.created ? 201 : 200 },
  );
  return withRenewal(response, auth.renewedToken, secure);
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
