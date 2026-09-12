// Boundary matrix for the pin annotation routes:
// GET/POST /api/captures/[captureId]/annotations and
// PATCH /api/captures/[captureId]/annotations/[annotationId]
// (VAL-PIN-001, VAL-PIN-003 boundary half, VAL-CANVAS-001).
//
// Boundary order matches every other mutation route: same-origin Origin,
// session + CSRF, content type and hard byte cap, strict schema, then the
// durable idempotent write. Anonymous, unauthenticated, and malformed calls
// all receive bounded generic errors that echo nothing.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  GET as annotationsGET,
  POST as annotationsPOST,
  PUT as annotationsPUT,
} from "../../app/api/captures/[captureId]/annotations/route";
import {
  DELETE as annotationDELETE,
  GET as annotationGET,
  PATCH as annotationPATCH,
} from "../../app/api/captures/[captureId]/annotations/[annotationId]/route";
import { ANNOTATION_REQUEST_MAX_BYTES } from "../../src/lib/boundaries";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { createEditorSession } from "../../src/lib/server/auth/session";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "annotations-route-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let session: { token: string; csrf: string };

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
  const cookie =
    options.cookie === undefined ? `${EDITOR_SESSION_COOKIE}=${session.token}` : options.cookie;
  if (cookie) headers.set("cookie", cookie);
  const csrf = options.csrf === undefined ? session.csrf : options.csrf;
  if (csrf) headers.set(EDITOR_CSRF_HEADER, csrf);
  if (options.contentLength) headers.set("content-length", options.contentLength);
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Request(url, { method, headers, body });
}

const listRequest = (captureId: string, options: RequestOptions = {}) =>
  build(`${ORIGIN}/api/captures/${captureId}/annotations`, "GET", options);
const createRequest = (captureId: string, options: RequestOptions = {}) =>
  build(`${ORIGIN}/api/captures/${captureId}/annotations`, "POST", options);
const moveRequest = (captureId: string, annotationId: string, options: RequestOptions = {}) =>
  build(`${ORIGIN}/api/captures/${captureId}/annotations/${annotationId}`, "PATCH", options);
const deleteRequest = (captureId: string, annotationId: string, options: RequestOptions = {}) =>
  build(`${ORIGIN}/api/captures/${captureId}/annotations/${annotationId}`, "DELETE", options);

const listContext = (captureId: string) => ({ params: Promise.resolve({ captureId }) });
const pinContext = (captureId: string, annotationId: string) => ({
  params: Promise.resolve({ captureId, annotationId }),
});

/** A minimal in-schema persisted manifest for context-decision tests. */
const ROUTE_MANIFEST = {
  schemaVersion: 1,
  truncated: false,
  elements: [
    {
      id: "cell-1",
      kind: "table-cell",
      tag: "td",
      role: "cell",
      text: "Starter plan",
      accessibleName: "",
      hints: { id: "", classes: [], alt: "", title: "", testId: "" },
      path: ["body:0", "main:0", "table:0", "tr:2", "td:1"],
      rect: { x: 800, y: 4200, width: 120, height: 48 },
    },
  ],
};

const createBody = (overrides: Record<string, unknown> = {}) => ({
  tip: { x: 812.25, y: 4231.5 },
  body: "This heading reads like a placeholder.",
  // The explicit context decision: null is "No element".
  elementId: null as string | null,
  idempotencyKey: "pin-route-key-00001",
  ...overrides,
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  const created = createEditorSession(TEST_SECRET, T0);
  session = { token: created.token, csrf: created.payload.csrf };

  await testDb.db.insert(schema.projects).values({
    id: "proj-1",
    publicId: "pub-1",
    title: "Chickpea",
    rootUrl: "https://chickpea.co/",
    shareTokenVersion: 0,
    createdAt: T0,
    updatedAt: T0,
  });
  await testDb.db.insert(schema.pages).values({
    id: "page-1",
    projectId: "proj-1",
    requestedUrl: "https://chickpea.co/",
    normalizedUrl: "https://chickpea.co/",
    sortIndex: 0,
    createdAt: T0,
  });
  await testDb.db.insert(schema.captures).values({
    id: "cap-ready",
    pageId: "page-1",
    variant: "desktop",
    attempt: 1,
    status: "ready",
    idempotencyKey: "initial:cap-ready",
    requestedUrl: "https://chickpea.co/",
    viewportWidth: 1440,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    documentWidth: 1440,
    documentHeight: 8966,
    imageHash: "hash-cap-ready",
    createdAt: T0,
    updatedAt: T0,
  });
  // A ready capture carrying a persisted manifest, for context decisions.
  await testDb.db.insert(schema.captures).values({
    id: "cap-manifest",
    pageId: "page-1",
    variant: "mobile",
    attempt: 1,
    status: "ready",
    idempotencyKey: "initial:cap-manifest",
    requestedUrl: "https://chickpea.co/",
    viewportWidth: 390,
    viewportHeight: 844,
    deviceScaleFactor: 1,
    documentWidth: 390,
    documentHeight: 13091,
    imageHash: "hash-cap-manifest",
    domManifestJson: JSON.stringify(ROUTE_MANIFEST),
    domManifestVersion: 1,
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

describe("POST /api/captures/[captureId]/annotations", () => {
  test("rejects foreign, missing-origin, anonymous, and bad-CSRF calls before any work", async () => {
    for (const options of [
      { origin: "https://evil.example" },
      { origin: null },
      { cookie: null },
      { csrf: "wrong-proof" },
    ]) {
      const response = await annotationsPOST(
        createRequest("cap-ready", { ...options, body: createBody() }),
        listContext("cap-ready"),
      );
      expect(response.status, JSON.stringify(options)).toBeGreaterThanOrEqual(400);
      expect(response.status, JSON.stringify(options)).toBeLessThan(500);
    }
    const listed = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    expect((await listed.json()).annotations).toHaveLength(0);
  });

  test("rejects wrong content type, oversize declared and real bodies, and invalid JSON", async () => {
    const wrongType = await annotationsPOST(
      createRequest("cap-ready", { contentType: "text/plain", rawBody: "{}" }),
      listContext("cap-ready"),
    );
    expect(wrongType.status).toBe(415);

    const oversizeDeclared = await annotationsPOST(
      createRequest("cap-ready", {
        contentLength: String(ANNOTATION_REQUEST_MAX_BYTES + 1),
        rawBody: "{}",
      }),
      listContext("cap-ready"),
    );
    expect(oversizeDeclared.status).toBe(413);

    const oversizeReal = await annotationsPOST(
      createRequest("cap-ready", {
        rawBody: `{ "pad": "${"x".repeat(ANNOTATION_REQUEST_MAX_BYTES)}" }`,
      }),
      listContext("cap-ready"),
    );
    expect(oversizeReal.status).toBe(413);

    const invalidJson = await annotationsPOST(
      createRequest("cap-ready", { rawBody: "{ not json" }),
      listContext("cap-ready"),
    );
    expect(invalidJson.status).toBe(400);
  });

  test("rejects unknown fields, malformed tips, blank bodies, and short keys", async () => {
    const bad = [
      createBody({ extra: true }),
      createBody({ tip: { x: "1", y: 2 } }),
      createBody({ tip: { x: 1 } }),
      createBody({ tip: { x: Number.NaN, y: 2 } }),
      createBody({ body: "" }),
      createBody({ body: 42 }),
      createBody({ idempotencyKey: "short" }),
      { tip: { x: 1, y: 2 } },
      // The explicit context decision is required: a missing key, a
      // non-string, and an empty string are all invalid.
      createBody({ elementId: undefined }),
      (() => {
        const { elementId: _omitted, ...rest } = createBody();
        return rest;
      })(),
      createBody({ elementId: 42 }),
      createBody({ elementId: "" }),
      // A client-authored snapshot is impossible: strict keys reject it.
      createBody({ elementSnapshot: { id: "cell-1" } }),
    ];
    for (const body of bad) {
      // JSON.stringify cannot carry NaN; serialize it the way a hostile
      // client would have to (it becomes null, which is equally invalid).
      const response = await annotationsPOST(
        createRequest("cap-ready", { body }),
        listContext("cap-ready"),
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const listed = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    expect((await listed.json()).annotations).toHaveLength(0);
  });

  test("a missing capture is a generic 404", async () => {
    const response = await annotationsPOST(
      createRequest("cap-missing", { body: createBody() }),
      listContext("cap-missing"),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error).not.toMatch(/cap-missing/);
  });

  test("creates pin 1 with 201, then replays the same key with 200 and no second row", async () => {
    const created = await annotationsPOST(
      createRequest("cap-ready", { body: createBody() }),
      listContext("cap-ready"),
    );
    expect(created.status).toBe(201);
    const createdPayload = await created.json();
    expect(createdPayload.annotation).toMatchObject({
      captureId: "cap-ready",
      kind: "pin",
      number: 1,
      tip: { x: 812.25, y: 4231.5 },
      body: "This heading reads like a placeholder.",
      revision: 1,
    });

    const replayed = await annotationsPOST(
      createRequest("cap-ready", { body: createBody() }),
      listContext("cap-ready"),
    );
    expect(replayed.status).toBe(200);
    expect((await replayed.json()).annotation.id).toBe(createdPayload.annotation.id);

    const listed = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    expect((await listed.json()).annotations).toHaveLength(1);
  });

  test("the same key with a different payload is a 409 conflict", async () => {
    await annotationsPOST(createRequest("cap-ready", { body: createBody() }), listContext("cap-ready"));
    const conflict = await annotationsPOST(
      createRequest("cap-ready", { body: createBody({ tip: { x: 1, y: 1 } }) }),
      listContext("cap-ready"),
    );
    expect(conflict.status).toBe(409);
    const listed = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    expect((await listed.json()).annotations).toHaveLength(1);
  });

  test("a second distinct key gets the next number", async () => {
    await annotationsPOST(createRequest("cap-ready", { body: createBody() }), listContext("cap-ready"));
    const second = await annotationsPOST(
      createRequest("cap-ready", { body: createBody({ idempotencyKey: "pin-route-key-00002" }) }),
      listContext("cap-ready"),
    );
    expect(second.status).toBe(201);
    expect((await second.json()).annotation.number).toBe(2);
  });

  test("a named manifest element saves with the server-derived snapshot (VAL-PIN-003)", async () => {
    const created = await annotationsPOST(
      createRequest("cap-manifest", {
        body: createBody({
          tip: { x: 100, y: 4210 },
          elementId: "cell-1",
          idempotencyKey: "pin-route-ctx-00001",
        }),
      }),
      listContext("cap-manifest"),
    );
    expect(created.status).toBe(201);
    const payload = await created.json();
    expect(payload.annotation.elementSnapshot).toEqual(ROUTE_MANIFEST.elements[0]);

    // The No-element decision on the same capture saves an explicit null.
    const none = await annotationsPOST(
      createRequest("cap-manifest", {
        body: createBody({
          tip: { x: 10, y: 10 },
          elementId: null,
          idempotencyKey: "pin-route-ctx-00002",
        }),
      }),
      listContext("cap-manifest"),
    );
    expect(none.status).toBe(201);
    expect((await none.json()).annotation.elementSnapshot).toBeNull();
  });

  test("an element id the capture's manifest does not contain is a 400 with no row", async () => {
    const response = await annotationsPOST(
      createRequest("cap-manifest", {
        body: createBody({
          tip: { x: 100, y: 4210 },
          elementId: "not-an-element",
          idempotencyKey: "pin-route-ctx-00003",
        }),
      }),
      listContext("cap-manifest"),
    );
    expect(response.status).toBe(400);
    const listed = await annotationsGET(listRequest("cap-manifest"), listContext("cap-manifest"));
    expect((await listed.json()).annotations).toHaveLength(0);
  });
});

describe("GET /api/captures/[captureId]/annotations", () => {
  test("anonymous reads are denied and missing captures are a generic 404", async () => {
    const anonymous = await annotationsGET(
      listRequest("cap-ready", { cookie: null }),
      listContext("cap-ready"),
    );
    expect(anonymous.status).toBe(401);
    const missing = await annotationsGET(listRequest("cap-missing"), listContext("cap-missing"));
    expect(missing.status).toBe(404);
  });

  test("returns the capture's live pins with numbers, tips, and bodies", async () => {
    await annotationsPOST(createRequest("cap-ready", { body: createBody() }), listContext("cap-ready"));
    const response = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.annotations).toHaveLength(1);
    expect(payload.annotations[0]).toMatchObject({
      number: 1,
      tip: { x: 812.25, y: 4231.5 },
      body: "This heading reads like a placeholder.",
      elementSnapshot: null,
      revision: 1,
    });
  });
});

describe("PATCH /api/captures/[captureId]/annotations/[annotationId]", () => {
  async function seedPin(): Promise<{ id: string; revision: number }> {
    const response = await annotationsPOST(
      createRequest("cap-ready", { body: createBody() }),
      listContext("cap-ready"),
    );
    const { annotation } = await response.json();
    return { id: annotation.id as string, revision: annotation.revision as number };
  }

  test("commits one revisioned move and leaves number and body untouched", async () => {
    const { id, revision } = await seedPin();
    const moved = await annotationPATCH(
      moveRequest("cap-ready", id, {
        body: { tip: { x: 1440, y: 8966 }, expectedRevision: revision },
      }),
      pinContext("cap-ready", id),
    );
    expect(moved.status).toBe(200);
    const payload = await moved.json();
    expect(payload.annotation).toMatchObject({
      id,
      number: 1,
      tip: { x: 1440, y: 8966 },
      revision: 2,
      body: "This heading reads like a placeholder.",
    });
  });

  test("edits the original body in one revisioned write (VAL-PIN-003)", async () => {
    const { id, revision } = await seedPin();
    const edited = await annotationPATCH(
      moveRequest("cap-ready", id, {
        body: { body: "A sharper note about the heading.", expectedRevision: revision },
      }),
      pinContext("cap-ready", id),
    );
    expect(edited.status).toBe(200);
    const payload = await edited.json();
    expect(payload.annotation).toMatchObject({
      id,
      body: "A sharper note about the heading.",
      tip: { x: 812.25, y: 4231.5 },
      revision: 2,
    });
  });

  test("a missing or stale revision precondition is a 409 or 400 with no write (VAL-PIN-009)", async () => {
    const { id, revision } = await seedPin();
    // Missing precondition fails the schema.
    const missing = await annotationPATCH(
      moveRequest("cap-ready", id, { body: { tip: { x: 1, y: 1 } } }),
      pinContext("cap-ready", id),
    );
    expect(missing.status).toBe(400);
    // A body with neither tip nor body is not a mutation.
    const empty = await annotationPATCH(
      moveRequest("cap-ready", id, { body: { expectedRevision: revision } }),
      pinContext("cap-ready", id),
    );
    expect(empty.status).toBe(400);

    // The winning write from the shared starting revision lands first…
    const winner = await annotationPATCH(
      moveRequest("cap-ready", id, {
        body: { tip: { x: 100, y: 100 }, expectedRevision: revision },
      }),
      pinContext("cap-ready", id),
    );
    expect(winner.status).toBe(200);
    // …and the loser's stale write conflicts without changing the row.
    const loser = await annotationPATCH(
      moveRequest("cap-ready", id, {
        body: { tip: { x: 200, y: 200 }, expectedRevision: revision },
      }),
      pinContext("cap-ready", id),
    );
    expect(loser.status).toBe(409);
    expect(JSON.stringify(await loser.json())).not.toMatch(/cell-1|hash-cap/i);

    const listed = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    const [pin] = (await listed.json()).annotations;
    expect(pin.tip).toEqual({ x: 100, y: 100 });
    expect(pin.revision).toBe(2);
  });

  test("rejects out-of-bounds tips and foreign-capture addressing without a write", async () => {
    const { id, revision } = await seedPin();
    const outOfBounds = await annotationPATCH(
      moveRequest("cap-ready", id, {
        body: { tip: { x: 1441, y: 0 }, expectedRevision: revision },
      }),
      pinContext("cap-ready", id),
    );
    expect(outOfBounds.status).toBe(400);
    const wrongCapture = await annotationPATCH(
      moveRequest("cap-missing", id, {
        body: { tip: { x: 1, y: 1 }, expectedRevision: revision },
      }),
      pinContext("cap-missing", id),
    );
    expect(wrongCapture.status).toBe(404);
    const listed = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    const [pin] = (await listed.json()).annotations;
    expect(pin.tip).toEqual({ x: 812.25, y: 4231.5 });
    expect(pin.revision).toBe(1);
  });

  test("anonymous and bad-CSRF moves are denied", async () => {
    const { id, revision } = await seedPin();
    for (const options of [{ cookie: null }, { csrf: "wrong" }, { origin: null }]) {
      const response = await annotationPATCH(
        moveRequest("cap-ready", id, {
          ...options,
          body: { tip: { x: 1, y: 1 }, expectedRevision: revision },
        }),
        pinContext("cap-ready", id),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("DELETE /api/captures/[captureId]/annotations/[annotationId]", () => {
  async function seedPin(): Promise<{ id: string; revision: number }> {
    const response = await annotationsPOST(
      createRequest("cap-ready", { body: createBody() }),
      listContext("cap-ready"),
    );
    const { annotation } = await response.json();
    return { id: annotation.id as string, revision: annotation.revision as number };
  }

  test("tombstones the pin: it leaves the list and its number stays retired", async () => {
    const { id, revision } = await seedPin();
    const deleted = await annotationDELETE(
      deleteRequest("cap-ready", id, { body: { expectedRevision: revision } }),
      pinContext("cap-ready", id),
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });

    const listed = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    expect((await listed.json()).annotations).toHaveLength(0);

    // The number is never reused, even after deletion.
    const next = await annotationsPOST(
      createRequest("cap-ready", { body: createBody({ idempotencyKey: "pin-route-key-00009" }) }),
      listContext("cap-ready"),
    );
    expect((await next.json()).annotation.number).toBe(2);
  });

  test("a stale or repeated delete conflicts or reads not-found; nothing else changes", async () => {
    const { id, revision } = await seedPin();
    const stale = await annotationDELETE(
      deleteRequest("cap-ready", id, { body: { expectedRevision: revision + 9 } }),
      pinContext("cap-ready", id),
    );
    expect(stale.status).toBe(409);

    const missingRevision = await annotationDELETE(
      deleteRequest("cap-ready", id, { body: {} }),
      pinContext("cap-ready", id),
    );
    expect(missingRevision.status).toBe(400);

    await annotationDELETE(
      deleteRequest("cap-ready", id, { body: { expectedRevision: revision } }),
      pinContext("cap-ready", id),
    );
    const again = await annotationDELETE(
      deleteRequest("cap-ready", id, { body: { expectedRevision: revision } }),
      pinContext("cap-ready", id),
    );
    expect(again.status).toBe(404);
  });

  test("anonymous, bad-CSRF, and foreign-capture deletes are denied", async () => {
    const { id, revision } = await seedPin();
    for (const options of [{ cookie: null }, { csrf: "wrong" }, { origin: null }]) {
      const response = await annotationDELETE(
        deleteRequest("cap-ready", id, { ...options, body: { expectedRevision: revision } }),
        pinContext("cap-ready", id),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    const wrongCapture = await annotationDELETE(
      deleteRequest("cap-missing", id, { body: { expectedRevision: revision } }),
      pinContext("cap-missing", id),
    );
    expect(wrongCapture.status).toBe(404);
    // Nothing was deleted through any of those.
    const listed = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    expect((await listed.json()).annotations).toHaveLength(1);
  });
});

describe("method policy", () => {
  test("unsupported methods are 405 on both routes", async () => {
    expect(annotationsPUT().status).toBe(405);
    expect(annotationGET().status).toBe(405);
  });
});

// Rectangles over the wire (D079): `rect` in place of `tip` creates a box,
// the same PATCH moves or resizes it with the revision precondition, and
// the list carries both kinds in one number order.
describe("rectangles over the routes (D079)", () => {
  const rect = { x: 100, y: 200, width: 300, height: 150 };
  const rectBody = (overrides: Record<string, unknown> = {}) => {
    const { tip: _tip, ...rest } = createBody({ idempotencyKey: "rect-route-key-00001" });
    return { ...rest, rect, ...overrides };
  };

  test("creates a box with 201, lists it beside a pin in number order, and resizes it in one write", async () => {
    await annotationsPOST(createRequest("cap-ready", { body: createBody() }), listContext("cap-ready"));
    const created = await annotationsPOST(
      createRequest("cap-ready", { body: rectBody() }),
      listContext("cap-ready"),
    );
    expect(created.status).toBe(201);
    const { annotation } = await created.json();
    expect(annotation).toMatchObject({ kind: "rectangle", number: 2, rect, revision: 1 });
    expect(annotation.tip).toBeUndefined();

    const listed = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    const payload = await listed.json();
    expect(payload.annotations.map((a: { kind: string; number: number }) => [a.kind, a.number])).toEqual([
      ["pin", 1],
      ["rectangle", 2],
    ]);

    const resized = await annotationPATCH(
      moveRequest("cap-ready", annotation.id, {
        body: { rect: { ...rect, width: 400, height: 8 }, expectedRevision: 1 },
      }),
      pinContext("cap-ready", annotation.id),
    );
    expect(resized.status).toBe(200);
    expect((await resized.json()).annotation).toMatchObject({
      kind: "rectangle",
      rect: { ...rect, width: 400, height: 8 },
      revision: 2,
      number: 2,
    });
    // Stale revision: 409 and nothing written.
    const stale = await annotationPATCH(
      moveRequest("cap-ready", annotation.id, { body: { rect, expectedRevision: 1 } }),
      pinContext("cap-ready", annotation.id),
    );
    expect(stale.status).toBe(409);
  });

  test("rejects too-small, out-of-frame, non-finite, and ambiguous boxes with a bounded 400", async () => {
    for (const body of [
      rectBody({ rect: { ...rect, width: 7.5 } }),
      rectBody({ rect: { ...rect, x: 1300 } }),
      rectBody({ rect: { ...rect, y: Number.NaN } }),
      rectBody({ rect: { x: 1, y: 2, width: 30 } }),
      rectBody({ rect, tip: { x: 1, y: 1 } }),
      rectBody({ rect: { ...rect, extra: 1 } }),
    ]) {
      const response = await annotationsPOST(
        createRequest("cap-ready", { body }),
        listContext("cap-ready"),
      );
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain("rect");
    }
    const listed = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    expect((await listed.json()).annotations).toHaveLength(0);
  });

  test("a rect on a pin, or a tip on a box, is a 400 with no write", async () => {
    const pinResponse = await annotationsPOST(
      createRequest("cap-ready", { body: createBody() }),
      listContext("cap-ready"),
    );
    const pin = (await pinResponse.json()).annotation;
    const wrongKind = await annotationPATCH(
      moveRequest("cap-ready", pin.id, { body: { rect, expectedRevision: 1 } }),
      pinContext("cap-ready", pin.id),
    );
    expect(wrongKind.status).toBe(400);
    const boxResponse = await annotationsPOST(
      createRequest("cap-ready", { body: rectBody() }),
      listContext("cap-ready"),
    );
    const box = (await boxResponse.json()).annotation;
    const tipOnBox = await annotationPATCH(
      moveRequest("cap-ready", box.id, { body: { tip: { x: 1, y: 1 }, expectedRevision: 1 } }),
      pinContext("cap-ready", box.id),
    );
    expect(tipOnBox.status).toBe(400);
    const both = await annotationPATCH(
      moveRequest("cap-ready", box.id, { body: { tip: { x: 1, y: 1 }, rect, expectedRevision: 1 } }),
      pinContext("cap-ready", box.id),
    );
    expect(both.status).toBe(400);
    const listed = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    for (const item of (await listed.json()).annotations) expect(item.revision).toBe(1);
  });

  test("a box tombstones like a pin and its number stays retired", async () => {
    const created = await annotationsPOST(
      createRequest("cap-ready", { body: rectBody() }),
      listContext("cap-ready"),
    );
    const box = (await created.json()).annotation;
    const removed = await annotationDELETE(
      deleteRequest("cap-ready", box.id, { body: { expectedRevision: 1 } }),
      pinContext("cap-ready", box.id),
    );
    expect(removed.status).toBe(200);
    const next = await annotationsPOST(
      createRequest("cap-ready", { body: createBody({ idempotencyKey: "pin-after-box" }) }),
      listContext("cap-ready"),
    );
    expect((await next.json()).annotation.number).toBe(2);
  });
});
