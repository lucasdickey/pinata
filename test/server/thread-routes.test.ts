// Boundary matrix for the thread routes
// GET/POST /api/captures/[captureId]/annotations/[annotationId]/thread
// (REQUIREMENTS 6, VAL-THREAD-001, VAL-THREAD-003, VAL-THREAD-004,
// VAL-THREAD-006): editor and founder reads, founder replies labelled
// `founder`, editor follow-ups labelled `Lucas`, the durable founder quota,
// the bounded body, idempotent replay, and the generic rejections for
// tombstoned pins, foreign projects, and rotated or revoked capabilities.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DELETE as threadDELETE,
  GET as threadGET,
  PATCH as threadPATCH,
  POST as threadPOST,
  PUT as threadPUT,
} from "../../app/api/captures/[captureId]/annotations/[annotationId]/thread/route";
import {
  EDITOR_CSRF_HEADER,
  EDITOR_SESSION_COOKIE,
  FOUNDER_SESSION_COOKIE,
} from "../../src/lib/auth-constants";
import {
  ANNOTATION_REQUEST_MAX_BYTES,
  FEEDBACK_BODY_MAX_CHARS,
  REPLY_MAX_PER_WINDOW,
  REPLY_WINDOW_MS,
} from "../../src/lib/boundaries";
import { createEditorSession } from "../../src/lib/server/auth/session";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import {
  issueFounderCapability,
  revokeFounderCapability,
} from "../../src/lib/server/founder/capability";
import { createFounderSession } from "../../src/lib/server/founder/session";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "thread-routes-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let editor: { token: string; csrf: string };
let founder: { token: string; csrf: string };

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
  if (contentType && method !== "GET") headers.set("content-type", contentType);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.csrf) headers.set(EDITOR_CSRF_HEADER, options.csrf);
  if (options.contentLength) headers.set("content-length", options.contentLength);
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Request(url, { method, headers, body });
}

const editorCookie = () => `${EDITOR_SESSION_COOKIE}=${editor.token}`;
const founderCookie = () => `${FOUNDER_SESSION_COOKIE}=${founder.token}`;
const url = (captureId: string, annotationId: string) =>
  `${ORIGIN}/api/captures/${captureId}/annotations/${annotationId}/thread`;
const ctx = (captureId: string, annotationId: string) => ({
  params: Promise.resolve({ captureId, annotationId }),
});

const list = (captureId: string, annotationId: string, options: RequestOptions = {}) =>
  threadGET(build(url(captureId, annotationId), "GET", options), ctx(captureId, annotationId));
const append = (captureId: string, annotationId: string, options: RequestOptions = {}) =>
  threadPOST(build(url(captureId, annotationId), "POST", options), ctx(captureId, annotationId));

const asEditor = (extra: RequestOptions = {}): RequestOptions => ({
  cookie: editorCookie(),
  csrf: editor.csrf,
  ...extra,
});
const asFounder = (extra: RequestOptions = {}): RequestOptions => ({
  cookie: founderCookie(),
  csrf: founder.csrf,
  ...extra,
});

let keys = 0;
const reply = (body = "Sounds good.") => ({ body, idempotencyKey: `thread-key-${(keys += 1)}` });

let attempts = 0;

async function seedCapture(id: string, pageId: string, status = "ready") {
  await testDb.db.insert(schema.captures).values({
    id,
    pageId,
    variant: "desktop",
    attempt: (attempts += 1),
    status,
    idempotencyKey: `initial:${id}`,
    requestedUrl: "https://a.example/",
    viewportWidth: 1440,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    documentWidth: 1440,
    documentHeight: 2000,
    imageHash: `hash-${id}`,
    createdAt: T0,
    updatedAt: T0,
  });
}

async function seedPin(id: string, captureId: string, number: number, deletedAt: number | null = null) {
  await testDb.db.insert(schema.annotations).values({
    id,
    captureId,
    kind: "pin",
    number,
    geometryJson: JSON.stringify({ x: 10, y: 20 }),
    originalBody: "Tighten this.",
    createdAt: T0,
    updatedAt: T0,
    deletedAt,
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  keys = 0;
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  const created = createEditorSession(TEST_SECRET, T0);
  editor = { token: created.token, csrf: created.payload.csrf };

  await testDb.db.insert(schema.projects).values([
    { id: "proj-a", publicId: "pub-a", title: "A", rootUrl: "https://a.example/", createdAt: T0, updatedAt: T0 },
    { id: "proj-b", publicId: "pub-b", title: "B", rootUrl: "https://b.example/", createdAt: T0, updatedAt: T0 },
  ]);
  await testDb.db.insert(schema.pages).values([
    { id: "page-a", projectId: "proj-a", requestedUrl: "https://a.example/", normalizedUrl: "https://a.example/", sortIndex: 0, createdAt: T0 },
    { id: "page-b", projectId: "proj-b", requestedUrl: "https://b.example/", normalizedUrl: "https://b.example/", sortIndex: 0, createdAt: T0 },
  ]);
  await seedCapture("cap-a", "page-a");
  await seedCapture("cap-a2", "page-a");
  await seedCapture("cap-b", "page-b");
  await seedPin("pin-a", "cap-a", 1);
  await seedPin("pin-a-gone", "cap-a", 2, T0 + 1);
  await seedPin("pin-b", "cap-b", 1);

  // Project A's founder: a real issued capability and a session bound to it.
  const issued = await issueFounderCapability(testDb.db, "pub-a", T0);
  expect(issued).not.toBeNull();
  const session = createFounderSession(TEST_SECRET, { projectId: "proj-a", version: issued!.status.version }, T0);
  founder = { token: session.token, csrf: session.payload.csrf };
});

afterEach(() => {
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GET thread", () => {
  test("editor and founder both read the same ordered entries; others are denied", async () => {
    const first = await append("cap-a", "pin-a", asFounder({ body: reply("First.") }));
    expect(first.status).toBe(201);
    vi.setSystemTime(T0 + 10);
    const second = await append("cap-a", "pin-a", asEditor({ body: reply("Second.") }));
    expect(second.status).toBe(201);

    for (const options of [asEditor(), asFounder()]) {
      const response = await list("cap-a", "pin-a", options);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const payload = (await response.json()) as { entries: Record<string, unknown>[] };
      expect(payload.entries.map((entry) => [entry.authorLabel, entry.actorRole, entry.body])).toEqual([
        ["founder", "founder", "First."],
        ["Lucas", "editor", "Second."],
      ]);
      // No idempotency key or other internals ride along.
      expect(JSON.stringify(payload)).not.toContain("idempotency");
    }

    const bodies = new Set<string>();
    for (const cookie of [null, `${EDITOR_SESSION_COOKIE}=forged`, `${FOUNDER_SESSION_COOKIE}=f1.x.y`]) {
      const response = await list("cap-a", "pin-a", { cookie });
      expect(response.status, String(cookie)).toBe(401);
      bodies.add(await response.text());
    }
    expect(bodies.size).toBe(1);
  });

  test("a founder cannot read another project's thread; tombstoned pins are 404", async () => {
    const foreign = await list("cap-b", "pin-b", asFounder());
    expect(foreign.status).toBe(401);
    const editorForeign = await list("cap-b", "pin-b", asEditor());
    expect(editorForeign.status).toBe(200);
    const gone = await list("cap-a", "pin-a-gone", asEditor());
    expect(gone.status).toBe(404);
    const wrongCapture = await list("cap-a2", "pin-a", asEditor());
    expect(wrongCapture.status).toBe(404);
    expect(await gone.text()).toBe(await wrongCapture.text());
  });
});

describe("POST thread", () => {
  test("the founder replies as founder/founder and the editor follows up as editor/Lucas", async () => {
    const founderReply = await append("cap-a", "pin-a", asFounder({ body: reply("Founder here.") }));
    expect(founderReply.status).toBe(201);
    const founderEntry = (await founderReply.json()).entry;
    expect(founderEntry).toMatchObject({
      annotationId: "pin-a",
      actorRole: "founder",
      authorLabel: "founder",
      body: "Founder here.",
      createdAt: T0,
    });
    const editorReply = await append("cap-a", "pin-a", asEditor({ body: reply("Lucas here.") }));
    expect(editorReply.status).toBe(201);
    expect((await editorReply.json()).entry).toMatchObject({
      actorRole: "editor",
      authorLabel: "Lucas",
      body: "Lucas here.",
    });
    // The label is server-assigned: a request cannot choose one.
    const spoofed = await append(
      "cap-a",
      "pin-a",
      asFounder({ body: { ...reply("Spoof."), authorLabel: "Lucas", actorRole: "editor" } }),
    );
    expect(spoofed.status).toBe(400);
    const rows = await testDb.db.select().from(schema.threadEntries);
    expect(rows.map((row) => row.authorLabel)).toEqual(["founder", "Lucas"]);
  });

  test("rejects foreign origin, missing origin, anonymous, and bad-CSRF calls before any write", async () => {
    for (const options of [
      asFounder({ origin: "https://evil.example" }),
      asFounder({ origin: null }),
      asEditor({ origin: null }),
      { cookie: null, csrf: null },
      asFounder({ csrf: "wrong-proof" }),
      asFounder({ csrf: null }),
      asEditor({ csrf: "wrong-proof" }),
    ]) {
      const response = await append("cap-a", "pin-a", { ...options, body: reply() });
      expect(response.status, JSON.stringify(options)).toBeGreaterThanOrEqual(401);
      expect(response.status, JSON.stringify(options)).toBeLessThan(500);
    }
    expect(await testDb.db.select().from(schema.threadEntries)).toHaveLength(0);
  });

  test("rejects wrong content type, oversize bodies, invalid JSON, and unknown fields", async () => {
    expect((await append("cap-a", "pin-a", asFounder({ contentType: "text/plain", rawBody: "{}" }))).status).toBe(415);
    expect(
      (
        await append(
          "cap-a",
          "pin-a",
          asFounder({ contentLength: String(ANNOTATION_REQUEST_MAX_BYTES + 1), rawBody: "{}" }),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await append(
          "cap-a",
          "pin-a",
          asFounder({ rawBody: `{ "body": "${"x".repeat(ANNOTATION_REQUEST_MAX_BYTES)}" }` }),
        )
      ).status,
    ).toBe(413);
    expect((await append("cap-a", "pin-a", asFounder({ rawBody: "{ nope" }))).status).toBe(400);
    expect((await append("cap-a", "pin-a", asFounder({ body: { ...reply(), extra: true } }))).status).toBe(400);
    expect((await append("cap-a", "pin-a", asFounder({ body: { body: "x" } }))).status).toBe(400);
    expect((await append("cap-a", "pin-a", asFounder({ body: { body: "x", idempotencyKey: "short" } }))).status).toBe(400);
    expect(await testDb.db.select().from(schema.threadEntries)).toHaveLength(0);
  });

  test("the body is bounded by FEEDBACK_BODY_MAX_CHARS (VAL-THREAD-004)", async () => {
    const over = await append("cap-a", "pin-a", asFounder({ body: reply("x".repeat(FEEDBACK_BODY_MAX_CHARS + 1)) }));
    expect(over.status).toBe(400);
    const blank = await append("cap-a", "pin-a", asFounder({ body: reply("   ") }));
    expect(blank.status).toBe(400);
    const empty = await append("cap-a", "pin-a", asFounder({ body: reply("") }));
    expect(empty.status).toBe(400);
    const atLimit = await append("cap-a", "pin-a", asFounder({ body: reply("y".repeat(FEEDBACK_BODY_MAX_CHARS)) }));
    expect(atLimit.status).toBe(201);
    expect(await testDb.db.select().from(schema.threadEntries)).toHaveLength(1);
  });

  test("a replayed key returns the committed entry with 200 and consumes no quota", async () => {
    const body = reply("Once only.");
    const first = await append("cap-a", "pin-a", asFounder({ body }));
    expect(first.status).toBe(201);
    const firstEntry = (await first.json()).entry;
    vi.setSystemTime(T0 + 500);
    const again = await append("cap-a", "pin-a", asFounder({ body }));
    expect(again.status).toBe(200);
    expect((await again.json()).entry).toEqual(firstEntry);
    const conflict = await append("cap-a", "pin-a", asFounder({ body: { ...body, body: "Changed." } }));
    expect(conflict.status).toBe(409);
    expect(await testDb.db.select().from(schema.threadEntries)).toHaveLength(1);
    const buckets = await testDb.db.select().from(schema.rateLimitBuckets);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.count).toBe(1);
  });

  test("founder replies are quota-bound per project; editor follow-ups are not (VAL-THREAD-006)", async () => {
    for (let n = 1; n <= REPLY_MAX_PER_WINDOW; n += 1) {
      vi.setSystemTime(T0 + n);
      const response = await append("cap-a", "pin-a", asFounder({ body: reply(`Reply ${n}`) }));
      expect(response.status, `reply ${n}`).toBe(201);
    }
    vi.setSystemTime(T0 + REPLY_MAX_PER_WINDOW + 1);
    const throttled = await append("cap-a", "pin-a", asFounder({ body: reply("One too many") }));
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Buffer.byteLength(await throttled.text())).toBeLessThan(200);
    // The rejected reply changed nothing and did not extend the window.
    expect(await testDb.db.select().from(schema.threadEntries)).toHaveLength(REPLY_MAX_PER_WINDOW);
    const editorFollowUp = await append("cap-a", "pin-a", asEditor({ body: reply("Editor still fine") }));
    expect(editorFollowUp.status).toBe(201);
    // The window recovers exactly REPLY_WINDOW_MS after the first reply.
    vi.setSystemTime(T0 + 1 + REPLY_WINDOW_MS - 1);
    expect((await append("cap-a", "pin-a", asFounder({ body: reply("Still early") }))).status).toBe(429);
    vi.setSystemTime(T0 + 1 + REPLY_WINDOW_MS);
    expect((await append("cap-a", "pin-a", asFounder({ body: reply("Recovered") }))).status).toBe(201);
  });

  test("tombstoned pins, wrong captures, and foreign projects are generic 404/401s", async () => {
    const gone = await append("cap-a", "pin-a-gone", asFounder({ body: reply() }));
    expect(gone.status).toBe(404);
    const goneEditor = await append("cap-a", "pin-a-gone", asEditor({ body: reply() }));
    expect(goneEditor.status).toBe(404);
    const wrongCapture = await append("cap-a2", "pin-a", asFounder({ body: reply() }));
    expect(wrongCapture.status).toBe(404);
    const foreign = await append("cap-b", "pin-b", asFounder({ body: reply() }));
    expect(foreign.status).toBe(401);
    const missing = await append("cap-a", "pin-missing", asFounder({ body: reply() }));
    expect(missing.status).toBe(404);
    expect(await gone.text()).toBe(await missing.text());
    expect(await testDb.db.select().from(schema.threadEntries)).toHaveLength(0);
  });

  test("a stale reply after rotation or revocation is rejected and adds nothing", async () => {
    expect((await append("cap-a", "pin-a", asFounder({ body: reply("Before") }))).status).toBe(201);
    await issueFounderCapability(testDb.db, "pub-a", T0 + 1);
    const afterRotation = await append("cap-a", "pin-a", asFounder({ body: reply("After rotation") }));
    expect(afterRotation.status).toBe(401);
    expect((await list("cap-a", "pin-a", asFounder())).status).toBe(401);
    // A session under the new version works until revocation.
    const current = createFounderSession(TEST_SECRET, { projectId: "proj-a", version: 2 }, T0);
    const currentOptions = { cookie: `${FOUNDER_SESSION_COOKIE}=${current.token}`, csrf: current.payload.csrf };
    expect((await append("cap-a", "pin-a", { ...currentOptions, body: reply("New version") })).status).toBe(201);
    await revokeFounderCapability(testDb.db, "pub-a", T0 + 2);
    const afterRevoke = await append("cap-a", "pin-a", { ...currentOptions, body: reply("After revoke") });
    expect(afterRevoke.status).toBe(401);
    const rows = await testDb.db.select().from(schema.threadEntries);
    expect(rows.map((row) => row.body)).toEqual(["Before", "New version"]);
    // The editor can still read and follow up: history survives revocation.
    expect((await list("cap-a", "pin-a", asEditor())).status).toBe(200);
    expect((await append("cap-a", "pin-a", asEditor({ body: reply("Editor after revoke") }))).status).toBe(201);
  });

  test("unsupported methods are 405", () => {
    expect(threadPUT().status).toBe(405);
    expect(threadPATCH().status).toBe(405);
    expect(threadDELETE().status).toBe(405);
  });
});
