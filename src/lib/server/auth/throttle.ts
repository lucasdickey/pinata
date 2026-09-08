// Server-only durable editor-login throttling (VAL-AUTH-006, D026). Failed
// logins are counted in the Turso `rate_limit_buckets` table under a SHA-256
// digest key, so the published threshold holds across browser tabs and
// application instances and the bucket recovers after exactly
// LOGIN_WINDOW_MS. No password, session secret, or other credential is ever
// used as or stored in a bucket key.

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from "../../boundaries";
import type { Database } from "../db/client";

/**
 * Production throttle scope. One shared bucket guards the single editor
 * credential: the protected secret is global, so a per-client bucket would
 * let a distributed attacker keep guessing by rotating source addresses.
 * Validation runs use their own run-scoped scope so they never touch the
 * production bucket.
 */
export const LOGIN_THROTTLE_SCOPE = "editor-login";

/**
 * Durable bucket key: the SHA-256 hex digest of the scope. Validation runs
 * correlate durable state by recomputing this digest for their scope.
 */
export function loginBucketKey(scope: string = LOGIN_THROTTLE_SCOPE): string {
  return createHash("sha256").update(scope, "utf8").digest("hex");
}

export type LoginThrottleState =
  | { throttled: true; retryAfterMs: number }
  | { throttled: false };

interface BucketRow {
  count: number;
  window_started_at: number;
}

function stateFromRow(row: BucketRow | undefined, now: number): LoginThrottleState {
  if (!row) return { throttled: false };
  const retryAfterMs = row.window_started_at + LOGIN_WINDOW_MS - now;
  // The window recovers at exactly window_started_at + LOGIN_WINDOW_MS.
  if (retryAfterMs <= 0) return { throttled: false };
  if (row.count < LOGIN_MAX_FAILURES) return { throttled: false };
  return { throttled: true, retryAfterMs };
}

/**
 * Read the current throttle decision without mutating the bucket. While
 * throttled, callers reject the attempt untouched, so rejected attempts
 * never extend the window and the recovery boundary stays exact.
 */
export async function checkLoginThrottle(
  db: Database,
  now: number,
  scope: string = LOGIN_THROTTLE_SCOPE,
): Promise<LoginThrottleState> {
  const rows = await db.all<BucketRow>(
    sql`SELECT count, window_started_at FROM rate_limit_buckets WHERE bucket_key = ${loginBucketKey(scope)}`,
  );
  return stateFromRow(rows[0], now);
}

export interface LoginFailureResult {
  /** Failure count inside the active window after this registration. */
  count: number;
  /** True when this registration pushed the bucket past the published limit. */
  throttled: boolean;
  /** Milliseconds until the active window resets. */
  retryAfterMs: number;
}

/**
 * Atomically register one failed login. The single upsert statement keeps
 * the counter correct across concurrent application instances and resets the
 * window at exactly the published boundary. A registration that races past
 * the limit reports `throttled` so the caller can answer with the throttle
 * response instead of the plain mismatch.
 */
export async function registerLoginFailure(
  db: Database,
  now: number,
  scope: string = LOGIN_THROTTLE_SCOPE,
): Promise<LoginFailureResult> {
  const key = loginBucketKey(scope);
  const rows = await db.all<BucketRow>(sql`
    INSERT INTO rate_limit_buckets (bucket_key, count, window_started_at, updated_at)
    VALUES (${key}, 1, ${now}, ${now})
    ON CONFLICT (bucket_key) DO UPDATE SET
      count = CASE WHEN ${now} - window_started_at >= ${LOGIN_WINDOW_MS}
        THEN 1 ELSE count + 1 END,
      window_started_at = CASE WHEN ${now} - window_started_at >= ${LOGIN_WINDOW_MS}
        THEN ${now} ELSE window_started_at END,
      updated_at = ${now}
    RETURNING count, window_started_at
  `);
  const row = rows[0];
  if (!row) throw new Error("rate-limit registration returned no row");
  return {
    count: row.count,
    throttled: row.count > LOGIN_MAX_FAILURES,
    retryAfterMs: Math.max(0, row.window_started_at + LOGIN_WINDOW_MS - now),
  };
}

/** Clear the bucket after a successful login; a no-op when absent. */
export async function clearLoginFailures(
  db: Database,
  scope: string = LOGIN_THROTTLE_SCOPE,
): Promise<void> {
  await db.run(sql`DELETE FROM rate_limit_buckets WHERE bucket_key = ${loginBucketKey(scope)}`);
}
