// Server-only per-role last-seen marks and the counts derived from them
// (D075, REQUIREMENTS 6).
//
// A reply is unread for a role when it is a `message` entry written by the
// other role after that role's last view of the pin. Views are stored in
// `annotation_views`, one row per (pin, role, viewer key): the editor is one
// viewer, and a founder is identified by the capability version the session
// is bound to, so a rotated link starts with a fresh view and the durable
// store never holds a session id or token.
//
// Counts are computed in one grouped query per read so the hierarchy can
// carry them for every capture of every project without extra requests.
// Only live pins on the queried captures are counted; tombstoned pins and
// `status` entries never count as unread.

import { and, eq, isNull, sql } from "drizzle-orm";
import type { FeedbackCounts } from "../../annotations";
import { schema, type Database } from "../db/client";
import type { ThreadActorRole } from "../db/schema";

/** Who is reading: the role plus the durable key its views are stored under. */
export interface Viewer {
  role: ThreadActorRole;
  viewerKey: string;
}

/** The editor is one viewer across every session. */
export const EDITOR_VIEWER: Viewer = { role: "editor", viewerKey: "editor" };

/** A founder is one viewer per capability version (D075). */
export function founderViewer(version: number): Viewer {
  return { role: "founder", viewerKey: `founder:v${version}` };
}

export function emptyFeedbackCounts(): FeedbackCounts {
  return { pins: 0, open: 0, resolved: 0, unreadReplies: 0 };
}

/** Add feedback counts together (a project is the sum of its captures). */
export function sumFeedbackCounts(counts: Iterable<FeedbackCounts>): FeedbackCounts {
  const total = emptyFeedbackCounts();
  for (const item of counts) {
    total.pins += item.pins;
    total.open += item.open;
    total.resolved += item.resolved;
    total.unreadReplies += item.unreadReplies;
  }
  return total;
}

export interface PinRef {
  captureId: string;
  annotationId: string;
}

export type MarkSeenResult = { ok: true } | { ok: false; error: "not-found" };

/**
 * The live pin a view belongs to, honoring the capture binding: a
 * tombstoned pin, a pin of another capture, a non-ready capture, and a
 * missing pin are all null (the caller answers with the generic 404).
 */
async function loadLivePinId(db: Database, ref: PinRef): Promise<string | null> {
  const rows = await db
    .select({
      id: schema.annotations.id,
      captureId: schema.annotations.captureId,
      status: schema.captures.status,
    })
    .from(schema.annotations)
    .innerJoin(schema.captures, eq(schema.annotations.captureId, schema.captures.id))
    .where(
      and(
        eq(schema.annotations.id, ref.annotationId),
        eq(schema.annotations.kind, "pin"),
        isNull(schema.annotations.deletedAt),
      ),
    )
    .limit(1);
  const pin = rows[0];
  if (!pin || pin.captureId !== ref.captureId || pin.status !== "ready") return null;
  return pin.id;
}

/**
 * Record that the viewer has read the pin's thread as of `now`. One upsert;
 * a view never moves backwards, so an out-of-order request cannot make a
 * reply unread again.
 */
export async function markPinSeen(
  db: Database,
  ref: PinRef,
  viewer: Viewer,
  now: number,
): Promise<MarkSeenResult> {
  const pinId = await loadLivePinId(db, ref);
  if (!pinId) return { ok: false, error: "not-found" };
  await db.run(sql`
    INSERT INTO annotation_views (annotation_id, role, viewer_key, seen_at)
    VALUES (${pinId}, ${viewer.role}, ${viewer.viewerKey}, ${now})
    ON CONFLICT (annotation_id, role, viewer_key) DO UPDATE SET
      seen_at = max(seen_at, excluded.seen_at)
  `);
  return { ok: true };
}

interface UnreadRow {
  annotation_id: string;
  unread: number;
}

/**
 * Unread reply counts for every live pin of one capture, keyed by pin id.
 * Pins with nothing unread are absent from the map.
 */
export async function unreadRepliesByPin(
  db: Database,
  captureId: string,
  viewer: Viewer,
): Promise<Map<string, number>> {
  const rows = await db.all<UnreadRow>(sql`
    SELECT a.id AS annotation_id, count(e.id) AS unread
    FROM annotations a
    JOIN thread_entries e
      ON e.annotation_id = a.id
     AND e.kind = 'message'
     AND e.actor_role != ${viewer.role}
    LEFT JOIN annotation_views v
      ON v.annotation_id = a.id
     AND v.role = ${viewer.role}
     AND v.viewer_key = ${viewer.viewerKey}
    WHERE a.capture_id = ${captureId}
      AND a.kind = 'pin'
      AND a.deleted_at IS NULL
      AND e.created_at > coalesce(v.seen_at, 0)
    GROUP BY a.id
  `);
  return new Map(rows.map((row) => [row.annotation_id, Number(row.unread)]));
}

interface CountsRow {
  capture_id: string;
  pins: number;
  open: number;
  resolved: number;
  unread: number;
}

/**
 * Feedback counts for the requesting viewer, grouped by capture, in one
 * query. Captures with no live pins are absent from the map.
 */
export async function feedbackCountsByCapture(
  db: Database,
  captureIds: readonly string[],
  viewer: Viewer,
): Promise<Map<string, FeedbackCounts>> {
  if (captureIds.length === 0) return new Map();
  const idList = sql.join(
    captureIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.all<CountsRow>(sql`
    SELECT
      a.capture_id AS capture_id,
      count(*) AS pins,
      sum(CASE WHEN a.status = 'resolved' THEN 0 ELSE 1 END) AS open,
      sum(CASE WHEN a.status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
      sum((
        SELECT count(*)
        FROM thread_entries e
        WHERE e.annotation_id = a.id
          AND e.kind = 'message'
          AND e.actor_role != ${viewer.role}
          AND e.created_at > coalesce((
            SELECT v.seen_at
            FROM annotation_views v
            WHERE v.annotation_id = a.id
              AND v.role = ${viewer.role}
              AND v.viewer_key = ${viewer.viewerKey}
          ), 0)
      )) AS unread
    FROM annotations a
    WHERE a.kind = 'pin'
      AND a.deleted_at IS NULL
      AND a.capture_id IN (${idList})
    GROUP BY a.capture_id
    ORDER BY a.capture_id
  `);
  return new Map(
    rows.map((row) => [
      row.capture_id,
      {
        pins: Number(row.pins),
        open: Number(row.open),
        resolved: Number(row.resolved),
        unreadReplies: Number(row.unread),
      },
    ]),
  );
}
