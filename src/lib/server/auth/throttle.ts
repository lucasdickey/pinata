// Server-only durable editor-login throttling (VAL-AUTH-006, D026, D098).
// Login attempts are counted in the Turso `rate_limit_buckets` table under
// SHA-256 digest keys, so the published thresholds hold across browser tabs
// and application instances and every bucket recovers after exactly
// LOGIN_WINDOW_MS. No password, session secret, client address, or other
// credential is ever used as or stored in a bucket key in plaintext.
//
// Two buckets guard the single editor credential (D098):
// - a per-client bucket (LOGIN_MAX_FAILURES), keyed by the digest of the
//   client address, so one guesser throttles itself rather than the editor;
// - a global bucket (LOGIN_GLOBAL_MAX_FAILURES, far higher), the D026
//   backstop against guessing spread across many addresses.
// An attempt is throttled when either bucket is over its limit.
//
// An attempt is RESERVED before the password is checked: one atomic upsert
// per bucket increments the count and returns it, and the attempt goes on to
// verification only if neither returned count exceeds its limit. Counting
// after a mismatch instead let N parallel requests all pass a read-only
// pre-check and buy N guesses per window (D098). A successful login then
// releases what it reserved.

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  LOGIN_GLOBAL_MAX_FAILURES,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
} from "../../boundaries";
import type { Database } from "../db/client";

/**
 * Production throttle scope. Validation runs pass their own run-scoped
 * scope so they never touch the production buckets; both bucket keys derive
 * from the scope, so a run-scoped scope isolates both.
 */
export const LOGIN_THROTTLE_SCOPE = "editor-login";

/** The client identity used when a request names no address at all. */
export const LOGIN_UNKNOWN_CLIENT = "unknown";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Durable global bucket key: the SHA-256 hex digest of the scope. Validation
 * runs correlate durable state by recomputing this digest for their scope.
 */
export function loginBucketKey(scope: string = LOGIN_THROTTLE_SCOPE): string {
  return sha256Hex(scope);
}

/**
 * Durable per-client bucket key: a digest over the scope and the digest of
 * the client address, so the stored key reveals neither.
 */
export function loginClientBucketKey(
  client: string,
  scope: string = LOGIN_THROTTLE_SCOPE,
): string {
  return sha256Hex(`${scope}:client:${sha256Hex(client)}`);
}

/**
 * The client address a login attempt is counted under. On Vercel the edge
 * sets `x-real-ip` to the connecting address and overwrites any value the
 * client sent, so it cannot be spoofed there. Off Vercel (a local `next
 * start`) the first `x-forwarded-for` entry stands in; a local caller could
 * forge either header, which only moves it between per-client buckets —
 * the global bucket still counts every guess. No header at all is one
 * shared "unknown" client, which is exactly the pre-D098 single bucket.
 */
export function loginClientFromRequest(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return LOGIN_UNKNOWN_CLIENT;
}

export type LoginThrottleState =
  | { throttled: true; retryAfterMs: number }
  | { throttled: false };

interface BucketRow {
  count: number;
  window_started_at: number;
}

interface BucketLimit {
  key: string;
  limit: number;
}

function bucketLimits(scope: string, client: string): [BucketLimit, BucketLimit] {
  return [
    { key: loginClientBucketKey(client, scope), limit: LOGIN_MAX_FAILURES },
    { key: loginBucketKey(scope), limit: LOGIN_GLOBAL_MAX_FAILURES },
  ];
}

/** Milliseconds until a bucket's window ends; <= 0 once it has recovered. */
function remainingMs(row: BucketRow, now: number): number {
  return row.window_started_at + LOGIN_WINDOW_MS - now;
}

/**
 * Read the current throttle decision without mutating either bucket. The
 * route calls it before reserving, so an attempt that is already throttled
 * is rejected untouched and never inflates a count. It is a fast path, not
 * the guard of record: concurrent attempts can all pass it, and the atomic
 * reservation below is what bounds them.
 */
export async function checkLoginThrottle(
  db: Database,
  now: number,
  scope: string = LOGIN_THROTTLE_SCOPE,
  client: string = LOGIN_UNKNOWN_CLIENT,
): Promise<LoginThrottleState> {
  let retryAfterMs = 0;
  for (const bucket of bucketLimits(scope, client)) {
    const rows = await db.all<BucketRow>(
      sql`SELECT count, window_started_at FROM rate_limit_buckets WHERE bucket_key = ${bucket.key}`,
    );
    const row = rows[0];
    if (!row) continue;
    const remaining = remainingMs(row, now);
    // The window recovers at exactly window_started_at + LOGIN_WINDOW_MS.
    if (remaining <= 0 || row.count < bucket.limit) continue;
    retryAfterMs = Math.max(retryAfterMs, remaining);
  }
  return retryAfterMs > 0 ? { throttled: true, retryAfterMs } : { throttled: false };
}

/**
 * Atomically count one attempt in a bucket. The single upsert keeps the
 * counter correct across concurrent application instances and resets the
 * window at exactly the published boundary.
 */
async function incrementBucket(db: Database, key: string, now: number): Promise<BucketRow> {
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
  return row;
}

export interface LoginReservation {
  /** The client's attempt count inside its active window, this one included. */
  count: number;
  /**
   * True when this reservation took either bucket past its limit: the
   * caller must reject the attempt without checking the password.
   */
  throttled: boolean;
  /**
   * Milliseconds until a retry can succeed: the latest recovery among the
   * buckets over their limit when throttled, else the client window's.
   */
  retryAfterMs: number;
  /** The global window this reservation was counted in (for its release). */
  globalWindowStartedAt: number;
}

/**
 * Reserve one login attempt in both buckets before the password is checked.
 * Each bucket's count comes from its own atomic upsert, so however many
 * attempts race, at most LOGIN_MAX_FAILURES per client (and
 * LOGIN_GLOBAL_MAX_FAILURES overall) come back unthrottled in one window.
 * An unthrottled reservation that then fails verification simply stands:
 * it is the failure count.
 */
export async function reserveLoginAttempt(
  db: Database,
  now: number,
  scope: string = LOGIN_THROTTLE_SCOPE,
  client: string = LOGIN_UNKNOWN_CLIENT,
): Promise<LoginReservation> {
  const [clientBucket, globalBucket] = bucketLimits(scope, client);
  const clientRow = await incrementBucket(db, clientBucket.key, now);
  const globalRow = await incrementBucket(db, globalBucket.key, now);
  const clientOver = clientRow.count > clientBucket.limit;
  const globalOver = globalRow.count > globalBucket.limit;
  const clientRemaining = Math.max(0, remainingMs(clientRow, now));
  const globalRemaining = Math.max(0, remainingMs(globalRow, now));
  const throttled = clientOver || globalOver;
  return {
    count: clientRow.count,
    throttled,
    retryAfterMs: throttled
      ? Math.max(clientOver ? clientRemaining : 0, globalOver ? globalRemaining : 0)
      : clientRemaining,
    globalWindowStartedAt: globalRow.window_started_at,
  };
}

/**
 * Release a successful login's reservation: the client's bucket is cleared
 * (its earlier failures are forgiven, as a success always did) and the one
 * global slot this attempt took is handed back — only within the same
 * window, so a success never touches a newer window. Other clients'
 * failures stay counted: the editor signing in must not wipe the evidence
 * of guessing spread across addresses.
 */
export async function recordLoginSuccess(
  db: Database,
  reservation: LoginReservation,
  now: number,
  scope: string = LOGIN_THROTTLE_SCOPE,
  client: string = LOGIN_UNKNOWN_CLIENT,
): Promise<void> {
  const [clientBucket, globalBucket] = bucketLimits(scope, client);
  await db.run(sql`DELETE FROM rate_limit_buckets WHERE bucket_key = ${clientBucket.key}`);
  await db.run(sql`
    UPDATE rate_limit_buckets SET count = count - 1, updated_at = ${now}
    WHERE bucket_key = ${globalBucket.key}
      AND window_started_at = ${reservation.globalWindowStartedAt}
      AND count > 0
  `);
  // A global bucket that held only this attempt leaves no row behind.
  await db.run(
    sql`DELETE FROM rate_limit_buckets WHERE bucket_key = ${globalBucket.key} AND count <= 0`,
  );
}

/**
 * Forget both buckets for a scope and client; a no-op when absent. Used by
 * validation runs to clean up their run-scoped rows.
 */
export async function clearLoginFailures(
  db: Database,
  scope: string = LOGIN_THROTTLE_SCOPE,
  client: string = LOGIN_UNKNOWN_CLIENT,
): Promise<void> {
  for (const bucket of bucketLimits(scope, client)) {
    await db.run(sql`DELETE FROM rate_limit_buckets WHERE bucket_key = ${bucket.key}`);
  }
}
