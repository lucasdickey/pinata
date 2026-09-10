// /api/captures/[captureId]/manifest — the authorized read of one immutable
// ready capture's exact persisted DOM manifest JSON (VAL-CAPTURE-006,
// VAL-PIN-006).
//
// The manifest was bounded, sanitized, and validated at capture time; this
// route serves the persisted UTF-8 bytes verbatim, so an authorized scan of
// the response body is a scan of the persisted record itself. Nothing is
// recomputed, recombined, or derived here, and the response is never cached.
//
// Safe method, so no Origin/CSRF proof — but authority is live: the editor
// session is verified immediately before any lookup. A missing, non-ready,
// or manifest-less capture is the same generic 404 as every other capture
// read.

import { requireEditor } from "../../../../../src/lib/server/auth/guard";
import { sessionCookie } from "../../../../../src/lib/server/auth/cookies";
import { getDatabase, schema } from "../../../../../src/lib/server/db/client";
import { eq } from "drizzle-orm";
import { ERRORS, isSecureRequest, jsonError } from "../../../../../src/lib/server/http";

interface RouteContext {
  params: Promise<{ captureId: string }>;
}

function withRenewal(response: Response, renewedToken: string | null, secure: boolean): Response {
  if (renewedToken) response.headers.append("set-cookie", sessionCookie(renewedToken, secure));
  return response;
}

/** Serve the capture's persisted manifest bytes, verbatim. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = requireEditor(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const respond = (response: Response) => withRenewal(response, auth.renewedToken, secure);

  const db = getDatabase();
  if (!db) return respond(jsonError(503, ERRORS.unavailable));

  const { captureId } = await context.params;
  let capture;
  try {
    const rows = await db
      .select()
      .from(schema.captures)
      .where(eq(schema.captures.id, captureId))
      .limit(1);
    capture = rows[0];
  } catch {
    return respond(jsonError(503, ERRORS.unavailable));
  }
  // Only an immutable ready capture has a manifest to serve; everything else
  // is the same bounded generic 404 the annotations and context routes use.
  if (!capture || capture.status !== "ready" || !capture.domManifestJson) {
    return respond(jsonError(404, ERRORS.rejected));
  }

  return respond(
    new Response(capture.domManifestJson, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    }),
  );
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
