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

const listContext = (captureId: string) => ({ params: Promise.resolve({ captureId }) });
const pinContext = (captureId: string, annotationId: string) => ({
  params: Promise.resolve({ captureId, annotationId }),
});

const createBody = (overrides: Record<string, unknown> = {}) => ({
  tip: { x: 812.25, y: 4231.5 },
  body: "This heading reads like a placeholder.",
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
  async function seedPin(): Promise<string> {
    const response = await annotationsPOST(
      createRequest("cap-ready", { body: createBody() }),
      listContext("cap-ready"),
    );
    return (await response.json()).annotation.id as string;
  }

  test("commits one revisioned move and leaves number and body untouched", async () => {
    const id = await seedPin();
    const moved = await annotationPATCH(
      moveRequest("cap-ready", id, { body: { tip: { x: 1440, y: 8966 } } }),
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

  test("rejects out-of-bounds tips and foreign-capture addressing without a write", async () => {
    const id = await seedPin();
    const outOfBounds = await annotationPATCH(
      moveRequest("cap-ready", id, { body: { tip: { x: 1441, y: 0 } } }),
      pinContext("cap-ready", id),
    );
    expect(outOfBounds.status).toBe(400);
    const wrongCapture = await annotationPATCH(
      moveRequest("cap-missing", id, { body: { tip: { x: 1, y: 1 } } }),
      pinContext("cap-missing", id),
    );
    expect(wrongCapture.status).toBe(404);
    const listed = await annotationsGET(listRequest("cap-ready"), listContext("cap-ready"));
    const [pin] = (await listed.json()).annotations;
    expect(pin.tip).toEqual({ x: 812.25, y: 4231.5 });
    expect(pin.revision).toBe(1);
  });

  test("anonymous and bad-CSRF moves are denied", async () => {
    const id = await seedPin();
    for (const options of [{ cookie: null }, { csrf: "wrong" }, { origin: null }]) {
      const response = await annotationPATCH(
        moveRequest("cap-ready", id, { ...options, body: { tip: { x: 1, y: 1 } } }),
        pinContext("cap-ready", id),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("method policy", () => {
  test("unsupported methods are 405 on both routes", async () => {
    expect(annotationsPUT().status).toBe(405);
    expect(annotationGET().status).toBe(405);
    expect(annotationDELETE().status).toBe(405);
  });
});
