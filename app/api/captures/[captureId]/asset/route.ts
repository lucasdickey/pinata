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
// The founder capability path (rotation/revocation authority for a shared
// project link) joins this same route in milestone 2 with VAL-CAPTURE-010;
// nothing here caches or presumes the editor-only authority shape.

import { ASSET_CACHE_CONTROL, ASSET_VARY } from "../../../../../src/lib/boundaries";
import { sessionCookie } from "../../../../../src/lib/server/auth/cookies";
import { requireEditor } from "../../../../../src/lib/server/auth/guard";
import { deliverCaptureAsset } from "../../../../../src/lib/server/captures/asset";
import { getScreenshotStore } from "../../../../../src/lib/server/captures/deps";
import { getDatabase } from "../../../../../src/lib/server/db/client";
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
  // the session is verified here, immediately before any lookup, and never
  // cached between requests.
  const auth = requireEditor(request);
  if (!auth.ok) return withAssetSafety(auth.response);
  const secure = isSecureRequest(request);
  const withRenewal = (response: Response) => {
    if (auth.renewedToken) {
      response.headers.append("set-cookie", sessionCookie(auth.renewedToken, secure));
    }
    return response;
  };

  const db = getDatabase();
  if (!db) return withRenewal(withAssetSafety(jsonError(503, ERRORS.unavailable)));

  const { captureId } = await context.params;
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
