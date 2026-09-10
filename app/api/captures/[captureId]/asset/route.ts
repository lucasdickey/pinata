// GET/HEAD /api/captures/[captureId]/asset — the only route private
// screenshot bytes may leave through (VAL-CAPTURE-010, VAL-CAPTURE-014).
//
// There is no redirect to the provider and no signed URL: the editor session
// is verified on every request — including the ones that end in 304, 206, or
// an empty HEAD — and the delivery boundary then resolves the capture through
// its project, serves exact revalidated bytes, or answers with the one
// generic denial. Anonymous, expired, and tampered sessions are the same 401;
// nonexistent, non-ready, and integrity-failed captures are the same 404; no
// answer carries a provider URL, pathname, or cached byte.
//
// Every response — success, denial, even 405 — carries
// `Cache-Control: private, no-store, max-age=0`, `nosniff`, and
// `Vary: Cookie`, so a warmed browser or intermediary cache can never replay
// a private image after the session ends.
//
// The founder capability path (VAL-CAPTURE-010) shares this route: a valid
// founder session whose capability still binds to this capture's project is
// admitted exactly like the editor; a founder of another project, a rotated
// or revoked capability, and an anonymous caller all receive the identical
// editor-only 401. Authority is re-evaluated on every request.

import { ASSET_CACHE_CONTROL, ASSET_VARY } from "../../../../../src/lib/boundaries";
import { deliverCaptureAsset } from "../../../../../src/lib/server/captures/asset";
import { getScreenshotStore } from "../../../../../src/lib/server/captures/deps";
import { getDatabase } from "../../../../../src/lib/server/db/client";
import { authorizeCaptureReader } from "../../../../../src/lib/server/founder/reader";
import { ERRORS, isSecureRequest, jsonError } from "../../../../../src/lib/server/http";

interface RouteContext {
  params: Promise<{ captureId: string }>;
}

/** The cache/response safety policy applies to every answer from this route. */
function withAssetSafety(response: Response): Response {
  response.headers.set("cache-control", ASSET_CACHE_CONTROL);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("vary", ASSET_VARY);
  return response;
}

async function handle(
  request: Request,
  context: RouteContext,
  method: "GET" | "HEAD",
): Promise<Response> {
  // Safe methods need no Origin/CSRF proof, but authority is always live:
  // the editor session — or the founder capability bound to this capture's
  // project — is verified here, immediately before any lookup, and never
  // cached between requests.
  const secure = isSecureRequest(request);
  const db = getDatabase();
  const { captureId } = await context.params;
  const auth = await authorizeCaptureReader(request, db, captureId, secure);
  if (!auth.ok) return withAssetSafety(auth.response);
  const withRenewal = (response: Response) => {
    if (auth.actor.renewCookie) response.headers.append("set-cookie", auth.actor.renewCookie);
    return response;
  };

  if (!db) return withRenewal(withAssetSafety(jsonError(503, ERRORS.unavailable)));

  let response: Response;
  try {
    response = await deliverCaptureAsset(db, getScreenshotStore(), captureId, {
      method,
      range: request.headers.get("range"),
      ifNoneMatch: request.headers.get("if-none-match"),
      ifModifiedSince: request.headers.get("if-modified-since"),
    });
  } catch {
    response = jsonError(503, ERRORS.unavailable);
    withAssetSafety(response);
  }
  return withRenewal(response);
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context, "GET");
}

export async function HEAD(request: Request, context: RouteContext): Promise<Response> {
  return handle(request, context, "HEAD");
}

function methodNotAllowed(): Response {
  const response = withAssetSafety(jsonError(405, ERRORS.invalidRequest));
  response.headers.set("allow", "GET, HEAD");
  return response;
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
