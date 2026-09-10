// /api/captures/[captureId]/context — the ranked nearby-DOM candidates for
// one draft anchor point (VAL-PIN-003).
//
// This is a read over the capture's own immutable, sanitized, persisted
// manifest: no live source DOM is ever queried, and the response carries
// only the bounded element records the manifest already holds. The client
// chooses one candidate's capture-local id (or "No element") at save time;
// the snapshot itself is always derived server-side from the manifest.
//
// Safe method, so no Origin/CSRF proof — but authority is live: the editor
// session is verified immediately before any lookup. A missing, non-ready,
// or foreign capture is the same generic 404 as every other capture read.

import { requireEditor } from "../../../../../src/lib/server/auth/guard";
import { sessionCookie } from "../../../../../src/lib/server/auth/cookies";
import {
  parseManifestElements,
  rankNearbyCandidates,
} from "../../../../../src/lib/server/annotations/context";
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

/** One finite query coordinate; anything else is an invalid request. */
function queryPoint(url: string): { x: number; y: number } | null {
  const params = new URL(url).searchParams;
  const rawX = params.get("x");
  const rawY = params.get("y");
  // Number(null) is 0 and Number("") is 0 — only real, finite text counts.
  if (rawX === null || rawY === null || rawX.trim() === "" || rawY.trim() === "") return null;
  const x = Number(rawX);
  const y = Number(rawY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** Rank the capture's nearby manifest elements for one anchor point. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = requireEditor(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const respond = (response: Response) => withRenewal(response, auth.renewedToken, secure);

  const point = queryPoint(request.url);
  if (!point) return respond(jsonError(400, ERRORS.invalidRequest));

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
  // Only an immutable ready capture has context to offer; everything else
  // is the same bounded generic 404 the annotations route uses.
  if (!capture || capture.status !== "ready") {
    return respond(jsonError(404, ERRORS.rejected));
  }

  const elements = parseManifestElements(capture.domManifestJson) ?? [];
  return respond(Response.json({ candidates: rankNearbyCandidates(elements, point) }));
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
