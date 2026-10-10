// The Chrome extension's sign-in (D132): the password-for-token exchange
// behind the login route's boundary and throttle, the token's own audience
// (it never stands in for the cookie session, nor the other way round), its
// 7-day lifetime and day-old renewal (D130), sign-out, and the projects list
// the extension picks from. All secrets are test sentinels.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET as projectsGET } from "../../app/api/extension/projects/route";
import {
  DELETE as sessionDELETE,
  GET as sessionGET,
  POST as sessionPOST,
} from "../../app/api/extension/session/route";
import { GET as editorSessionGET } from "../../app/api/editor/session/route";
import { POST as importPOST } from "../../app/api/imports/route";
import { EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import {
  EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
  LOGIN_MAX_FAILURES,
} from "../../src/lib/boundaries";
import {
  __clearRevokedExtensionTokensForTests,
  createExtensionToken,
  verifyExtensionToken,
} from "../../src/lib/server/auth/extension-token";
import { createEditorSession, verifyEditorSessionToken } from "../../src/lib/server/auth/session";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
} from "../../src/lib/server/db/client";
import { __setScreenshotStoreForTests } from "../../src/lib/server/captures/deps";
import { archiveProject } from "../../src/lib/server/projects/archive";
import { encodeSolidPng } from "../helpers/png";
import { recordingStore } from "./capture-provider-fakes";
import { createTestDb, type TestDb } from "./test-db";

const TEST_PASSWORD = "extension-auth-password-sentinel";
const TEST_SECRET = "extension-auth-session-secret-sentinel-0123456789";
const T0 = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const BASE = "https://yourpinata.example";

let testDb: TestDb;

function signIn(password: string, headers: Record<string, string> = {}): Promise<Response> {
  return sessionPOST(
    new Request(`${BASE}/api/extension/session`, {
      method: "POST",
      headers: {
        origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.7",
        ...headers,
      },
      body: JSON.stringify({ password }),
    }),
  );
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function importOne(token: string, url: string) {
  const form = new FormData();
  form.set(
    "meta",
    JSON.stringify({
      idempotencyKey: crypto.randomUUID(),
      target: { newProject: {} },
      url,
      variant: "desktop",
      document: { width: 40, height: 30 },
      manifest: null,
    }),
  );
  form.set("image", new Blob([encodeSolidPng({ width: 40, height: 30 }) as BlobPart], { type: "image/png" }));
  const response = await importPOST(
    new Request(`${BASE}/api/imports`, { method: "POST", headers: bearer(token), body: form }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { project: { publicId: string }; page: { id: string } };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("EDITOR_PASSWORD", TEST_PASSWORD);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  __setScreenshotStoreForTests(recordingStore().store);
  __clearRevokedExtensionTokensForTests();
});

afterEach(() => {
  __setScreenshotStoreForTests(undefined);
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("POST /api/extension/session", () => {
  test("the editor password returns a 7-day bearer token, and nothing else does", async () => {
    const wrong = await signIn("not-the-password");
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const right = await signIn(TEST_PASSWORD);
    expect(right.status).toBe(201);
    expect(right.headers.get("set-cookie")).toBeNull();
    const body = (await right.json()) as { token: string; expiresAt: string };
    expect(body.token).toMatch(/^x1\./);
    expect(body.expiresAt).toBe(new Date(T0 + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS).toISOString());
    expect(verifyExtensionToken(body.token, TEST_SECRET, T0).status).toBe("valid");
  });

  test("guesses through the extension share the login throttle", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      expect((await signIn(`wrong-${i}`)).status).toBe(401);
    }
    const throttled = await signIn(TEST_PASSWORD);
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).not.toBeNull();
  });

  test("malformed bodies are bounded refusals", async () => {
    const extra = await sessionPOST(
      new Request(`${BASE}/api/extension/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: TEST_PASSWORD, remember: true }),
      }),
    );
    expect(extra.status).toBe(400);
    const notJson = await sessionPOST(
      new Request(`${BASE}/api/extension/session`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: TEST_PASSWORD,
      }),
    );
    expect(notJson.status).toBe(415);
  });
});

describe("the extension token's audience", () => {
  test("an extension token is not a cookie session, and a cookie session is not a bearer", async () => {
    const extension = createExtensionToken(TEST_SECRET, T0).token;
    expect(verifyEditorSessionToken(extension, TEST_SECRET, T0).status).toBe("invalid");
    const asCookie = await editorSessionGET(
      new Request(`${BASE}/api/editor/session`, {
        headers: { cookie: `${EDITOR_SESSION_COOKIE}=${extension}` },
      }),
    );
    expect(asCookie.status).toBe(401);

    const cookie = createEditorSession(TEST_SECRET, T0).token;
    expect(verifyExtensionToken(cookie, TEST_SECRET, T0).status).toBe("invalid");
    const asBearer = await sessionGET(
      new Request(`${BASE}/api/extension/session`, { headers: bearer(cookie) }),
    );
    expect(asBearer.status).toBe(401);
  });
});

describe("GET and DELETE /api/extension/session", () => {
  test("a fresh token reports its expiry; a day-old one is renewed in the headers", async () => {
    const fresh = createExtensionToken(TEST_SECRET, T0).token;
    const now = await sessionGET(new Request(`${BASE}/api/extension/session`, { headers: bearer(fresh) }));
    expect(now.status).toBe(200);
    expect(now.headers.get("x-pinata-token")).toBeNull();

    const dayOld = createExtensionToken(TEST_SECRET, T0 - DAY - 1).token;
    const renewed = await sessionGET(
      new Request(`${BASE}/api/extension/session`, { headers: bearer(dayOld) }),
    );
    expect(renewed.status).toBe(200);
    const token = renewed.headers.get("x-pinata-token")!;
    expect(token).toMatch(/^x1\./);
    expect(((await renewed.json()) as { expiresAt: string }).expiresAt).toBe(
      new Date(T0 + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS).toISOString(),
    );
    expect(verifyExtensionToken(token, TEST_SECRET, T0).status).toBe("valid");
  });

  test("a token past seven days is refused", async () => {
    const expired = createExtensionToken(TEST_SECRET, T0 - EDITOR_SESSION_ABSOLUTE_LIFETIME_MS).token;
    const response = await sessionGET(
      new Request(`${BASE}/api/extension/session`, { headers: bearer(expired) }),
    );
    expect(response.status).toBe(401);
  });

  test("signing out ends the token", async () => {
    const token = createExtensionToken(TEST_SECRET, T0).token;
    const out = await sessionDELETE(
      new Request(`${BASE}/api/extension/session`, { method: "DELETE", headers: bearer(token) }),
    );
    expect(out.status).toBe(204);
    const after = await sessionGET(
      new Request(`${BASE}/api/extension/session`, { headers: bearer(token) }),
    );
    expect(after.status).toBe(401);
  });
});

describe("GET /api/extension/projects", () => {
  test("lists live projects with their pages, newest first, and needs the token", async () => {
    const token = createExtensionToken(TEST_SECRET, T0).token;
    const first = await importOne(token, "https://app.example.com/a");
    vi.setSystemTime(T0 + 1_000);
    const second = await importOne(token, "https://admin.example.com/b");
    vi.setSystemTime(T0 + 2_000);
    const archived = await importOne(token, "https://old.example.com/");
    await archiveProject(testDb.db, archived.project.publicId, T0 + 3_000);

    const denied = await projectsGET(new Request(`${BASE}/api/extension/projects`));
    expect(denied.status).toBe(401);

    const response = await projectsGET(
      new Request(`${BASE}/api/extension/projects`, { headers: bearer(token) }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      projects: { publicId: string; title: string; pages: { id: string; normalizedUrl: string }[] }[];
    };
    expect(body.projects.map((project) => project.publicId)).toEqual([
      second.project.publicId,
      first.project.publicId,
    ]);
    expect(body.projects[1]).toEqual({
      publicId: first.project.publicId,
      title: "app.example.com",
      rootUrl: "https://app.example.com/a",
      pages: [{ id: first.page.id, normalizedUrl: "https://app.example.com/a" }],
    });
  });
});
