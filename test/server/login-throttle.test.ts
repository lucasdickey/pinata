// Focused tests for durable editor-login throttling (VAL-AUTH-006): the
// published threshold, the exact recovery boundary, cross-handle (instance)
// sharing of the same durable bucket, atomic window reset, success clearing,
// and the guarantee that bucket state carries only a digest — never a
// password or secret. Runs against an in-memory libSQL database with the
// committed migrations applied; real Turso cross-client proof lives in
// test/integration/login-throttle.integration.test.ts.

import { describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from "../../src/lib/boundaries";
import { databaseFromClient, schema } from "../../src/lib/server/db/client";
import {
  LOGIN_THROTTLE_SCOPE,
  checkLoginThrottle,
  clearLoginFailures,
  loginBucketKey,
  registerLoginFailure,
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
});

describe("checkLoginThrottle / registerLoginFailure", () => {
  test("an empty bucket is not throttled", async () => {
    const { client, db } = await createTestDb();
    expect(await checkLoginThrottle(db, T0)).toEqual({ throttled: false });
    client.close();
  });

  test("failures up to the published limit are counted without throttling", async () => {
    const { client, db } = await createTestDb();
    for (let attempt = 1; attempt <= LOGIN_MAX_FAILURES; attempt += 1) {
      const result = await registerLoginFailure(db, T0 + attempt);
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
      await registerLoginFailure(db, T0);
    }
    // Two instances can both pass a pre-check at the boundary; the atomic
    // increment is the guard of record and reports the crossing.
    const overflow = await registerLoginFailure(db, T0 + 1000);
    expect(overflow.count).toBe(LOGIN_MAX_FAILURES + 1);
    expect(overflow.throttled).toBe(true);
    expect(overflow.retryAfterMs).toBe(LOGIN_WINDOW_MS - 1000);
    client.close();
  });

  test("recovery happens at exactly the published window boundary", async () => {
    const { client, db } = await createTestDb();
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await registerLoginFailure(db, T0);
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
      await registerLoginFailure(db, T0);
    }
    const fresh = await registerLoginFailure(db, T0 + LOGIN_WINDOW_MS);
    expect(fresh).toEqual({ count: 1, throttled: false, retryAfterMs: LOGIN_WINDOW_MS });
    const rows = await db.select().from(schema.rateLimitBuckets);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.windowStartedAt).toBe(T0 + LOGIN_WINDOW_MS);
    client.close();
  });

  test("the same durable bucket is shared across independent handles (instances)", async () => {
    const { client, db } = await createTestDb();
    // A second drizzle handle over the same connection stands in for a
    // second application instance; the integration test proves it across two
    // real Turso connections.
    const secondHandle = databaseFromClient(client);
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await registerLoginFailure(db, T0);
    }
    const seen = await checkLoginThrottle(secondHandle, T0 + 1);
    expect(seen.throttled).toBe(true);
    client.close();
  });

  test("bucket rows contain only the digest key and counters — no password or secret", async () => {
    const { client, db } = await createTestDb();
    const scope = `editor-login:test:${T0}`;
    await registerLoginFailure(db, T0, scope);
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

describe("clearLoginFailures", () => {
  test("removes the bucket so the next attempt starts clean", async () => {
    const { client, db } = await createTestDb();
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await registerLoginFailure(db, T0);
    }
    await clearLoginFailures(db);
    expect(await checkLoginThrottle(db, T0 + 1)).toEqual({ throttled: false });
    const restart = await registerLoginFailure(db, T0 + 2);
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
