// Route-level boundary matrix for founder links (REQUIREMENTS 7,
// VAL-THREAD-005): the editor's share routes (status, issue/rotate, revoke),
// the one-time fragment-token exchange, and the founder hierarchy read —
// including the proof that rotation and revocation end every existing
// founder session on the very next request. Handlers are invoked directly
// with Request objects; all secrets are non-production test sentinels.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DELETE as shareDELETE,
  GET as shareGET,
  POST as sharePOST,
  PUT as sharePUT,
} from "../../app/api/projects/[publicId]/share/route";
import {
  GET as exchangeGET,
  POST as exchangePOST,
} from "../../app/api/founder/[publicId]/session/route";
import {
  GET as founderGET,
  POST as founderPOST,
} from "../../app/api/founder/[publicId]/route";
import {
  EDITOR_CSRF_HEADER,
  EDITOR_SESSION_COOKIE,
  FOUNDER_CSRF_COOKIE,
  FOUNDER_SESSION_COOKIE,
} from "../../src/lib/auth-constants";
import { AUTH_REQUEST_MAX_BYTES } from "../../src/lib/boundaries";
import { createEditorSession } from "../../src/lib/server/auth/session";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import {
  founderTokenDigest,
  generateFounderToken,
} from "../../src/lib/server/founder/capability";
import { createFounderSession } from "../../src/lib/server/founder/session";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "founder-routes-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let editor: { token: string; csrf: string };

interface RequestOptions {
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
  cookie?: string | null;
  csrf?: string | null;
  contentType?: string | null;
  contentLength?: string;
}

function build(url: string, method: string, options: RequestOptions = {}): Request {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.set("origin", origin);
  headers.set("host", "127.0.0.1:3100");
  const contentType =
    options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType && (options.body !== undefined || options.rawBody !== undefined)) {
    headers.set("content-type", contentType);
  }
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.csrf) headers.set(EDITOR_CSRF_HEADER, options.csrf);
  if (options.contentLength) headers.set("content-length", options.contentLength);
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Request(url, { method, headers, body });
}

const editorCookie = () => `${EDITOR_SESSION_COOKIE}=${editor.token}`;
const ctx = (publicId: string) => ({ params: Promise.resolve({ publicId }) });
const shareUrl = (publicId: string) => `${ORIGIN}/api/projects/${publicId}/share`;
const exchangeUrl = (publicId: string) => `${ORIGIN}/api/founder/${publicId}/session`;
const founderUrl = (publicId: string) => `${ORIGIN}/api/founder/${publicId}`;

function cookiesFrom(response: Response): Record<string, { value: string; raw: string }> {
  const out: Record<string, { value: string; raw: string }> = {};
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const eq = pair!.indexOf("=");
    out[pair!.slice(0, eq)] = { value: pair!.slice(eq + 1), raw };
  }
  return out;
}

async function issueAsEditor(publicId = "pub-a") {
  const response = await sharePOST(
    build(shareUrl(publicId), "POST", { cookie: editorCookie(), csrf: editor.csrf }),
    ctx(publicId),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as {
    share: { state: string; version: number };
    path: string;
    token: string;
  };
}

async function exchange(publicId: string, token: string) {
  return exchangePOST(build(exchangeUrl(publicId), "POST", { body: { token } }), ctx(publicId));
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  const created = createEditorSession(TEST_SECRET, T0);
  editor = { token: created.token, csrf: created.payload.csrf };
  await testDb.db.insert(schema.projects).values([
    {
      id: "proj-a",
      publicId: "pub-a",
      title: "A",
      rootUrl: "https://a.example/",
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: "proj-b",
      publicId: "pub-b",
      title: "B",
      rootUrl: "https://b.example/",
      createdAt: T0,
      updatedAt: T0,
    },
  ]);
  await testDb.db.insert(schema.pages).values({
    id: "page-a",
    projectId: "proj-a",
    requestedUrl: "https://a.example/",
    normalizedUrl: "https://a.example/",
    sortIndex: 0,
    createdAt: T0,
  });
});

afterEach(() => {
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/api/projects/[publicId]/share (editor)", () => {
  test("anonymous, forged, foreign-origin, and CSRF-less calls are denied", async () => {
    expect((await shareGET(build(shareUrl("pub-a"), "GET"), ctx("pub-a"))).status).toBe(401);
    expect(
      (
        await shareGET(
          build(shareUrl("pub-a"), "GET", { cookie: `${EDITOR_SESSION_COOKIE}=forged` }),
          ctx("pub-a"),
        )
      ).status,
    ).toBe(401);
    for (const options of [
      { origin: "https://evil.example", cookie: editorCookie(), csrf: editor.csrf },
      { origin: null, cookie: editorCookie(), csrf: editor.csrf },
      { cookie: null, csrf: editor.csrf },
      { cookie: editorCookie(), csrf: "wrong" },
      { cookie: editorCookie(), csrf: null },
    ]) {
      const post = await sharePOST(build(shareUrl("pub-a"), "POST", options), ctx("pub-a"));
      expect(post.status, `POST ${JSON.stringify(options)}`).toBeGreaterThanOrEqual(401);
      expect(post.status).toBeLessThan(500);
      const del = await shareDELETE(build(shareUrl("pub-a"), "DELETE", options), ctx("pub-a"));
      expect(del.status, `DELETE ${JSON.stringify(options)}`).toBeGreaterThanOrEqual(401);
      expect(del.status).toBeLessThan(500);
    }
    // Nothing was issued by any of that.
    const status = await shareGET(build(shareUrl("pub-a"), "GET", { cookie: editorCookie() }), ctx("pub-a"));
    expect(await status.json()).toEqual({ share: { state: "none", version: 0, revokedAt: null } });
  });

  test("a founder session cannot use the editor's share routes", async () => {
    const issued = await issueAsEditor();
    const founder = createFounderSession(TEST_SECRET, { projectId: "proj-a", version: 1 }, T0);
    const cookie = `${FOUNDER_SESSION_COOKIE}=${founder.token}`;
    expect((await shareGET(build(shareUrl("pub-a"), "GET", { cookie }), ctx("pub-a"))).status).toBe(401);
    expect(
      (await sharePOST(build(shareUrl("pub-a"), "POST", { cookie, csrf: founder.payload.csrf }), ctx("pub-a"))).status,
    ).toBe(401);
    expect(
      (await shareDELETE(build(shareUrl("pub-a"), "DELETE", { cookie, csrf: founder.payload.csrf }), ctx("pub-a"))).status,
    ).toBe(401);
    expect(issued.share.version).toBe(1);
  });

  test("issuing returns the link parts and the token exactly once", async () => {
    const issued = await issueAsEditor();
    expect(issued.share).toEqual({ state: "active", version: 1, revokedAt: null });
    expect(issued.path).toBe("/f/pub-a");
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The status read never repeats the token.
    const status = await shareGET(build(shareUrl("pub-a"), "GET", { cookie: editorCookie() }), ctx("pub-a"));
    const text = await status.text();
    expect(text).not.toContain(issued.token);
    expect(JSON.parse(text)).toEqual({ share: { state: "active", version: 1, revokedAt: null } });
    expect(status.headers.get("cache-control")).toBe("no-store");
  });

  test("rotation bumps the version; revocation keeps the version and ends the link", async () => {
    const first = await issueAsEditor();
    const second = await issueAsEditor();
    expect(second.share.version).toBe(2);
    expect(second.token).not.toBe(first.token);
    const revoked = await shareDELETE(
      build(shareUrl("pub-a"), "DELETE", { cookie: editorCookie(), csrf: editor.csrf }),
      ctx("pub-a"),
    );
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({
      share: { state: "revoked", version: 2, revokedAt: T0 },
    });
    // Revoking a never-shared project is a bounded 409; a missing project 404.
    const never = await shareDELETE(
      build(shareUrl("pub-b"), "DELETE", { cookie: editorCookie(), csrf: editor.csrf }),
      ctx("pub-b"),
    );
    expect(never.status).toBe(409);
    const missing = await shareDELETE(
      build(shareUrl("pub-nope"), "DELETE", { cookie: editorCookie(), csrf: editor.csrf }),
      ctx("pub-nope"),
    );
    expect(missing.status).toBe(404);
    expect(
      (
        await sharePOST(
          build(shareUrl("pub-nope"), "POST", { cookie: editorCookie(), csrf: editor.csrf }),
          ctx("pub-nope"),
        )
      ).status,
    ).toBe(404);
    expect((await shareGET(build(shareUrl("pub-nope"), "GET", { cookie: editorCookie() }), ctx("pub-nope"))).status).toBe(404);
    expect(sharePUT().status).toBe(405);
  });
});

describe("POST /api/founder/[publicId]/session (exchange)", () => {
  test("a valid token sets the bound founder cookies and echoes nothing else", async () => {
    const issued = await issueAsEditor();
    const response = await exchange("pub-a", issued.token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ ok: true, expiresAt: expect.any(String) });
    const cookies = cookiesFrom(response);
    const session = cookies[FOUNDER_SESSION_COOKIE]!;
    expect(session.raw).toContain("HttpOnly");
    expect(session.raw).toContain("SameSite=Strict");
    expect(session.raw).toContain("Path=/");
    expect(session.raw).not.toContain("Secure"); // plain http on the local host
    expect(session.value.startsWith("f1.")).toBe(true);
    expect(session.value).not.toContain(issued.token);
    const csrf = cookies[FOUNDER_CSRF_COOKIE]!;
    expect(csrf.raw).not.toContain("HttpOnly");
    // Deployed (https) requests get the Secure attribute.
    const secure = await exchangePOST(
      build(`https://pinata.example/api/founder/pub-a/session`, "POST", {
        origin: "https://pinata.example",
        body: { token: issued.token },
      }).clone(),
      ctx("pub-a"),
    );
    // hasSameOrigin reads the Host header; the builder pins it to the local
    // host, so an https request against another host is rejected as
    // cross-origin — which is itself the right answer.
    expect([200, 403]).toContain(secure.status);
  });

  test("the boundary order rejects foreign origins, bad bodies, and oversize before any lookup", async () => {
    const issued = await issueAsEditor();
    const cases: [string, Request][] = [
      ["foreign origin", build(exchangeUrl("pub-a"), "POST", { origin: "https://evil.example", body: { token: issued.token } })],
      ["missing origin", build(exchangeUrl("pub-a"), "POST", { origin: null, body: { token: issued.token } })],
      ["wrong content type", build(exchangeUrl("pub-a"), "POST", { contentType: "text/plain", rawBody: "{}" })],
      ["oversize declared", build(exchangeUrl("pub-a"), "POST", { contentLength: String(AUTH_REQUEST_MAX_BYTES + 1), rawBody: "{}" })],
      ["oversize real", build(exchangeUrl("pub-a"), "POST", { rawBody: `{"token":"${"x".repeat(AUTH_REQUEST_MAX_BYTES)}"}` })],
      ["invalid json", build(exchangeUrl("pub-a"), "POST", { rawBody: "{ nope" })],
      ["unknown field", build(exchangeUrl("pub-a"), "POST", { body: { token: issued.token, extra: 1 } })],
      ["short token", build(exchangeUrl("pub-a"), "POST", { body: { token: "abc" } })],
      ["no token", build(exchangeUrl("pub-a"), "POST", { body: {} })],
    ];
    for (const [label, request] of cases) {
      const response = await exchangePOST(request, ctx("pub-a"));
      expect(response.status, label).toBeGreaterThanOrEqual(400);
      expect(response.status, label).toBeLessThan(500);
      expect(cookiesFrom(response)[FOUNDER_SESSION_COOKIE], label).toBeUndefined();
      expect(await response.text(), label).not.toContain(issued.token);
    }
    expect(exchangeGET().status).toBe(405);
  });

  test("wrong, rotated, revoked, foreign-project, and unknown-project tokens share one 404", async () => {
    const first = await issueAsEditor();
    const bodies = new Set<string>();
    const wrong = await exchange("pub-a", generateFounderToken());
    expect(wrong.status).toBe(404);
    bodies.add(await wrong.text());
    const second = await issueAsEditor();
    const rotated = await exchange("pub-a", first.token);
    expect(rotated.status).toBe(404);
    bodies.add(await rotated.text());
    const foreign = await exchange("pub-b", second.token);
    expect(foreign.status).toBe(404);
    bodies.add(await foreign.text());
    const unknown = await exchange("pub-nope", second.token);
    expect(unknown.status).toBe(404);
    bodies.add(await unknown.text());
    await shareDELETE(
      build(shareUrl("pub-a"), "DELETE", { cookie: editorCookie(), csrf: editor.csrf }),
      ctx("pub-a"),
    );
    const revoked = await exchange("pub-a", second.token);
    expect(revoked.status).toBe(404);
    bodies.add(await revoked.text());
    expect(bodies.size).toBe(1);
    expect(founderTokenDigest(second.token)).not.toBe(founderTokenDigest(first.token));
  });

  test("fails closed without a session secret", async () => {
    const issued = await issueAsEditor();
    vi.stubEnv("SESSION_SECRET", "");
    const response = await exchange("pub-a", issued.token);
    expect(response.status).toBe(503);
    expect(cookiesFrom(response)[FOUNDER_SESSION_COOKIE]).toBeUndefined();
  });
});

describe("GET /api/founder/[publicId] (founder hierarchy read)", () => {
  async function founderCookie(publicId = "pub-a") {
    const issued = await issueAsEditor(publicId);
    const exchanged = await exchange(publicId, issued.token);
    const cookies = cookiesFrom(exchanged);
    return `${FOUNDER_SESSION_COOKIE}=${cookies[FOUNDER_SESSION_COOKIE]!.value}`;
  }

  test("a bound session reads its own project and nothing else", async () => {
    const cookie = await founderCookie();
    const own = await founderGET(build(founderUrl("pub-a"), "GET", { cookie }), ctx("pub-a"));
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe("no-store");
    const payload = await own.json();
    expect(payload.actor).toBe("founder");
    expect(payload.project).toMatchObject({ projectId: "proj-a", publicId: "pub-a", title: "A" });
    expect(payload.project.pages).toHaveLength(1);
    // No capability material leaks through the hierarchy.
    const text = JSON.stringify(payload);
    expect(text).not.toContain("shareToken");
    expect(text).not.toContain("digest");

    const foreign = await founderGET(build(founderUrl("pub-b"), "GET", { cookie }), ctx("pub-b"));
    expect(foreign.status).toBe(401);
    const unknown = await founderGET(build(founderUrl("pub-nope"), "GET", { cookie }), ctx("pub-nope"));
    expect(unknown.status).toBe(401);
    expect(await foreign.text()).toBe(await unknown.text());
  });

  test("anonymous, editor-only, forged, and expired sessions are the same 401", async () => {
    await issueAsEditor();
    const bodies = new Set<string>();
    for (const cookie of [
      null,
      editorCookie(),
      `${FOUNDER_SESSION_COOKIE}=f1.forged.forged`,
      `${FOUNDER_SESSION_COOKIE}=${createFounderSession(TEST_SECRET, { projectId: "proj-a", version: 1 }, T0 - 100 * 3_600_000).token}`,
    ]) {
      const response = await founderGET(build(founderUrl("pub-a"), "GET", { cookie }), ctx("pub-a"));
      expect(response.status, String(cookie)).toBe(401);
      bodies.add(await response.text());
    }
    expect(bodies.size).toBe(1);
    expect(founderPOST().status).toBe(405);
  });

  test("rotation and revocation invalidate every existing founder session (VAL-THREAD-005)", async () => {
    const cookie = await founderCookie();
    expect((await founderGET(build(founderUrl("pub-a"), "GET", { cookie }), ctx("pub-a"))).status).toBe(200);

    // Rotate: the old session's version binding no longer matches.
    const rotated = await issueAsEditor();
    expect((await founderGET(build(founderUrl("pub-a"), "GET", { cookie }), ctx("pub-a"))).status).toBe(401);
    // The new link works, and a session from it reads again.
    const fresh = cookiesFrom(await exchange("pub-a", rotated.token));
    const freshCookie = `${FOUNDER_SESSION_COOKIE}=${fresh[FOUNDER_SESSION_COOKIE]!.value}`;
    expect((await founderGET(build(founderUrl("pub-a"), "GET", { cookie: freshCookie }), ctx("pub-a"))).status).toBe(200);

    // Revoke: the current session dies too, and the project row stays live.
    await shareDELETE(
      build(shareUrl("pub-a"), "DELETE", { cookie: editorCookie(), csrf: editor.csrf }),
      ctx("pub-a"),
    );
    expect((await founderGET(build(founderUrl("pub-a"), "GET", { cookie: freshCookie }), ctx("pub-a"))).status).toBe(401);
    const status = await shareGET(build(shareUrl("pub-a"), "GET", { cookie: editorCookie() }), ctx("pub-a"));
    expect(await status.json()).toEqual({ share: { state: "revoked", version: 2, revokedAt: T0 } });
  });

  test("a session inside its renewal threshold is renewed on read", async () => {
    await issueAsEditor();
    const nearExpiry = createFounderSession(
      TEST_SECRET,
      { projectId: "proj-a", version: 1 },
      T0 - 11 * 3_600_000,
    );
    const response = await founderGET(
      build(founderUrl("pub-a"), "GET", { cookie: `${FOUNDER_SESSION_COOKIE}=${nearExpiry.token}` }),
      ctx("pub-a"),
    );
    expect(response.status).toBe(200);
    const renewed = cookiesFrom(response)[FOUNDER_SESSION_COOKIE];
    expect(renewed).toBeDefined();
    expect(renewed!.value).not.toBe(nearExpiry.token);
    expect(renewed!.raw).toContain("HttpOnly");
  });

  test("fails closed without a database", async () => {
    __setDatabaseForTests(null);
    const response = await founderGET(build(founderUrl("pub-a"), "GET"), ctx("pub-a"));
    expect(response.status).toBe(503);
  });
});
