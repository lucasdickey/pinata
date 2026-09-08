// Route-level tests for durable editor-login throttling and fail-closed
// secret handling (VAL-AUTH-006, D026). The login route runs against an
// injected in-memory database with the committed migrations applied and an
// injected clock, so the published threshold and the exact recovery boundary
// are exercised deterministically. All secrets are test sentinels.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as loginPOST } from "../../app/api/auth/login/route";
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from "../../src/lib/boundaries";
import { EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { loginBucketKey } from "../../src/lib/server/auth/throttle";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

const TEST_PASSWORD = "throttle-route-password-sentinel";
const TEST_SECRET = "throttle-route-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const LOGIN_URL = `${ORIGIN}/api/auth/login`;
const T0 = 1_800_000_000_000;

function loginRequest(password: string): Request {
  return new Request(LOGIN_URL, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

async function bucketRows() {
  return testDb.db.select().from(schema.rateLimitBuckets);
}

let testDb: TestDb;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("EDITOR_PASSWORD", TEST_PASSWORD);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
});

afterEach(() => {
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("POST /api/auth/login throttling", () => {
  test("schema-invalid attempts never reach the durable bucket", async () => {
    const malformed = new Request(LOGIN_URL, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ password: "" }),
    });
    const response = await loginPOST(malformed);
    expect(response.status).toBe(400);
    expect(await bucketRows()).toHaveLength(0);
  });

  test("wrong passwords cross the published threshold into generic throttling", async () => {
    for (let attempt = 1; attempt <= LOGIN_MAX_FAILURES; attempt += 1) {
      const response = await loginPOST(loginRequest("wrong-password"));
      expect(response.status, `attempt ${attempt}`).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    const rows = await bucketRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.bucketKey).toBe(loginBucketKey());
    expect(rows[0]?.count).toBe(LOGIN_MAX_FAILURES);
    // The durable row holds only the digest and counters — no password.
    expect(JSON.stringify(rows[0])).not.toContain("wrong-password");
    expect(JSON.stringify(rows[0])).not.toContain(TEST_PASSWORD);

    const throttled = await loginPOST(loginRequest("wrong-password"));
    expect(throttled.status).toBe(429);
    const retryAfter = Number(throttled.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(LOGIN_WINDOW_MS / 1000);
    const text = await throttled.text();
    expect(text.length).toBeLessThan(200);
    expect(text).not.toContain("wrong-password");
    expect(text).not.toContain(TEST_PASSWORD);
    expect(throttled.headers.getSetCookie()).toEqual([]);
    // A rejected attempt does not extend or mutate the window.
    expect((await bucketRows())[0]?.count).toBe(LOGIN_MAX_FAILURES);
  });

  test("even the correct password is rejected while throttled, without timing oracle cookies", async () => {
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await loginPOST(loginRequest("wrong-password"));
    }
    const response = await loginPOST(loginRequest(TEST_PASSWORD));
    expect(response.status).toBe(429);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.text()).not.toContain(TEST_PASSWORD);
  });

  test("a correct attempt succeeds immediately at the exact recovery boundary", async () => {
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await loginPOST(loginRequest("wrong-password"));
    }
    vi.setSystemTime(T0 + LOGIN_WINDOW_MS - 1);
    const justBefore = await loginPOST(loginRequest(TEST_PASSWORD));
    expect(justBefore.status).toBe(429);

    vi.setSystemTime(T0 + LOGIN_WINDOW_MS);
    const recovered = await loginPOST(loginRequest(TEST_PASSWORD));
    expect(recovered.status).toBe(200);
    const session = recovered.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${EDITOR_SESSION_COOKIE}=`));
    expect(session).toBeDefined();
    // Success cleared the durable bucket.
    expect(await bucketRows()).toHaveLength(0);
  });

  test("rejected attempts do not extend the window", async () => {
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await loginPOST(loginRequest("wrong-password"));
    }
    vi.setSystemTime(T0 + LOGIN_WINDOW_MS / 2);
    const mid = await loginPOST(loginRequest("wrong-password"));
    expect(mid.status).toBe(429);
    vi.setSystemTime(T0 + LOGIN_WINDOW_MS);
    const recovered = await loginPOST(loginRequest(TEST_PASSWORD));
    expect(recovered.status).toBe(200);
  });

  test("a successful login clears earlier failures so counting restarts", async () => {
    await loginPOST(loginRequest("wrong-password"));
    await loginPOST(loginRequest("wrong-password"));
    const ok = await loginPOST(loginRequest(TEST_PASSWORD));
    expect(ok.status).toBe(200);
    expect(await bucketRows()).toHaveLength(0);
    const again = await loginPOST(loginRequest("wrong-password"));
    expect(again.status).toBe(401);
    expect((await bucketRows())[0]?.count).toBe(1);
  });
});

describe("POST /api/auth/login fail-closed configuration", () => {
  test("a missing session secret answers every attempt with the same bounded 503", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    const wrong = await loginPOST(loginRequest("wrong-password"));
    const right = await loginPOST(loginRequest(TEST_PASSWORD));
    // No password-correctness oracle: identical status and body.
    expect(wrong.status).toBe(503);
    expect(right.status).toBe(503);
    const wrongText = await wrong.text();
    expect(await right.text()).toBe(wrongText);
    expect(wrongText).not.toContain("SESSION_SECRET");
    expect(wrongText).not.toContain(TEST_PASSWORD);
    for (const response of [wrong, right]) {
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    // Misconfiguration is not abuse: the durable bucket is untouched.
    expect(await bucketRows()).toHaveLength(0);
  });

  test("a missing editor password authenticates nobody and names no variable or default", async () => {
    vi.stubEnv("EDITOR_PASSWORD", "");
    const response = await loginPOST(loginRequest(TEST_PASSWORD));
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text.length).toBeLessThan(200);
    expect(text).not.toContain("EDITOR_PASSWORD");
    expect(text).not.toContain(TEST_PASSWORD);
    expect(response.headers.getSetCookie()).toEqual([]);
    // Repeated attempts still meet the durable throttle, generically.
    for (let attempt = 1; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await loginPOST(loginRequest("wrong-password"));
    }
    const throttled = await loginPOST(loginRequest(TEST_PASSWORD));
    expect(throttled.status).toBe(429);
  });

  test("an unavailable durable store fails closed with a bounded 503", async () => {
    __setDatabaseForTests(null);
    const response = await loginPOST(loginRequest(TEST_PASSWORD));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text.length).toBeLessThan(200);
    expect(text).not.toContain(TEST_PASSWORD);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
