// Server-only durable founder-reply throttling (VAL-THREAD-006). Accepted
// founder replies are counted per project in the Turso `rate_limit_buckets`
// table under a SHA-256 digest key — the same durable pattern as the login
// throttle — so REPLY_MAX_PER_WINDOW holds across browser tabs and
// application instances and the bucket recovers after exactly
// REPLY_WINDOW_MS. The bucket key names the scope and the project id only;
// no capability token, session, or secret is ever part of it.

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { REPLY_MAX_PER_WINDOW, REPLY_WINDOW_MS } from "../../boundaries";
import type { Database } from "../db/client";

/** Production throttle scope; one bucket per shared project. */
export const REPLY_THROTTLE_SCOPE = "founder-reply";

/** Durable bucket key: SHA-256 hex of scope + project id, never plaintext. */
export function replyBucketKey(projectId: string, scope: string = REPLY_THROTTLE_SCOPE): string {
  return createHash("sha256").update(`${scope}:${projectId}`, "utf8").digest("hex");
}

export type ReplyThrottleState =
  | { throttled: true; retryAfterMs: number }
  | { throttled: false };

interface BucketRow {
  count: number;
  window_started_at: number;
}

function stateFromRow(row: BucketRow | undefined, now: number): ReplyThrottleState {
  if (!row) return { throttled: false };
  const retryAfterMs = row.window_started_at + REPLY_WINDOW_MS - now;
  // The window recovers at exactly window_started_at + REPLY_WINDOW_MS.
  if (retryAfterMs <= 0) return { throttled: false };
  if (row.count < REPLY_MAX_PER_WINDOW) return { throttled: false };
  return { throttled: true, retryAfterMs };
}

/**
 * Read the current decision without mutating the bucket: a throttled reply
 * is rejected untouched so rejections never extend the window.
 */
export async function checkReplyThrottle(
  db: Database,
  projectId: string,
  now: number,
  scope: string = REPLY_THROTTLE_SCOPE,
): Promise<ReplyThrottleState> {
  const rows = await db.all<BucketRow>(
    sql`SELECT count, window_started_at FROM rate_limit_buckets WHERE bucket_key = ${replyBucketKey(projectId, scope)}`,
  );
  return stateFromRow(rows[0], now);
}

export interface ReplyRegistration {
  /** Accepted replies inside the active window, including this one. */
  count: number;
  /** True when this registration pushed the bucket past the published limit. */
  throttled: boolean;
  /** Milliseconds until the active window resets. */
  retryAfterMs: number;
}

/**
 * Atomically register one reply. One upsert keeps the counter correct across
 * concurrent application instances and resets the window at exactly the
 * published boundary. A registration that races past the limit reports
 * `throttled` so the caller rejects the reply instead of appending it.
 */
export async function registerReply(
  db: Database,
  projectId: string,
  now: number,
  scope: string = REPLY_THROTTLE_SCOPE,
): Promise<ReplyRegistration> {
  const key = replyBucketKey(projectId, scope);
  const rows = await db.all<BucketRow>(sql`
    INSERT INTO rate_limit_buckets (bucket_key, count, window_started_at, updated_at)
    VALUES (${key}, 1, ${now}, ${now})
    ON CONFLICT (bucket_key) DO UPDATE SET
      count = CASE WHEN ${now} - window_started_at >= ${REPLY_WINDOW_MS}
        THEN 1 ELSE count + 1 END,
      window_started_at = CASE WHEN ${now} - window_started_at >= ${REPLY_WINDOW_MS}
        THEN ${now} ELSE window_started_at END,
      updated_at = ${now}
    RETURNING count, window_started_at
  `);
  const row = rows[0];
  if (!row) throw new Error("reply registration returned no row");
  return {
    count: row.count,
    throttled: row.count > REPLY_MAX_PER_WINDOW,
    retryAfterMs: Math.max(0, row.window_started_at + REPLY_WINDOW_MS - now),
  };
}
