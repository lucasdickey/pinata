// Route-level tests for durable editor-login throttling and fail-closed
// secret handling (VAL-AUTH-006, D026, D098). The login route runs against
// an injected in-memory database with the committed migrations applied and
// an injected clock, so the published thresholds, the exact recovery
// boundary, the reserve-before-verify ordering under concurrency, and the
// per-client/global bucket split are exercised deterministically. All
// secrets are test sentinels.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as loginPOST } from "../../app/api/auth/login/route";
import {
  LOGIN_GLOBAL_MAX_FAILURES,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
} from "../../src/lib/boundaries";
import { EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { verifyEditorPassword } from "../../src/lib/server/auth/password";
import {
  LOGIN_UNKNOWN_CLIENT,
  loginBucketKey,
  loginClientBucketKey,
} from "../../src/lib/server/auth/throttle";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

// Count how many attempts actually reach the password verifier, without
// changing what it answers (D098: reservation happens before verification).
vi.mock("../../src/lib/server/auth/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/server/auth/password")>();
  return { ...actual, verifyEditorPassword: vi.fn(actual.verifyEditorPassword) };
});

const TEST_PASSWORD = "throttle-route-password-sentinel";
const TEST_SECRET = "throttle-route-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const LOGIN_URL = `${ORIGIN}/api/auth/login`;
const T0 = 1_800_000_000_000;

function loginRequest(password: string, clientIp?: string): Request {
  return new Request(LOGIN_URL, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      ...(clientIp ? { "x-real-ip": clientIp } : {}),
    },
    body: JSON.stringify({ password }),
  });
}

async function bucketRows() {
  return testDb.db.select().from(schema.rateLimitBuckets);
}

/** Current count per bucket key; absent keys have no row. */
async function bucketCounts(): Promise<Map<string, number>> {
  return new Map((await bucketRows()).map((row) => [row.bucketKey, row.count]));
}

const GLOBAL_KEY = loginBucketKey();
const UNKNOWN_CLIENT_KEY = loginClientBucketKey(LOGIN_UNKNOWN_CLIENT);

let testDb: TestDb;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("EDITOR_PASSWORD", TEST_PASSWORD);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  vi.mocked(verifyEditorPassword).mockClear();
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
    // One per-client and one global bucket (D098), both counting.
    expect(rows).toHaveLength(2);
    expect(await bucketCounts()).toEqual(
      new Map([
        [UNKNOWN_CLIENT_KEY, LOGIN_MAX_FAILURES],
        [GLOBAL_KEY, LOGIN_MAX_FAILURES],
      ]),
    );
    // The durable rows hold only digests and counters — no password.
    expect(JSON.stringify(rows)).not.toContain("wrong-password");
    expect(JSON.stringify(rows)).not.toContain(TEST_PASSWORD);

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
    expect((await bucketCounts()).get(UNKNOWN_CLIENT_KEY)).toBe(LOGIN_MAX_FAILURES);
    expect((await bucketCounts()).get(GLOBAL_KEY)).toBe(LOGIN_MAX_FAILURES);
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

  test("a successful login clears the client's failures so counting restarts", async () => {
    await loginPOST(loginRequest("wrong-password"));
    await loginPOST(loginRequest("wrong-password"));
    const ok = await loginPOST(loginRequest(TEST_PASSWORD));
    expect(ok.status).toBe(200);
    // The client bucket is gone; the global bucket keeps the two real
    // failures and hands back only the successful attempt's slot (D098).
    expect(await bucketCounts()).toEqual(new Map([[GLOBAL_KEY, 2]]));
    const again = await loginPOST(loginRequest("wrong-password"));
    expect(again.status).toBe(401);
    expect((await bucketCounts()).get(UNKNOWN_CLIENT_KEY)).toBe(1);
  });
});

describe("POST /api/auth/login reserves before verifying (D098)", () => {
  test("parallel wrong attempts: at most the published limit reach the verifier", async () => {
    const attempts = 4 * LOGIN_MAX_FAILURES;
    const responses = await Promise.all(
      Array.from({ length: attempts }, () => loginPOST(loginRequest("wrong-password"))),
    );
    expect(vi.mocked(verifyEditorPassword).mock.calls.length).toBeLessThanOrEqual(
      LOGIN_MAX_FAILURES,
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(LOGIN_MAX_FAILURES);
    expect(statuses.filter((s) => s !== 401).every((s) => s === 429)).toBe(true);
    for (const response of responses) expect(response.headers.getSetCookie()).toEqual([]);
    // Nothing else can get in during the window, not even the right password.
    const after = await loginPOST(loginRequest(TEST_PASSWORD));
    expect(after.status).toBe(429);
  });

  test("a throttled attempt never reaches the verifier", async () => {
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await loginPOST(loginRequest("wrong-password"));
    }
    vi.mocked(verifyEditorPassword).mockClear();
    expect((await loginPOST(loginRequest(TEST_PASSWORD))).status).toBe(429);
    expect(verifyEditorPassword).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login per-client and global buckets (D098)", () => {
  const GUESSER = "203.0.113.7";
  const EDITOR = "198.51.100.20";

  test("a guesser elsewhere cannot lock the editor out", async () => {
    for (let attempt = 0; attempt < 2 * LOGIN_MAX_FAILURES; attempt += 1) {
      await loginPOST(loginRequest("wrong-password", GUESSER));
    }
    expect((await loginPOST(loginRequest("wrong-password", GUESSER))).status).toBe(429);
    const editor = await loginPOST(loginRequest(TEST_PASSWORD, EDITOR));
    expect(editor.status).toBe(200);
    expect(
      editor.headers.getSetCookie().some((c) => c.startsWith(`${EDITOR_SESSION_COOKIE}=`)),
    ).toBe(true);
    // The guesser's own bucket is untouched by the editor's success.
    expect((await loginPOST(loginRequest(TEST_PASSWORD, GUESSER))).status).toBe(429);
  });

  test("the first x-forwarded-for entry identifies the client when x-real-ip is absent", async () => {
    const forwarded = (password: string, chain: string) =>
      new Request(LOGIN_URL, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "x-forwarded-for": chain,
        },
        body: JSON.stringify({ password }),
      });
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await loginPOST(forwarded("wrong-password", `${GUESSER}, 10.0.0.1`));
    }
    expect((await loginPOST(forwarded(TEST_PASSWORD, `${GUESSER}, 10.0.0.2`))).status).toBe(429);
    expect((await loginPOST(forwarded(TEST_PASSWORD, `${EDITOR}, 10.0.0.1`))).status).toBe(200);
  });

  test("guessing spread across addresses meets the global ceiling", async () => {
    const clients = LOGIN_GLOBAL_MAX_FAILURES / LOGIN_MAX_FAILURES;
    for (let c = 0; c < clients; c += 1) {
      for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
        const response = await loginPOST(loginRequest("wrong-password", `192.0.2.${c}`));
        expect(response.status).toBe(401);
      }
    }
    vi.setSystemTime(T0 + 1_000);
    const blocked = await loginPOST(loginRequest(TEST_PASSWORD, EDITOR));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBe((LOGIN_WINDOW_MS - 1_000) / 1000);
    // The global window recovers at exactly its published boundary too.
    vi.setSystemTime(T0 + LOGIN_WINDOW_MS);
    expect((await loginPOST(loginRequest(TEST_PASSWORD, EDITOR))).status).toBe(200);
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
    // Misconfiguration is not abuse: no bucket is touched, not even by a
    // reservation (the secret check runs before it, D098).
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
