// Focused tests for durable editor-login throttling (VAL-AUTH-006, D098):
// the published per-client threshold and global ceiling, the exact recovery
// boundary, cross-handle (instance) sharing of the same durable buckets,
// atomic window reset and reservation, success release, client
// identification, and the guarantee that bucket state carries only
// digests — never a password, secret, or client address. Runs against an in-memory libSQL database with the
// committed migrations applied; real Turso cross-client proof lives in
// test/integration/login-throttle.integration.test.ts.

import { describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import {
  LOGIN_GLOBAL_MAX_FAILURES,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
} from "../../src/lib/boundaries";
import { databaseFromClient, schema } from "../../src/lib/server/db/client";
import {
  LOGIN_THROTTLE_SCOPE,
  LOGIN_UNKNOWN_CLIENT,
  checkLoginThrottle,
  clearLoginFailures,
  loginBucketKey,
  loginClientBucketKey,
  loginClientFromRequest,
  recordLoginSuccess,
  reserveLoginAttempt,
} from "../../src/lib/server/auth/throttle";
import { createTestDb } from "./test-db";

const T0 = 1_800_000_000_000;

describe("loginBucketKey", () => {
  test("is a stable SHA-256 hex digest of the scope, never the scope text", () => {
    const key = loginBucketKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(loginBucketKey(LOGIN_THROTTLE_SCOPE));
    expect(key).not.toBe(loginBucketKey("editor-login:test:other"));
    expect(key).not.toContain(LOGIN_THROTTLE_SCOPE);
  });

  test("the per-client key is a digest distinct per client, scope, and from the global key", () => {
    const key = loginClientBucketKey("203.0.113.7");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.7");
    expect(key).not.toBe(loginClientBucketKey("203.0.113.8"));
    expect(key).not.toBe(loginClientBucketKey("203.0.113.7", "editor-login:test:other"));
    expect(key).not.toBe(loginBucketKey());
  });
});

describe("loginClientFromRequest (D098)", () => {
  const at = (headers: Record<string, string>) =>
    loginClientFromRequest(new Request("http://127.0.0.1:3100/api/auth/login", { headers }));

  test("prefers Vercel's x-real-ip", () => {
    expect(at({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })).toBe(
      "203.0.113.7",
    );
  });

  test("falls back to the first x-forwarded-for entry", () => {
    expect(at({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" })).toBe("198.51.100.1");
  });

  test("falls back to the fixed unknown client when neither header names one", () => {
    expect(at({})).toBe(LOGIN_UNKNOWN_CLIENT);
    expect(at({ "x-real-ip": "  ", "x-forwarded-for": "" })).toBe(LOGIN_UNKNOWN_CLIENT);
  });
});

describe("checkLoginThrottle / reserveLoginAttempt", () => {
  test("an empty bucket is not throttled", async () => {
    const { client, db } = await createTestDb();
    expect(await checkLoginThrottle(db, T0)).toEqual({ throttled: false });
    client.close();
  });

  test("failures up to the published limit are counted without throttling", async () => {
    const { client, db } = await createTestDb();
    for (let attempt = 1; attempt <= LOGIN_MAX_FAILURES; attempt += 1) {
      const result = await reserveLoginAttempt(db, T0 + attempt);
      expect(result.count).toBe(attempt);
      expect(result.throttled).toBe(false);
    }
    // The limit is reached: further attempts in the window are throttled.
    // The window started at the first failure (T0 + 1), so the remaining
    // time at T0 + LOGIN_MAX_FAILURES + 1 is LOGIN_WINDOW_MS - LOGIN_MAX_FAILURES.
    const state = await checkLoginThrottle(db, T0 + LOGIN_MAX_FAILURES + 1);
    expect(state.throttled).toBe(true);
    if (state.throttled) {
      expect(state.retryAfterMs).toBe(LOGIN_WINDOW_MS - LOGIN_MAX_FAILURES);
    }
    client.close();
  });

  test("a racing registration past the limit reports throttled with the exact retry bound", async () => {
    const { client, db } = await createTestDb();
    for (let attempt = 1; attempt <= LOGIN_MAX_FAILURES; attempt += 1) {
      await reserveLoginAttempt(db, T0);
    }
    // Two instances can both pass a pre-check at the boundary; the atomic
    // increment is the guard of record and reports the crossing.
    const overflow = await reserveLoginAttempt(db, T0 + 1000);
    expect(overflow.count).toBe(LOGIN_MAX_FAILURES + 1);
    expect(overflow.throttled).toBe(true);
    expect(overflow.retryAfterMs).toBe(LOGIN_WINDOW_MS - 1000);
    client.close();
  });

  test("recovery happens at exactly the published window boundary", async () => {
    const { client, db } = await createTestDb();
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await reserveLoginAttempt(db, T0);
    }
    const justBefore = await checkLoginThrottle(db, T0 + LOGIN_WINDOW_MS - 1);
    expect(justBefore).toEqual({ throttled: true, retryAfterMs: 1 });
    // At exactly window start + LOGIN_WINDOW_MS the bucket is open again.
    expect(await checkLoginThrottle(db, T0 + LOGIN_WINDOW_MS)).toEqual({ throttled: false });
    client.close();
  });

  test("a failure after the window expires opens a fresh window atomically", async () => {
    const { client, db } = await createTestDb();
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await reserveLoginAttempt(db, T0);
    }
    const fresh = await reserveLoginAttempt(db, T0 + LOGIN_WINDOW_MS);
    expect(fresh).toEqual({
      count: 1,
      throttled: false,
      retryAfterMs: LOGIN_WINDOW_MS,
      globalWindowStartedAt: T0 + LOGIN_WINDOW_MS,
    });
    // Both the client and the global bucket opened their fresh window.
    const rows = await db.select().from(schema.rateLimitBuckets);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.windowStartedAt).toBe(T0 + LOGIN_WINDOW_MS);
    client.close();
  });

  test("the same durable bucket is shared across independent handles (instances)", async () => {
    const { client, db } = await createTestDb();
    // A second drizzle handle over the same connection stands in for a
    // second application instance; the integration test proves it across two
    // real Turso connections.
    const secondHandle = databaseFromClient(client);
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await reserveLoginAttempt(db, T0);
    }
    const seen = await checkLoginThrottle(secondHandle, T0 + 1);
    expect(seen.throttled).toBe(true);
    client.close();
  });

  test("bucket rows contain only the digest key and counters — no password or secret", async () => {
    const { client, db } = await createTestDb();
    const scope = `editor-login:test:${T0}`;
    await reserveLoginAttempt(db, T0, scope);
    const rows = await db
      .select()
      .from(schema.rateLimitBuckets)
      .where(eq(schema.rateLimitBuckets.bucketKey, loginBucketKey(scope)));
    expect(rows).toHaveLength(1);
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain(scope);
    expect(rows[0]?.bucketKey).toMatch(/^[0-9a-f]{64}$/);
    client.close();
  });
});

describe("per-client and global buckets (D098)", () => {
  test("one client's failures do not throttle another client", async () => {
    const { client, db } = await createTestDb();
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await reserveLoginAttempt(db, T0, LOGIN_THROTTLE_SCOPE, "203.0.113.7");
    }
    expect((await checkLoginThrottle(db, T0, LOGIN_THROTTLE_SCOPE, "203.0.113.7")).throttled).toBe(
      true,
    );
    expect(await checkLoginThrottle(db, T0, LOGIN_THROTTLE_SCOPE, "198.51.100.1")).toEqual({
      throttled: false,
    });
    client.close();
  });

  test("the global ceiling throttles every client once guesses spread across addresses", async () => {
    const { client, db } = await createTestDb();
    for (let attempt = 0; attempt < LOGIN_GLOBAL_MAX_FAILURES; attempt += 1) {
      const result = await reserveLoginAttempt(db, T0, LOGIN_THROTTLE_SCOPE, `client-${attempt}`);
      expect(result.throttled).toBe(false);
    }
    const fresh = "never-seen-client";
    const seen = await checkLoginThrottle(db, T0 + 1, LOGIN_THROTTLE_SCOPE, fresh);
    expect(seen).toEqual({ throttled: true, retryAfterMs: LOGIN_WINDOW_MS - 1 });
    const racing = await reserveLoginAttempt(db, T0 + 1, LOGIN_THROTTLE_SCOPE, fresh);
    expect(racing.count).toBe(1);
    expect(racing.throttled).toBe(true);
    expect(racing.retryAfterMs).toBe(LOGIN_WINDOW_MS - 1);
    client.close();
  });

  test("concurrent reservations let at most the published limit through", async () => {
    const { client, db } = await createTestDb();
    const results = await Promise.all(
      Array.from({ length: 4 * LOGIN_MAX_FAILURES }, () => reserveLoginAttempt(db, T0)),
    );
    expect(results.filter((r) => !r.throttled)).toHaveLength(LOGIN_MAX_FAILURES);
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 4 * LOGIN_MAX_FAILURES }, (_, i) => i + 1),
    );
    client.close();
  });

  test("a success clears its client and hands back only its own global slot", async () => {
    const { client, db } = await createTestDb();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await reserveLoginAttempt(db, T0, LOGIN_THROTTLE_SCOPE, "guesser");
    }
    await reserveLoginAttempt(db, T0, LOGIN_THROTTLE_SCOPE, "editor");
    const reservation = await reserveLoginAttempt(db, T0, LOGIN_THROTTLE_SCOPE, "editor");
    await recordLoginSuccess(db, reservation, T0, LOGIN_THROTTLE_SCOPE, "editor");
    const byKey = new Map(
      (await db.select().from(schema.rateLimitBuckets)).map((row) => [row.bucketKey, row.count]),
    );
    expect(byKey.has(loginClientBucketKey("editor"))).toBe(false);
    expect(byKey.get(loginClientBucketKey("guesser"))).toBe(3);
    // Three guesses plus the editor's earlier failure stay counted.
    expect(byKey.get(loginBucketKey())).toBe(4);
    client.close();
  });

  test("a success alone leaves no bucket rows behind", async () => {
    const { client, db } = await createTestDb();
    const reservation = await reserveLoginAttempt(db, T0);
    await recordLoginSuccess(db, reservation, T0);
    expect(await db.select().from(schema.rateLimitBuckets)).toHaveLength(0);
    client.close();
  });

  test("a success never refunds a newer global window", async () => {
    const { client, db } = await createTestDb();
    const stale = await reserveLoginAttempt(db, T0);
    await reserveLoginAttempt(db, T0 + LOGIN_WINDOW_MS, LOGIN_THROTTLE_SCOPE, "other");
    await recordLoginSuccess(db, stale, T0 + LOGIN_WINDOW_MS);
    const rows = await db
      .select()
      .from(schema.rateLimitBuckets)
      .where(eq(schema.rateLimitBuckets.bucketKey, loginBucketKey()));
    expect(rows[0]?.count).toBe(1);
    client.close();
  });
});

describe("clearLoginFailures", () => {
  test("removes both buckets so the next attempt starts clean", async () => {
    const { client, db } = await createTestDb();
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await reserveLoginAttempt(db, T0);
    }
    await clearLoginFailures(db);
    expect(await checkLoginThrottle(db, T0 + 1)).toEqual({ throttled: false });
    const restart = await reserveLoginAttempt(db, T0 + 2);
    expect(restart.count).toBe(1);
    client.close();
  });

  test("is a no-op when no bucket exists", async () => {
    const { client, db } = await createTestDb();
    await clearLoginFailures(db);
    expect(await db.select().from(schema.rateLimitBuckets)).toHaveLength(0);
    client.close();
  });
});
