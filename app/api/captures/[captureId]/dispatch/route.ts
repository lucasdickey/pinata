// POST /api/captures/[captureId]/dispatch — admit one pending attempt's
// target and claim it for provider work (VAL-CAPTURE-001, VAL-CAPTURE-002).
//
// Boundary order matches every other mutation: same-origin Origin, editor
// session plus CSRF, hard byte cap, then the work. The route takes no request
// body — the attempt row already names the target — so nothing a caller sends
// can influence which URL is admitted.
//
// A rejected target answers with its catalog outcome: a bounded public
// message that names no host, no resolved address, and no provider detail.

import { CAPTURE_REQUEST_MAX_BYTES, captureOutcome } from "../../../../../src/lib/boundaries";
import { sessionCookie } from "../../../../../src/lib/server/auth/cookies";
import { requireEditorMutation } from "../../../../../src/lib/server/auth/guard";
import { getAdmissionDeps } from "../../../../../src/lib/server/captures/deps";
import { dispatchCapture } from "../../../../../src/lib/server/captures/dispatch";
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

  if (!result.ok) {
    if (result.error === "not-found") return deny(404, ERRORS.rejected);
    if (result.error === "not-dispatchable") return deny(409, ERRORS.rejected);
    const outcome = captureOutcome(result.outcome);
    return withRenewal(
      Response.json(
        { error: outcome.publicMessage, code: outcome.code, remediation: outcome.remediation },
        { status: outcome.httpStatus ?? 502 },
      ),
      auth.renewedToken,
      secure,
    );
  }

  return withRenewal(
    Response.json({ capture: { ...result.capture, status: "capturing" } }, { status: 202 }),
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
