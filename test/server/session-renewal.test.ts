// Session renewal re-issues the whole double-submit pair (D098). Renewal
// extends the session cookie's Max-Age; if the CSRF cookie is not re-issued
// with it, the browser drops the CSRF cookie at the original expiry while
// the session lives on, so reads keep working and every write answers 403.
// These tests drive real renewal sites — an editor read, an editor mutation
// that is denied after authorization, the founder hierarchy read, and the
// shared capture reader/replier for both roles — and assert that each
// renewal response sets both cookies with a fresh Max-Age. A source scan
// keeps new routes on the shared helpers. All secrets are test sentinels.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATCH as annotationPATCH } from "../../app/api/captures/[captureId]/annotations/[annotationId]/route";
import { GET as founderGET } from "../../app/api/founder/[publicId]/route";
import { GET as shareGET } from "../../app/api/projects/[publicId]/share/route";
import {
  EDITOR_CSRF_COOKIE,
  EDITOR_CSRF_HEADER,
  EDITOR_SESSION_COOKIE,
  FOUNDER_CSRF_COOKIE,
  FOUNDER_SESSION_COOKIE,
} from "../../src/lib/auth-constants";
import {
  EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
  EDITOR_SESSION_RENEWAL_THRESHOLD_MS,
} from "../../src/lib/boundaries";
import { createEditorSession, verifyEditorSessionToken } from "../../src/lib/server/auth/session";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import {
  authorizeCaptureReader,
  authorizeCaptureReplier,
} from "../../src/lib/server/founder/reader";
import { createFounderSession, verifyFounderSessionToken } from "../../src/lib/server/founder/session";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "session-renewal-secret-sentinel-0123456789";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;
const FRESH_MAX_AGE = `Max-Age=${EDITOR_SESSION_ABSOLUTE_LIFETIME_MS / 1000}`;
/** Issued so that the remaining lifetime is just inside the renewal threshold. */
const NEAR_EXPIRY_ISSUED_AT =
  T0 - (EDITOR_SESSION_ABSOLUTE_LIFETIME_MS - EDITOR_SESSION_RENEWAL_THRESHOLD_MS) - 1_000;

let testDb: TestDb;

function cookiesFrom(values: string[]): Record<string, { value: string; raw: string }> {
  const out: Record<string, { value: string; raw: string }> = {};
  for (const raw of values) {
    const [pair] = raw.split(";");
    const eq = pair!.indexOf("=");
    out[pair!.slice(0, eq)] = { value: pair!.slice(eq + 1), raw };
  }
  return out;
}

function request(url: string, method: string, headers: Record<string, string>, body?: string) {
  return new Request(url, {
    method,
    headers: { host: "127.0.0.1:3100", ...headers },
    body,
  });
}

/** Both cookies of the pair are present, fresh, and carry the session's proof. */
function expectFreshPair(
  values: string[],
  names: { session: string; csrf: string },
  csrf: string,
): string {
  const cookies = cookiesFrom(values);
  const session = cookies[names.session];
  const csrfCookie = cookies[names.csrf];
  expect(session, names.session).toBeDefined();
  expect(csrfCookie, names.csrf).toBeDefined();
  expect(session!.raw).toContain(FRESH_MAX_AGE);
  expect(csrfCookie!.raw).toContain(FRESH_MAX_AGE);
  expect(session!.raw).toContain("HttpOnly");
  expect(csrfCookie!.raw).not.toContain("HttpOnly");
  expect(csrfCookie!.value).toBe(csrf);
  return session!.value;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("PINATA_AUTH_DISABLED", "");
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  await testDb.db.insert(schema.projects).values({
    id: "proj-a",
    publicId: "pub-a",
    title: "A",
    rootUrl: "https://a.example/",
    createdAt: T0,
    updatedAt: T0,
    shareTokenDigest: "0".repeat(64),
    shareTokenVersion: 1,
  });
  await testDb.db.insert(schema.pages).values({
    id: "page-a",
    projectId: "proj-a",
    requestedUrl: "https://a.example/",
    normalizedUrl: "https://a.example/",
    sortIndex: 0,
    createdAt: T0,
  });
  await testDb.db.insert(schema.captures).values({
    id: "cap-a",
    pageId: "page-a",
    variant: "desktop",
    attempt: 1,
    status: "pending",
    idempotencyKey: "cap-a-key",
    requestedUrl: "https://a.example/",
    viewportWidth: 1440,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    blobPath: "captures/page-a/cap-a-internal.png",
    createdAt: T0,
    updatedAt: T0,
  });
});

afterEach(() => {
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("editor renewal re-issues the CSRF cookie with the session (D098)", () => {
  test("an editor read (share status) renews both cookies", async () => {
    const { token, payload } = createEditorSession(TEST_SECRET, NEAR_EXPIRY_ISSUED_AT);
    const response = await shareGET(
      request(`${ORIGIN}/api/projects/pub-a/share`, "GET", {
        cookie: `${EDITOR_SESSION_COOKIE}=${token}`,
      }),
      { params: Promise.resolve({ publicId: "pub-a" }) },
    );
    expect(response.status).toBe(200);
    const renewed = expectFreshPair(
      response.headers.getSetCookie(),
      { session: EDITOR_SESSION_COOKIE, csrf: EDITOR_CSRF_COOKIE },
      payload.csrf,
    );
    const verified = verifyEditorSessionToken(renewed, TEST_SECRET, T0);
    expect(verified.status).toBe("valid");
    if (verified.status === "valid") {
      expect(verified.payload.exp).toBe(T0 + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS);
      expect(verified.payload.csrf).toBe(payload.csrf);
    }
  });

  test("an editor mutation renews both cookies, even on a post-auth denial", async () => {
    const { token, payload } = createEditorSession(TEST_SECRET, NEAR_EXPIRY_ISSUED_AT);
    const response = await annotationPATCH(
      request(
        `${ORIGIN}/api/captures/cap-a/annotations/ann-x`,
        "PATCH",
        {
          origin: ORIGIN,
          "content-type": "application/json",
          cookie: `${EDITOR_SESSION_COOKIE}=${token}`,
          [EDITOR_CSRF_HEADER]: payload.csrf,
        },
        "not json",
      ),
      { params: Promise.resolve({ captureId: "cap-a", annotationId: "ann-x" }) },
    );
    expect(response.status).toBe(400);
    expectFreshPair(
      response.headers.getSetCookie(),
      { session: EDITOR_SESSION_COOKIE, csrf: EDITOR_CSRF_COOKIE },
      payload.csrf,
    );
  });

  test("a session outside the threshold sets no cookies at all", async () => {
    const { token } = createEditorSession(TEST_SECRET, T0);
    const response = await shareGET(
      request(`${ORIGIN}/api/projects/pub-a/share`, "GET", {
        cookie: `${EDITOR_SESSION_COOKIE}=${token}`,
      }),
      { params: Promise.resolve({ publicId: "pub-a" }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  test("the capture reader and replier renew both editor cookies", async () => {
    const { token, payload } = createEditorSession(TEST_SECRET, NEAR_EXPIRY_ISSUED_AT);
    const headers = {
      origin: ORIGIN,
      cookie: `${EDITOR_SESSION_COOKIE}=${token}`,
      [EDITOR_CSRF_HEADER]: payload.csrf,
    };
    const url = `${ORIGIN}/api/captures/cap-a/annotations`;
    for (const authorize of [authorizeCaptureReader, authorizeCaptureReplier]) {
      const result = await authorize(request(url, "POST", headers), testDb.db, "cap-a", false);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expectFreshPair(
        result.actor.renewCookies,
        { session: EDITOR_SESSION_COOKIE, csrf: EDITOR_CSRF_COOKIE },
        payload.csrf,
      );
    }
  });
});

describe("founder renewal re-issues the CSRF cookie with the session (D098)", () => {
  test("the founder hierarchy read renews both founder cookies", async () => {
    const { token, payload } = createFounderSession(
      TEST_SECRET,
      { projectId: "proj-a", version: 1 },
      NEAR_EXPIRY_ISSUED_AT,
    );
    const response = await founderGET(
      request(`${ORIGIN}/api/founder/pub-a`, "GET", {
        cookie: `${FOUNDER_SESSION_COOKIE}=${token}`,
      }),
      { params: Promise.resolve({ publicId: "pub-a" }) },
    );
    expect(response.status).toBe(200);
    const renewed = expectFreshPair(
      response.headers.getSetCookie(),
      { session: FOUNDER_SESSION_COOKIE, csrf: FOUNDER_CSRF_COOKIE },
      payload.csrf,
    );
    const verified = verifyFounderSessionToken(renewed, TEST_SECRET, T0);
    expect(verified.status).toBe("valid");
    if (verified.status === "valid") {
      expect(verified.payload.exp).toBe(T0 + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS);
    }
  });

  test("the capture reader and replier renew both founder cookies", async () => {
    const { token, payload } = createFounderSession(
      TEST_SECRET,
      { projectId: "proj-a", version: 1 },
      NEAR_EXPIRY_ISSUED_AT,
    );
    const headers = {
      origin: ORIGIN,
      cookie: `${FOUNDER_SESSION_COOKIE}=${token}`,
      [EDITOR_CSRF_HEADER]: payload.csrf,
    };
    const url = `${ORIGIN}/api/captures/cap-a/annotations`;
    for (const authorize of [authorizeCaptureReader, authorizeCaptureReplier]) {
      const result = await authorize(request(url, "POST", headers), testDb.db, "cap-a", false);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.actor.role).toBe("founder");
      expectFreshPair(
        result.actor.renewCookies,
        { session: FOUNDER_SESSION_COOKIE, csrf: FOUNDER_CSRF_COOKIE },
        payload.csrf,
      );
    }
  });
});

describe("renewal cannot drift back to a session-only cookie (D098)", () => {
  // Only the cookie modules and the two places that mint a brand-new session
  // (and append its CSRF cookie right beside it) may serialize a session
  // cookie directly. Every renewal goes through appendEditorRenewal,
  // appendFounderRenewal, or the reader's renewCookies, which always carry
  // the pair.
  const ALLOWED = new Set([
    join("src", "lib", "server", "auth", "cookies.ts"),
    join("src", "lib", "server", "founder", "cookies.ts"),
    join("app", "api", "auth", "login", "route.ts"),
    join("app", "api", "founder", "[publicId]", "session", "route.ts"),
  ]);

  function* sourceFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) yield* sourceFiles(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) yield path;
    }
  }

  test("no other module serializes a session cookie on its own", () => {
    const root = process.cwd();
    const offenders: string[] = [];
    for (const base of ["src", "app"]) {
      for (const file of sourceFiles(join(root, base))) {
        const relative = file.slice(root.length + 1);
        if (ALLOWED.has(relative)) continue;
        const content = readFileSync(file, "utf8");
        if (/\b(sessionCookie|founderSessionCookie)\s*\(/.test(content)) offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });
});
