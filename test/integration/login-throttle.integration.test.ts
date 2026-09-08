// Real-Turso integration proof for durable editor-login throttling
// (VAL-AUTH-006): two independent database clients stand in for two
// application instances sharing one durable bucket; the bucket row is read
// back by its run-scoped digest key (durable test-run correlation) and is
// proven to carry no password or secret. Runs only when the Turso
// environment is present (locally via `node --env-file=.env.local
// node_modules/vitest/vitest.mjs run test/integration`); skips silently
// otherwise. The run-scoped bucket row is deleted with verified cleanup, and
// the production "editor-login" bucket is never touched.

import { randomBytes } from "node:crypto";
import { createClient } from "@libsql/client";
import { describe, expect, test } from "vitest";
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from "../../src/lib/boundaries";
import {
  checkLoginThrottle,
  clearLoginFailures,
  loginBucketKey,
  registerLoginFailure,
} from "../../src/lib/server/auth/throttle";
import { createDatabase } from "../../src/lib/server/db/client";

const hasDatabaseEnv = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);

const RUN_ID = `valrun-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const SCOPE = `editor-login:test:${RUN_ID}`;
const BUCKET_KEY = loginBucketKey(SCOPE);

describe.skipIf(!hasDatabaseEnv)("real Turso durable login throttling", () => {
  test("one bucket is enforced across two instances, correlated by run id, and cleaned up", async () => {
    // Two independent clients = two application instances.
    const instanceA = createDatabase(process.env);
    const instanceB = createDatabase(process.env);
    expect(instanceA).not.toBeNull();
    expect(instanceB).not.toBeNull();

    const now = Date.now();
    try {
      // Instance A accumulates failures up to the published threshold.
      for (let attempt = 1; attempt <= LOGIN_MAX_FAILURES; attempt += 1) {
        const result = await registerLoginFailure(instanceA!, now, SCOPE);
        expect(result.count).toBe(attempt);
        expect(result.throttled).toBe(false);
      }

      // Instance B sees the same durable bucket throttled.
      const seenByB = await checkLoginThrottle(instanceB!, now + 1000, SCOPE);
      expect(seenByB.throttled).toBe(true);
      if (seenByB.throttled) {
        expect(seenByB.retryAfterMs).toBeGreaterThan(0);
        expect(seenByB.retryAfterMs).toBeLessThanOrEqual(LOGIN_WINDOW_MS);
      }

      // Durable test-run correlation: the row is exactly the digest of the
      // run-scoped scope and contains no password, secret, or scope text.
      const reader = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!,
      });
      const rows = await reader.execute({
        sql: "SELECT bucket_key, count, window_started_at, updated_at FROM rate_limit_buckets WHERE bucket_key = ?",
        args: [BUCKET_KEY],
      });
      expect(rows.rows).toHaveLength(1);
      const row = rows.rows[0]!;
      expect(String(row.bucket_key)).toMatch(/^[0-9a-f]{64}$/);
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain(SCOPE);
      expect(serialized).not.toContain("editor-login");
      expect(Number(row.count)).toBe(LOGIN_MAX_FAILURES);
      expect(Number(row.window_started_at)).toBe(now);

      // A racing registration through instance B crosses the limit
      // atomically and reports throttled with the exact retry bound.
      const overflow = await registerLoginFailure(instanceB!, now + 2000, SCOPE);
      expect(overflow.count).toBe(LOGIN_MAX_FAILURES + 1);
      expect(overflow.throttled).toBe(true);
      expect(overflow.retryAfterMs).toBe(LOGIN_WINDOW_MS - 2000);

      // A successful login clears the bucket for both instances.
      await clearLoginFailures(instanceB!, SCOPE);
      expect(await checkLoginThrottle(instanceA!, now + 3000, SCOPE)).toEqual({
        throttled: false,
      });
    } finally {
      // Verified cleanup: the run-scoped row is gone.
      await clearLoginFailures(instanceA!, SCOPE);
      const verifier = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!,
      });
      const remaining = await verifier.execute({
        sql: "SELECT COUNT(*) AS n FROM rate_limit_buckets WHERE bucket_key = ?",
        args: [BUCKET_KEY],
      });
      expect(Number(remaining.rows[0]?.n)).toBe(0);
      verifier.close();
    }
  }, 60_000);
});
