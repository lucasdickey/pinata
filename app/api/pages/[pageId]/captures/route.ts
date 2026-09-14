// /api/pages/[pageId]/captures — create one scoped capture attempt.
//
// The retry is deliberately narrow: it names exactly one page and one
// viewport, so a failing Desktop capture is retried without resubmitting the
// Mobile sibling or any other page (VAL-PROJECT-005). It creates a new
// attempt row rather than rewriting the terminal one, so old images,
// manifests, hashes, and annotations stay addressable (VAL-CAPTURE-008).
//
// Boundary order matches every other mutation: same-origin Origin, session +
// CSRF, content type and hard byte cap, strict schema, then the durable,
// target-bound idempotent write. No provider call is issued before the
// response: once the attempt is committed the server continues on its own
// and drives the project's pending attempts after the response (D076).

import { CAPTURE_REQUEST_MAX_BYTES } from "../../../../../src/lib/boundaries";
import { sessionCookie } from "../../../../../src/lib/server/auth/cookies";
import { requireEditorMutation } from "../../../../../src/lib/server/auth/guard";
import { getCaptureDriveDeps } from "../../../../../src/lib/server/captures/deps";
import { driveProject, projectIdForPage } from "../../../../../src/lib/server/captures/drive";
import { retryCapture } from "../../../../../src/lib/server/captures/retry";
import { retryCaptureBodySchema } from "../../../../../src/lib/server/captures/schemas";
import { getDatabase } from "../../../../../src/lib/server/db/client";
import {
  ERRORS,
  hasSameOrigin,
  isSecureRequest,
  jsonError,
  readBoundedJson,
} from "../../../../../src/lib/server/http";

// The retried attempt runs after the response, inside this function's budget
// (see the dispatch route's note on the value).
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ pageId: string }>;
}

function withRenewal(response: Response, renewedToken: string | null, secure: boolean): Response {
  if (renewedToken) response.headers.append("set-cookie", sessionCookie(renewedToken, secure));
  return response;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!hasSameOrigin(request)) return jsonError(403, ERRORS.rejected);

  const auth = requireEditorMutation(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const deny = (status: number, message: string) =>
    withRenewal(jsonError(status, message), auth.renewedToken, secure);

  const body = await readBoundedJson(request, CAPTURE_REQUEST_MAX_BYTES);
  if (!body.ok) {
    const status = body.error === "too-large" ? 413 : body.error === "content-type" ? 415 : 400;
    return deny(status, ERRORS.invalidRequest);
  }
  const parsed = retryCaptureBodySchema.safeParse(body.value);
  if (!parsed.success) return deny(400, ERRORS.invalidRequest);

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);

  const { pageId } = await context.params;
  let result;
  try {
    result = await retryCapture(db, {
      pageId,
      variant: parsed.data.variant,
      idempotencyKey: parsed.data.idempotencyKey,
    });
  } catch {
    return deny(503, ERRORS.unavailable);
  }
  if (!result.ok) {
    // A missing page and an existing one the caller may not retry are told
    // apart only by whether the record exists at all; both answers are the
    // same bounded generic message.
    if (result.error === "not-found") return deny(404, ERRORS.rejected);
    if (result.error === "quota") return deny(429, ERRORS.rejected);
    return deny(409, ERRORS.rejected);
  }

  // The attempt is committed; capture continues after the response is
  // written. A replayed key drives too, in case the earlier continuation
  // never ran.
  const projectId = await projectIdForPage(db, pageId).catch(() => null);
  if (projectId) {
    const drive = getCaptureDriveDeps();
    drive.after(async () => {
      await driveProject(db, projectId, drive);
    });
  }

  const response = Response.json(
    { attempt: result.attempt },
    { status: result.created ? 201 : 200 },
  );
  return withRenewal(response, auth.renewedToken, secure);
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
