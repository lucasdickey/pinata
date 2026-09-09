// Authorized delivery of private capture screenshots (VAL-CAPTURE-010,
// VAL-CAPTURE-014).
//
// The browser never sees a provider URL, signed URL, or pathname: the only
// route to a screenshot is this module, which resolves an opaque capture id
// through the project hierarchy, then fetches and revalidates the stored
// object before a single byte leaves the server.
//
// Ordering is the security property:
//
//   1. the route has already authorized the actor (editor session today; the
//      founder capability path joins it in milestone 2 — authorization is
//      re-evaluated on every request, including 304, 206, and HEAD);
//   2. the capture row must be a ready capture of a live project with a
//      complete, well-formed storage record — anything else is the one
//      generic 404, so existence, readiness, and project state are
//      indistinguishable;
//   3. range syntax and conditionals are evaluated from the persisted record
//      alone, before any provider read, so a malformed probe cannot even
//      reach the store;
//   4. fetched bytes are checked against the persisted type, length, and
//      SHA-256 — a store that answers with anything else is the generic 404,
//      never a served byte.
//
// Every response carries `Cache-Control: private, no-store, max-age=0`,
// `X-Content-Type-Options: nosniff`, `Vary: Cookie`, and `Accept-Ranges:
// bytes`, so a warmed browser or intermediary cache can never replay a
// private image after authority ends.

import { and, eq, isNull } from "drizzle-orm";
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  ASSET_CACHE_CONTROL,
  ASSET_RANGE_UNIT,
  ASSET_VARY,
} from "../../boundaries";
import { schema, type Database } from "../db/client";
import { ERRORS } from "../http";
import type { ScreenshotStore } from "../providers/blob";
import { sha256Hex } from "./image";

/** A ready capture whose storage record is complete and self-consistent. */
export interface DeliverableCapture {
  captureId: string;
  blobPath: string;
  contentType: string;
  bytes: number;
  imageHash: string;
  capturedAt: number;
}

const IMAGE_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Resolve a capture id to its deliverable record, scoped through the project
 * hierarchy: the project must be live and the capture must be ready with a
 * complete, policy-shaped storage record. Every other case — nonexistent id,
 * pending/capturing/failed attempt, deleted project, tampered or incomplete
 * storage fields — is the same null, so the caller's denial cannot
 * distinguish them.
 */
export async function resolveDeliverableCapture(
  db: Database,
  captureId: string,
): Promise<DeliverableCapture | null> {
  const rows = await db
    .select({ capture: schema.captures })
    .from(schema.captures)
    .innerJoin(schema.pages, eq(schema.captures.pageId, schema.pages.id))
    .innerJoin(
      schema.projects,
      and(eq(schema.pages.projectId, schema.projects.id), isNull(schema.projects.deletedAt)),
    )
    .where(eq(schema.captures.id, captureId))
    .limit(1);
  const row = rows[0]?.capture;
  if (!row) return null;
  if (row.status !== "ready") return null;
  if (row.capturedAt === null) return null;
  if (!row.blobPath || !row.blobContentType || !row.imageHash) return null;
  if (row.blobBytes === null || row.blobBytes <= 0) return null;
  // A ready row only ever holds a validated type and hash (execute.ts), but
  // this boundary re-checks rather than trusts persisted policy fields.
  if (!ALLOWED_IMAGE_CONTENT_TYPES.includes(row.blobContentType)) return null;
  if (!IMAGE_HASH_PATTERN.test(row.imageHash)) return null;
  return {
    captureId: row.id,
    blobPath: row.blobPath,
    contentType: row.blobContentType,
    bytes: row.blobBytes,
    imageHash: row.imageHash,
    capturedAt: row.capturedAt,
  };
}

interface ByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

type RangeParse =
  | { ok: true; range: ByteRange | null }
  | { ok: false; error: "malformed" | "unsatisfiable" };

/**
 * Parse the one supported range shape, `bytes=<start>-<end?>`, against the
 * object length. Suffix ranges, multiple ranges, other units, reversed
 * bounds, and non-numeric text are malformed; an explicit start at or past
 * the end is unsatisfiable (416). Neither case is ever partially honored.
 */
export function parseAssetRange(header: string | null, total: number): RangeParse {
  if (header === null) return { ok: true, range: null };
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return { ok: false, error: "malformed" };
  const start = Number(match[1]);
  const endText = match[2]!;
  const end = endText === "" ? total - 1 : Number(endText);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    return { ok: false, error: "malformed" };
  }
  if (endText !== "" && end < start) return { ok: false, error: "malformed" };
  if (start >= total) return { ok: false, error: "unsatisfiable" };
  return { ok: true, range: { start, end: Math.min(end, total - 1) } };
}

/** The strong validator for a stored object: the SHA-256 of its exact bytes. */
function etagFor(imageHash: string): string {
  return `"${imageHash}"`;
}

/** True when an If-None-Match list contains the validator, weakly or as `*`. */
function matchesIfNoneMatch(header: string, etag: string): boolean {
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    if (value === "*") return true;
    const bare = value.startsWith("W/") ? value.slice(2).trim() : value;
    return bare === etag;
  });
}

/** Headers every response from this boundary carries, success or denial. */
function baseHeaders(): Headers {
  const headers = new Headers();
  headers.set("cache-control", ASSET_CACHE_CONTROL);
  headers.set("x-content-type-options", "nosniff");
  headers.set("vary", ASSET_VARY);
  headers.set("accept-ranges", ASSET_RANGE_UNIT);
  return headers;
}

/** Bounded generic denial: a small JSON error, never a captured byte. */
function denial(status: number, message: string): Response {
  const headers = baseHeaders();
  const body = JSON.stringify({ error: message });
  headers.set("content-type", "application/json");
  headers.set("content-length", String(Buffer.byteLength(body, "utf8")));
  return new Response(body, { status, headers });
}

/** The headers a 304 repeats so caches keep the validators and the policy. */
function notModified(etag: string, lastModified: string): Response {
  const headers = baseHeaders();
  headers.set("etag", etag);
  headers.set("last-modified", lastModified);
  return new Response(null, { status: 304, headers });
}

export interface AssetDeliveryRequest {
  method: "GET" | "HEAD";
  range: string | null;
  ifNoneMatch: string | null;
  ifModifiedSince: string | null;
}

/**
 * Deliver one authorized capture asset. The caller has already authorized
 * the actor for the project; this function owns resolution, range and
 * conditional semantics, integrity revalidation, and response policy.
 *
 * HEAD receives exactly the GET metadata with an empty body, including the
 * range result. Conditionals are answered from the persisted hash without a
 * provider read; byte-serving paths fetch and revalidate the object first.
 */
export async function deliverCaptureAsset(
  db: Database,
  store: ScreenshotStore | null,
  captureId: string,
  request: AssetDeliveryRequest,
): Promise<Response> {
  const capture = await resolveDeliverableCapture(db, captureId);
  if (!capture) return denial(404, ERRORS.rejected);

  const etag = etagFor(capture.imageHash);
  const lastModified = new Date(capture.capturedAt).toUTCString();

  // Range syntax is settled before any provider read: a malformed probe must
  // not even reach the store, and an unsatisfiable one answers with the
  // published length and no bytes.
  const parsed = parseAssetRange(request.range, capture.bytes);
  if (!parsed.ok) {
    if (parsed.error === "unsatisfiable") {
      const headers = baseHeaders();
      headers.set("content-range", `${ASSET_RANGE_UNIT} */${capture.bytes}`);
      headers.set("etag", etag);
      return new Response(null, { status: 416, headers });
    }
    return denial(400, ERRORS.invalidRequest);
  }

  // Conditionals: If-None-Match wins over If-Modified-Since (RFC 9110); a
  // match means the client already holds exactly these bytes, so the 304 is
  // answered from the persisted hash without fetching anything.
  if (request.ifNoneMatch !== null) {
    if (matchesIfNoneMatch(request.ifNoneMatch, etag)) {
      return notModified(etag, lastModified);
    }
  } else if (request.ifModifiedSince !== null) {
    const since = Date.parse(request.ifModifiedSince);
    if (
      Number.isFinite(since) &&
      Math.floor(capture.capturedAt / 1000) <= Math.floor(since / 1000)
    ) {
      return notModified(etag, lastModified);
    }
  }

  if (!store) return denial(503, ERRORS.unavailable);
  let stored: Awaited<ReturnType<ScreenshotStore["get"]>>;
  try {
    stored = await store.get(capture.blobPath);
  } catch {
    stored = { ok: false, error: "unavailable" };
  }
  if (!stored.ok) {
    // A ready row whose object is gone is indistinguishable from any other
    // miss; a store that cannot answer is a bounded generic unavailability.
    return stored.error === "not-found"
      ? denial(404, ERRORS.rejected)
      : denial(503, ERRORS.unavailable);
  }

  // Fail closed on integrity: the served bytes must be exactly the bytes the
  // capture validated — same length, same SHA-256 — or nothing is served.
  if (
    stored.value.byteLength !== capture.bytes ||
    sha256Hex(stored.value) !== capture.imageHash
  ) {
    return denial(404, ERRORS.rejected);
  }

  const range = parsed.range;
  // A standalone copy: a Response must never expose a view onto a shared
  // provider buffer beyond the served range.
  const part = range
    ? stored.value.slice(range.start, range.end + 1)
    : stored.value.slice();
  const headers = baseHeaders();
  headers.set("content-type", capture.contentType);
  headers.set("content-length", String(part.byteLength));
  headers.set("etag", etag);
  headers.set("last-modified", lastModified);
  if (range) {
    headers.set(
      "content-range",
      `${ASSET_RANGE_UNIT} ${range.start}-${range.end}/${capture.bytes}`,
    );
  }
  return new Response(request.method === "HEAD" ? null : part, {
    status: range ? 206 : 200,
    headers,
  });
}
