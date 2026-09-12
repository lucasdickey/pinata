// Boundary matrix for the per-pin feedback routes (D075):
// POST .../annotations/[annotationId]/resolve, .../reopen, .../seen.
// Both roles may call them with the same same-origin and CSRF checks the
// thread append route uses; the founder capability grants exactly reply,
// resolve, reopen, and seen and still cannot create, move, edit, or delete;
// and each role's hierarchy read carries its own counts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DELETE as itemDELETE,
  PATCH as itemPATCH,
} from "../../app/api/captures/[captureId]/annotations/[annotationId]/route";
import {
  GET as reopenGET,
  POST as reopenPOST,
} from "../../app/api/captures/[captureId]/annotations/[annotationId]/reopen/route";
import {
  DELETE as resolveDELETE,
  POST as resolvePOST,
} from "../../app/api/captures/[captureId]/annotations/[annotationId]/resolve/route";
import {
  PATCH as seenPATCH,
  POST as seenPOST,
} from "../../app/api/captures/[captureId]/annotations/[annotationId]/seen/route";
import { GET as threadGET } from "../../app/api/captures/[captureId]/annotations/[annotationId]/thread/route";
import {
  GET as listGET,
  POST as createPOST,
} from "../../app/api/captures/[captureId]/annotations/route";
import { GET as founderGET } from "../../app/api/founder/[publicId]/route";
import { GET as projectsGET } from "../../app/api/projects/route";
import {
  EDITOR_CSRF_HEADER,
  EDITOR_SESSION_COOKIE,
  FOUNDER_SESSION_COOKIE,
} from "../../src/lib/auth-constants";
import { createEditorSession } from "../../src/lib/server/auth/session";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import { issueFounderCapability } from "../../src/lib/server/founder/capability";
import { createFounderSession } from "../../src/lib/server/founder/session";
import { appendThreadEntry } from "../../src/lib/server/threads/entries";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "feedback-routes-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let editor: { token: string; csrf: string };
let founder: { token: string; csrf: string };

interface RequestOptions {
  body?: unknown;
  origin?: string | null;
  cookie?: string | null;
  csrf?: string | null;
}

function build(url: string, method: string, options: RequestOptions = {}): Request {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.set("origin", origin);
  headers.set("host", "127.0.0.1:3100");
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.csrf) headers.set(EDITOR_CSRF_HEADER, options.csrf);
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Request(url, { method, headers, body });
}

const editorCookie = () => `${EDITOR_SESSION_COOKIE}=${editor.token}`;
const founderCookie = () => `${FOUNDER_SESSION_COOKIE}=${founder.token}`;
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

const pinUrl = (captureId: string, annotationId: string, tail = "") =>
  `${ORIGIN}/api/captures/${captureId}/annotations/${annotationId}${tail}`;
const ctx = (captureId: string, annotationId: string) => ({
  params: Promise.resolve({ captureId, annotationId }),
});

const resolve = (captureId: string, annotationId: string, options: RequestOptions = {}) =>
  resolvePOST(build(pinUrl(captureId, annotationId, "/resolve"), "POST", options), ctx(captureId, annotationId));
const reopen = (captureId: string, annotationId: string, options: RequestOptions = {}) =>
  reopenPOST(build(pinUrl(captureId, annotationId, "/reopen"), "POST", options), ctx(captureId, annotationId));
const seen = (captureId: string, annotationId: string, options: RequestOptions = {}) =>
  seenPOST(build(pinUrl(captureId, annotationId, "/seen"), "POST", options), ctx(captureId, annotationId));
const thread = (captureId: string, annotationId: string, options: RequestOptions = {}) =>
  threadGET(build(pinUrl(captureId, annotationId, "/thread"), "GET", options), ctx(captureId, annotationId));
const list = (captureId: string, options: RequestOptions = {}) =>
  listGET(build(`${ORIGIN}/api/captures/${captureId}/annotations`, "GET", options), {
    params: Promise.resolve({ captureId }),
  });

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

let keys = 0;
async function founderReplies(annotationId: string, at: number, captureId = "cap-a") {
  const result = await appendThreadEntry(
    testDb.db,
    { captureId, annotationId, actorRole: "founder", body: `reply ${at}`, idempotencyKey: `k-${(keys += 1)}` },
    { now: () => at, newId: () => `entry-${keys}` },
  );
  if (!result.ok) throw new Error(`fixture reply failed: ${result.error}`);
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
  await seedCapture("cap-b", "page-b");
  await seedPin("pin-a", "cap-a", 1);
  await seedPin("pin-a2", "cap-a", 2);
  await seedPin("pin-a-gone", "cap-a", 3, T0 + 1);
  await seedPin("pin-b", "cap-b", 1);

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

describe("resolve and reopen", () => {
  test("either role resolves and reopens; the thread carries the status entries", async () => {
    vi.setSystemTime(T0 + 10);
    const resolved = await resolve("cap-a", "pin-a", asFounder());
    expect(resolved.status).toBe(200);
    expect(resolved.headers.get("cache-control")).toBe("no-store");
    const payload = await resolved.json();
    expect(payload.annotation).toMatchObject({ id: "pin-a", status: "resolved", revision: 1 });
    expect(payload.entry).toMatchObject({
      kind: "status",
      actorRole: "founder",
      authorLabel: "founder",
      body: "Resolved by founder",
      createdAt: T0 + 10,
    });
    expect(JSON.stringify(payload)).not.toContain("idempotency");

    // Already resolved: same record, no new entry.
    const again = await resolve("cap-a", "pin-a", asEditor());
    expect(again.status).toBe(200);
    expect((await again.json()).entry).toBeNull();

    vi.setSystemTime(T0 + 20);
    const reopened = await reopen("cap-a", "pin-a", asEditor());
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({
      annotation: { status: "open" },
      entry: { kind: "status", actorRole: "editor", authorLabel: "Lucas", body: "Reopened by editor" },
    });

    const entries = (await (await thread("cap-a", "pin-a", asFounder())).json()).entries as {
      kind: string;
      body: string;
    }[];
    expect(entries.map((entry) => [entry.kind, entry.body])).toEqual([
      ["status", "Resolved by founder"],
      ["status", "Reopened by editor"],
    ]);
    const listed = (await (await list("cap-a", asEditor())).json()).annotations as { id: string; status: string }[];
    expect(listed.map((pin) => [pin.id, pin.status])).toEqual([
      ["pin-a", "open"],
      ["pin-a2", "open"],
    ]);
  });

  test("the boundary is the reply route's: origin, session, CSRF, and generic denials", async () => {
    // Foreign or missing origin first.
    expect((await resolve("cap-a", "pin-a", asEditor({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await reopen("cap-a", "pin-a", asFounder({ origin: null }))).status).toBe(403);
    // No session.
    expect((await resolve("cap-a", "pin-a")).status).toBe(401);
    expect((await seen("cap-a", "pin-a", { csrf: "anything" })).status).toBe(401);
    // A session without its CSRF proof.
    expect((await resolve("cap-a", "pin-a", { cookie: editorCookie() })).status).toBe(403);
    expect((await resolve("cap-a", "pin-a", { cookie: founderCookie() })).status).toBe(403);
    expect((await seen("cap-a", "pin-a", { cookie: founderCookie(), csrf: "wrong" })).status).toBe(403);
    // A founder bound to project A cannot touch project B's pin.
    expect((await resolve("cap-b", "pin-b", asFounder())).status).toBe(401);
    // Tombstoned, foreign-capture, and unknown pins are the generic 404.
    for (const [captureId, annotationId] of [
      ["cap-a", "pin-a-gone"],
      ["cap-a", "pin-b"],
      ["cap-a", "pin-nope"],
    ] as const) {
      const response = await resolve(captureId, annotationId, asEditor());
      expect(response.status, `${captureId}/${annotationId}`).toBe(404);
      expect(await response.json()).toEqual({ error: "Request rejected." });
    }
    // Other methods.
    expect(resolveDELETE().status).toBe(405);
    expect(reopenGET().status).toBe(405);
    expect(seenPATCH().status).toBe(405);
    // Nothing above wrote a status entry.
    expect(await testDb.db.select().from(schema.threadEntries)).toHaveLength(0);
  });

  test("fails closed without a database", async () => {
    __setDatabaseForTests(null);
    expect((await resolve("cap-a", "pin-a", asEditor())).status).toBe(503);
  });
});

describe("seen", () => {
  test("marks the pin seen for the caller's role only, and the pin list reflects it", async () => {
    await founderReplies("pin-a", T0 + 1);
    await founderReplies("pin-a2", T0 + 2);
    const before = (await (await list("cap-a", asEditor())).json()).annotations as { unreadReplies: number }[];
    expect(before.map((pin) => pin.unreadReplies)).toEqual([1, 1]);

    vi.setSystemTime(T0 + 5);
    const marked = await seen("cap-a", "pin-a", asEditor());
    expect(marked.status).toBe(200);
    expect(await marked.json()).toEqual({ seen: true });
    const after = (await (await list("cap-a", asEditor())).json()).annotations as { unreadReplies: number }[];
    expect(after.map((pin) => pin.unreadReplies)).toEqual([0, 1]);

    // The founder's own view is separate: the editor's follow-up is unread
    // for the founder until the founder marks it.
    await appendThreadEntry(
      testDb.db,
      { captureId: "cap-a", annotationId: "pin-a", actorRole: "editor", body: "Thanks", idempotencyKey: "k-editor" },
      { now: () => T0 + 6, newId: () => "entry-editor" },
    );
    const founderBefore = (await (await list("cap-a", asFounder())).json()).annotations as { unreadReplies: number }[];
    expect(founderBefore.map((pin) => pin.unreadReplies)).toEqual([1, 0]);
    vi.setSystemTime(T0 + 7);
    expect((await seen("cap-a", "pin-a", asFounder())).status).toBe(200);
    const founderAfter = (await (await list("cap-a", asFounder())).json()).annotations as { unreadReplies: number }[];
    expect(founderAfter.map((pin) => pin.unreadReplies)).toEqual([0, 0]);
    const views = await testDb.db.select().from(schema.annotationViews);
    expect(views.map((view) => [view.role, view.viewerKey, view.seenAt])).toEqual([
      ["editor", "editor", T0 + 5],
      ["founder", "founder:v1", T0 + 7],
    ]);
  });
});

describe("the founder boundary is otherwise unchanged", () => {
  test("a founder session cannot create, move, edit, or delete a pin", async () => {
    const create = await createPOST(
      build(`${ORIGIN}/api/captures/cap-a/annotations`, "POST", asFounder({
        body: { tip: { x: 1, y: 1 }, body: "Founder pin", elementId: null, idempotencyKey: "founder-create-1" },
      })),
      { params: Promise.resolve({ captureId: "cap-a" }) },
    );
    expect(create.status).toBe(401);
    const move = await itemPATCH(
      build(pinUrl("cap-a", "pin-a"), "PATCH", asFounder({ body: { tip: { x: 2, y: 2 }, expectedRevision: 1 } })),
      ctx("cap-a", "pin-a"),
    );
    expect(move.status).toBe(401);
    const edit = await itemPATCH(
      build(pinUrl("cap-a", "pin-a"), "PATCH", asFounder({ body: { body: "Rewritten", expectedRevision: 1 } })),
      ctx("cap-a", "pin-a"),
    );
    expect(edit.status).toBe(401);
    const remove = await itemDELETE(
      build(pinUrl("cap-a", "pin-a"), "DELETE", asFounder({ body: { expectedRevision: 1 } })),
      ctx("cap-a", "pin-a"),
    );
    expect(remove.status).toBe(401);
    const pins = await testDb.db.select().from(schema.annotations);
    expect(pins.filter((pin) => pin.captureId === "cap-a" && pin.deletedAt === null)).toHaveLength(2);
    expect(pins.find((pin) => pin.id === "pin-a")).toMatchObject({
      originalBody: "Tighten this.",
      geometryJson: JSON.stringify({ x: 10, y: 20 }),
      revision: 1,
    });
  });
});

describe("hierarchy counts per role", () => {
  test("the editor's and the founder's reads each carry their own unread counts", async () => {
    await founderReplies("pin-a", T0 + 1);
    await founderReplies("pin-a", T0 + 2);
    await appendThreadEntry(
      testDb.db,
      { captureId: "cap-a", annotationId: "pin-a2", actorRole: "editor", body: "Ping", idempotencyKey: "k-ping" },
      { now: () => T0 + 3, newId: () => "entry-ping" },
    );
    await resolve("cap-a", "pin-a2", asEditor());

    const editorRead = await projectsGET(build(`${ORIGIN}/api/projects`, "GET", { cookie: editorCookie() }));
    expect(editorRead.status).toBe(200);
    const { projects } = (await editorRead.json()) as {
      projects: { publicId: string; feedback: unknown; captureFeedback: Record<string, unknown> }[];
    };
    const projectA = projects.find((project) => project.publicId === "pub-a")!;
    expect(projectA.feedback).toEqual({ pins: 2, open: 1, resolved: 1, unreadReplies: 2 });
    expect(projectA.captureFeedback).toEqual({
      "cap-a": { pins: 2, open: 1, resolved: 1, unreadReplies: 2 },
    });
    const projectB = projects.find((project) => project.publicId === "pub-b")!;
    expect(projectB.feedback).toEqual({ pins: 1, open: 1, resolved: 0, unreadReplies: 0 });

    const founderRead = await founderGET(
      build(`${ORIGIN}/api/founder/pub-a`, "GET", { cookie: founderCookie() }),
      { params: Promise.resolve({ publicId: "pub-a" }) },
    );
    expect(founderRead.status).toBe(200);
    const { project } = (await founderRead.json()) as {
      project: { feedback: unknown; captureFeedback: Record<string, unknown> };
    };
    expect(project.feedback).toEqual({ pins: 2, open: 1, resolved: 1, unreadReplies: 1 });
    expect(project.captureFeedback["cap-a"]).toEqual({ pins: 2, open: 1, resolved: 1, unreadReplies: 1 });

    // The founder reads pin-a2's thread: their count drops, the editor's does not.
    vi.setSystemTime(T0 + 10);
    expect((await seen("cap-a", "pin-a2", asFounder())).status).toBe(200);
    const founderAgain = (await (
      await founderGET(build(`${ORIGIN}/api/founder/pub-a`, "GET", { cookie: founderCookie() }), {
        params: Promise.resolve({ publicId: "pub-a" }),
      })
    ).json()) as { project: { feedback: { unreadReplies: number } } };
    expect(founderAgain.project.feedback.unreadReplies).toBe(0);
    const editorAgain = (await (
      await projectsGET(build(`${ORIGIN}/api/projects`, "GET", { cookie: editorCookie() }))
    ).json()) as { projects: { publicId: string; feedback: { unreadReplies: number } }[] };
    expect(editorAgain.projects.find((p) => p.publicId === "pub-a")!.feedback.unreadReplies).toBe(2);
  });
});
