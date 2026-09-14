// /api/captures/[captureId]/context — the ranked nearby-DOM candidates for
// one draft (VAL-PIN-003, D079): `?x=&y=` ranks around a pin tip, and
// `?x=&y=&width=&height=` ranks by overlap with a draft rectangle.
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
  rankOverlapCandidates,
  type ContextBox,
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

/** One finite query number, or null for a missing, blank, or non-finite one. */
function finiteParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  // Number(null) is 0 and Number("") is 0 — only real, finite text counts.
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

type ContextQuery =
  | { kind: "point"; point: { x: number; y: number } }
  | { kind: "box"; box: ContextBox };

/**
 * The anchor the query names: a point (`x`, `y`) or a box (`x`, `y`,
 * `width`, `height`, all finite, the size positive). A box with only one
 * of its two size parameters, or a non-positive size, is invalid.
 */
function queryAnchor(url: string): ContextQuery | null {
  const params = new URL(url).searchParams;
  const x = finiteParam(params, "x");
  const y = finiteParam(params, "y");
  if (x === null || y === null) return null;
  const hasWidth = params.has("width");
  const hasHeight = params.has("height");
  if (!hasWidth && !hasHeight) return { kind: "point", point: { x, y } };
  const width = finiteParam(params, "width");
  const height = finiteParam(params, "height");
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  return { kind: "box", box: { x, y, width, height } };
}

/** Rank the capture's nearby manifest elements for one draft anchor. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = requireEditor(request);
  if (!auth.ok) return auth.response;
  const secure = isSecureRequest(request);
  const respond = (response: Response) => withRenewal(response, auth.renewedToken, secure);

  const anchor = queryAnchor(request.url);
  if (!anchor) return respond(jsonError(400, ERRORS.invalidRequest));

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
  const candidates =
    anchor.kind === "point"
      ? rankNearbyCandidates(elements, anchor.point)
      : rankOverlapCandidates(elements, anchor.box);
  return respond(Response.json({ candidates }));
}

function methodNotAllowed(): Response {
  return jsonError(405, ERRORS.invalidRequest);
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
