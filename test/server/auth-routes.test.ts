// Route-level tests for the auth endpoints (VAL-AUTH-001): the full denial
// matrix plus successful login, cookie attributes, logout replay denial, and
// the protected editor session read. Handlers are invoked directly with
// Request objects; all secrets are non-production test sentinels.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as loginPOST } from "../../app/api/auth/login/route";
import { POST as logoutPOST } from "../../app/api/auth/logout/route";
import { GET as sessionGET } from "../../app/api/editor/session/route";
import {
  AUTH_REQUEST_MAX_BYTES,
  EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
  EDITOR_SESSION_RENEWAL_THRESHOLD_MS,
} from "../../src/lib/boundaries";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import {
  createEditorSession,
  verifyEditorSessionToken,
  __clearRevokedSessionsForTests,
} from "../../src/lib/server/auth/session";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
} from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

const TEST_PASSWORD = "route-test-password-sentinel";
const TEST_SECRET = "route-test-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const LOGIN_URL = `${ORIGIN}/api/auth/login`;
const LOGOUT_URL = `${ORIGIN}/api/auth/logout`;
const SESSION_URL = `${ORIGIN}/api/editor/session`;

function loginRequest(init: {
  headers?: Record<string, string>;
  body?: string;
}): Request {
  return new Request(LOGIN_URL, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...init.headers },
    body: init.body ?? JSON.stringify({ password: TEST_PASSWORD }),
  });
}

function cookieHeaderFrom(response: Response): string {
  const setCookies = response.headers.getSetCookie();
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

function sessionTokenFrom(response: Response): string {
  const session = response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${EDITOR_SESSION_COOKIE}=`));
  if (!session) throw new Error("no session cookie set");
  return session.split(";")[0].slice(EDITOR_SESSION_COOKIE.length + 1);
}

let testDb: TestDb;

beforeEach(async () => {
  vi.stubEnv("EDITOR_PASSWORD", TEST_PASSWORD);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  __clearRevokedSessionsForTests();
  // Login throttling is durable (VAL-AUTH-006): inject a fresh migrated
  // in-memory database per test so buckets never leak between tests.
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
});

afterEach(() => {
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  __clearRevokedSessionsForTests();
});

describe("POST /api/auth/login", () => {
  test("a valid password issues session and CSRF cookies with secure attributes", async () => {
    const response = await loginPOST(loginRequest({}));
    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie();
    const session = setCookies.find((c) => c.startsWith(`${EDITOR_SESSION_COOKIE}=`));
    expect(session).toBeDefined();
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Strict");
    expect(session).toContain("Path=/");
    // Local http request: no Secure attribute (deployed https adds it).
    expect(session).not.toContain("Secure");
    const csrf = setCookies.find((c) => c.startsWith("pinata_csrf="));
    expect(csrf).toBeDefined();
    expect(csrf).not.toContain("HttpOnly");
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("deployed (https) login marks cookies Secure", async () => {
    const request = new Request("https://pinata.example/api/auth/login", {
      method: "POST",
      headers: { origin: "https://pinata.example", "content-type": "application/json" },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    const response = await loginPOST(request);
    expect(response.status).toBe(200);
    for (const cookie of response.headers.getSetCookie()) {
      expect(cookie).toContain("Secure");
    }
  });

  test("wrong, empty, non-string, extra-field, and oversized passwords create no session", async () => {
    const cases: string[] = [
      JSON.stringify({ password: "wrong" }),
      JSON.stringify({ password: "" }),
      JSON.stringify({ password: 42 }),
      JSON.stringify({ password: ["x"] }),
      JSON.stringify({ password: TEST_PASSWORD, username: "lucas" }),
      JSON.stringify({}),
      "not json at all",
    ];
    for (const body of cases) {
      const response = await loginPOST(loginRequest({ body }));
      expect([400, 401], body).toContain(response.status);
      expect(response.headers.getSetCookie()).toEqual([]);
      const text = await response.text();
      expect(text.length).toBeLessThan(200);
      expect(text).not.toContain(TEST_PASSWORD);
    }
  });

  test("wrong content type, oversized declared length, and oversized body are rejected", async () => {
    const textPlain = await loginPOST(
      loginRequest({ headers: { "content-type": "text/plain" } }),
    );
    expect(textPlain.status).toBe(415);

    const declared = await loginPOST(
      loginRequest({ headers: { "content-length": String(AUTH_REQUEST_MAX_BYTES + 1) } }),
    );
    expect(declared.status).toBe(413);

    const oversized = await loginPOST(
      loginRequest({ body: `{"password":"${"x".repeat(AUTH_REQUEST_MAX_BYTES)}"}` }),
    );
    expect(oversized.status).toBe(413);
    expect(oversized.headers.getSetCookie()).toEqual([]);
  });

  test("missing and foreign origins are rejected without a session", async () => {
    const noOrigin = new Request(LOGIN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    const deniedMissing = await loginPOST(noOrigin);
    expect(deniedMissing.status).toBe(403);

    const foreign = await loginPOST(loginRequest({ headers: { origin: "https://evil.example" } }));
    expect(foreign.status).toBe(403);
    expect(foreign.headers.getSetCookie()).toEqual([]);
  });

  test("missing configuration fails closed with a generic denial and no variable name", async () => {
    vi.stubEnv("EDITOR_PASSWORD", "");
    const response = await loginPOST(loginRequest({}));
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).not.toContain("EDITOR_PASSWORD");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  test("login does not require a pre-session CSRF proof", async () => {
    // Contract: pre-session login must not demand a cookie-authorized CSRF
    // token; Origin plus the strict body boundary is its documented defense.
    const response = await loginPOST(loginRequest({}));
    expect(response.status).toBe(200);
  });
});

describe("POST /api/auth/logout", () => {
  async function login(): Promise<Response> {
    return loginPOST(loginRequest({}));
  }

  test("logout revokes the session server-side so the old cookie cannot be replayed", async () => {
    const loginResponse = await login();
    const cookieHeader = cookieHeaderFrom(loginResponse);
    const token = sessionTokenFrom(loginResponse);
    const csrf = cookieHeader
      .split("; ")
      .find((c) => c.startsWith("pinata_csrf="))!
      .slice("pinata_csrf=".length);

    const logoutResponse = await logoutPOST(
      new Request(LOGOUT_URL, {
        method: "POST",
        headers: { origin: ORIGIN, cookie: cookieHeader, [EDITOR_CSRF_HEADER]: csrf },
      }),
    );
    expect(logoutResponse.status).toBe(200);
    for (const cleared of logoutResponse.headers.getSetCookie()) {
      expect(cleared).toContain("Max-Age=0");
      expect(cleared).toContain("Path=/");
      expect(cleared).toContain("SameSite=Strict");
    }

    // Replay of the pre-logout cookie fails.
    expect(verifyEditorSessionToken(token, TEST_SECRET, Date.now()).status).toBe("invalid");
    const replay = await sessionGET(
      new Request(SESSION_URL, { headers: { cookie: cookieHeader } }),
    );
    expect(replay.status).toBe(401);
  });

  test("a live session cannot be logged out without its CSRF proof", async () => {
    const loginResponse = await login();
    const cookieHeader = cookieHeaderFrom(loginResponse);

    const deniedLogout = await logoutPOST(
      new Request(LOGOUT_URL, {
        method: "POST",
        headers: { origin: ORIGIN, cookie: cookieHeader },
      }),
    );
    expect(deniedLogout.status).toBe(403);

    // The session is still valid.
    const stillValid = await sessionGET(
      new Request(SESSION_URL, { headers: { cookie: cookieHeader } }),
    );
    expect(stillValid.status).toBe(200);
  });

  test("cross-origin logout fails and repeated logout is idempotent", async () => {
    const loginResponse = await login();
    const cookieHeader = cookieHeaderFrom(loginResponse);

    const crossOrigin = await logoutPOST(
      new Request(LOGOUT_URL, {
        method: "POST",
        headers: { origin: "https://evil.example", cookie: cookieHeader },
      }),
    );
    expect(crossOrigin.status).toBe(403);

    // No session at all: still a safe, generic success.
    const anonymous = await logoutPOST(
      new Request(LOGOUT_URL, { method: "POST", headers: { origin: ORIGIN } }),
    );
    expect(anonymous.status).toBe(200);
  });
});

describe("GET /api/editor/session (authorization boundary)", () => {
  test("anonymous and forged-cookie callers receive the same generic denial", async () => {
    const anonymous = await sessionGET(new Request(SESSION_URL));
    expect(anonymous.status).toBe(401);

    const forged = await sessionGET(
      new Request(SESSION_URL, {
        headers: { cookie: `${EDITOR_SESSION_COOKIE}=v1.forged.forged` },
      }),
    );
    expect(forged.status).toBe(401);
    expect(await forged.text()).toBe(await (await sessionGET(new Request(SESSION_URL))).text());
  });

  test("an expired session is denied", async () => {
    const past = Date.now() - EDITOR_SESSION_ABSOLUTE_LIFETIME_MS - 1000;
    const { token } = createEditorSession(TEST_SECRET, past);
    const response = await sessionGET(
      new Request(SESSION_URL, { headers: { cookie: `${EDITOR_SESSION_COOKIE}=${token}` } }),
    );
    expect(response.status).toBe(401);
  });

  test("a valid session reads back its identity and expiry", async () => {
    const loginResponse = await loginPOST(loginRequest({}));
    const cookieHeader = cookieHeaderFrom(loginResponse);
    const response = await sessionGET(
      new Request(SESSION_URL, { headers: { cookie: cookieHeader } }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { authenticated: boolean; actor: string };
    expect(body).toEqual({ authenticated: true, actor: "editor", expiresAt: expect.any(String) });
  });

  test("a session inside the renewal threshold is renewed with a fresh absolute expiry", async () => {
    const now = Date.now();
    const issued =
      now - (EDITOR_SESSION_ABSOLUTE_LIFETIME_MS - EDITOR_SESSION_RENEWAL_THRESHOLD_MS) - 1000;
    const { token } = createEditorSession(TEST_SECRET, issued);
    const response = await sessionGET(
      new Request(SESSION_URL, { headers: { cookie: `${EDITOR_SESSION_COOKIE}=${token}` } }),
    );
    expect(response.status).toBe(200);
    const renewedCookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${EDITOR_SESSION_COOKIE}=`));
    expect(renewedCookie).toBeDefined();
    const renewedToken = renewedCookie!.split(";")[0].slice(EDITOR_SESSION_COOKIE.length + 1);
    const renewed = verifyEditorSessionToken(renewedToken, TEST_SECRET, Date.now());
    expect(renewed.status).toBe("valid");
    if (renewed.status === "valid") {
      expect(renewed.payload.exp).toBeGreaterThan(now + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS - 5000);
    }
  });
});
