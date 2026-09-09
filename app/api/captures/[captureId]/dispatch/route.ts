// POST /api/captures/[captureId]/dispatch — admit one pending attempt's
// target, claim it, capture it, and finalize it, in one request
// (VAL-CAPTURE-001 … VAL-CAPTURE-004, VAL-CAPTURE-007, VAL-CAPTURE-014).
//
// Boundary order matches every other mutation: same-origin Origin, editor
// session plus CSRF, hard byte cap, then the work. The route takes no request
// body — the attempt row already names the target — so nothing a caller sends
// can influence which URL is admitted.
//
// The provider runs in this same request, immediately after admission claims
// the attempt, and the response is only written once the row is `ready` or
// `failed`. That is deliberate: an admitted attempt must never be left as an
// open `capturing` claim waiting for a second call that may never come, and
// there is no separate claim endpoint to leave it open.
//
// Concurrency is admitted durably: when every Browserless slot is held the
// attempt is left `pending` and answered 429 with the quota-exceeded
// outcome's bounded retry guidance, so any later authorized client can
// resume it. An admitted attempt's lease is released here once execution has
// finalized the row; an abandoned lease expires at the published stale age
// and is reclaimed by the next claim.
//
// A rejected target answers with its catalog outcome: a bounded public
// message that names no host, no resolved address, and no provider detail.

import { CAPTURE_REQUEST_MAX_BYTES, captureOutcome } from "../../../../../src/lib/boundaries";
import { sessionCookie } from "../../../../../src/lib/server/auth/cookies";
import { requireEditorMutation } from "../../../../../src/lib/server/auth/guard";
import {
  getAdmissionDeps,
  getCaptureExecutionDeps,
} from "../../../../../src/lib/server/captures/deps";
import { dispatchCapture } from "../../../../../src/lib/server/captures/dispatch";
import { executeCapture } from "../../../../../src/lib/server/captures/execute";
import { releaseCaptureLease } from "../../../../../src/lib/server/captures/leases";
import { getDatabase } from "../../../../../src/lib/server/db/client";
import { ERRORS, hasSameOrigin, isSecureRequest, jsonError } from "../../../../../src/lib/server/http";

interface RouteContext {
  params: Promise<{ captureId: string }>;
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

  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isFinite(size) || size > CAPTURE_REQUEST_MAX_BYTES) {
      return deny(413, ERRORS.invalidRequest);
    }
  }

  const db = getDatabase();
  if (!db) return deny(503, ERRORS.unavailable);

  const { captureId } = await context.params;
  let result;
  try {
    result = await dispatchCapture(db, { captureId }, getAdmissionDeps());
  } catch {
    return deny(503, ERRORS.unavailable);
  }

  const outcomeResponse = (code: string) => {
    const outcome = captureOutcome(code);
    return withRenewal(
      Response.json(
        { error: outcome.publicMessage, code: outcome.code, remediation: outcome.remediation },
        { status: outcome.httpStatus ?? 502 },
      ),
      auth.renewedToken,
      secure,
    );
  };

  if (!result.ok) {
    if (result.error === "not-found") return deny(404, ERRORS.rejected);
    if (result.error === "not-dispatchable") return deny(409, ERRORS.rejected);
    // The shared concurrency limit is full: the attempt stays pending, and
    // the answer is the published quota outcome with its retry guidance.
    if (result.error === "quota") return outcomeResponse("quota-exceeded");
    return outcomeResponse(result.outcome);
  }

  let execution;
  try {
    execution = await executeCapture(db, result.capture.captureId, getCaptureExecutionDeps());
  } catch {
    // Truly unexpected: the row stays `capturing` and computes stale at the
    // published age, and the lease expires with it — never released early,
    // because the provider job may still be running.
    return deny(503, ERRORS.unavailable);
  }

  // Execution always closes the claim (ready or failed), so the slot frees
  // now. The release is conditional on this capture id: it cannot free a
  // slot a newer attempt reclaimed after this lease expired.
  await releaseCaptureLease(db, result.capture.captureId).catch(() => {});

  if (!execution.ok) {
    // "not-executable" means another worker already finalized this attempt
    // between the claim and here; the row is terminal either way.
    if ("error" in execution) return deny(409, ERRORS.rejected);
    return outcomeResponse(execution.outcome);
  }

  return withRenewal(
    Response.json({ capture: { ...execution.capture, status: "ready" } }, { status: 200 }),
    auth.renewedToken,
    secure,
  );
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
