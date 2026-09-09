// Boundary matrix for the hierarchy and scoped-retry routes:
// GET /api/projects/[publicId] and POST /api/pages/[pageId]/captures
// (VAL-PROJECT-003, VAL-PROJECT-004, VAL-PROJECT-005, VAL-AUTH-007).

import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DELETE as captureDELETE,
  GET as captureGET,
  POST as capturePOST,
  PUT as capturePUT,
} from "../../app/api/pages/[pageId]/captures/route";
import {
  DELETE as projectDELETE,
  GET as projectGET,
  POST as projectPOST,
} from "../../app/api/projects/[publicId]/route";
import { POST as projectsPOST } from "../../app/api/projects/route";
import { CAPTURE_REQUEST_MAX_BYTES } from "../../src/lib/boundaries";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { createEditorSession } from "../../src/lib/server/auth/session";
import { applyCaptureTransition } from "../../src/lib/server/captures/transitions";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "capture-route-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let session: { token: string; csrf: string };
let publicId: string;
let pageIds: string[];

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

const retryRequest = (pageId: string, options: RequestOptions = {}) =>
  build(`${ORIGIN}/api/pages/${pageId}/captures`, "POST", options);

const retryContext = (pageId: string) => ({ params: Promise.resolve({ pageId }) });
const projectContext = (id: string) => ({ params: Promise.resolve({ publicId: id }) });

const retryBody = (overrides: Record<string, unknown> = {}) => ({
  variant: "desktop",
  idempotencyKey: "capture-retry-0001",
  ...overrides,
});

async function attemptsFor(pageId: string, variant: string) {
  return testDb.db
    .select()
    .from(schema.captures)
    .where(and(eq(schema.captures.pageId, pageId), eq(schema.captures.variant, variant)))
    .orderBy(asc(schema.captures.attempt));
}

async function failLatest(pageId: string, variant: string) {
  const rows = await attemptsFor(pageId, variant);
  const latest = rows[rows.length - 1]!;
  await applyCaptureTransition(testDb.db, {
    captureId: latest.id,
    from: latest.status as "pending",
    to: "failed",
    errorCode: "total-timeout",
    now: T0 + 5,
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  const created = createEditorSession(TEST_SECRET, T0);
  session = { token: created.token, csrf: created.payload.csrf };

  const response = await projectsPOST(
    build(`${ORIGIN}/api/projects`, "POST", {
      body: {
        rootUrl: "https://chickpea.co",
        urls: ["https://chickpea.co/pricing"],
        idempotencyKey: "seed-project-0001",
      },
    }),
  );
  const { project } = await response.json();
  publicId = project.publicId;
  pageIds = project.pages.map((page: { id: string }) => page.id);
});

afterEach(() => {
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GET /api/projects/[publicId]", () => {
  test("returns the ordered page/device hierarchy for the editor", async () => {
    const response = await projectGET(
      build(`${ORIGIN}/api/projects/${publicId}`, "GET"),
      projectContext(publicId),
    );
    expect(response.status).toBe(200);
    const { project } = await response.json();
    expect(project.pages.map((p: { normalizedUrl: string }) => p.normalizedUrl)).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
    ]);
    expect(
      project.pages[0].devices.map((d: { variant: string }) => d.variant),
    ).toEqual(["desktop", "mobile"]);
    expect(project.counts).toEqual({
      pages: 2,
      attempts: 4,
      ready: 0,
      failed: 0,
      inProgress: 4,
    });
  });

  test("anonymous callers get the generic denial and no project data", async () => {
    const response = await projectGET(
      build(`${ORIGIN}/api/projects/${publicId}`, "GET", { cookie: null }),
      projectContext(publicId),
    );
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("chickpea");
  });

  test("an unknown public id uses the same bounded denial as a real one", async () => {
    const response = await projectGET(
      build(`${ORIGIN}/api/projects/no-such-id`, "GET"),
      projectContext("no-such-id"),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Request rejected." });
  });

  test("unsupported methods answer 405", async () => {
    for (const handler of [projectPOST, projectDELETE]) {
      expect(handler().status).toBe(405);
    }
  });
});

describe("POST /api/pages/[pageId]/captures rejections leave no durable state", () => {
  test.each([
    ["a foreign Origin", { origin: "https://evil.example" }, 403],
    ["a missing Origin", { origin: null }, 403],
    ["no session", { cookie: null }, 401],
    ["no CSRF proof", { csrf: null }, 403],
    ["a wrong CSRF proof", { csrf: "not-the-proof" }, 403],
    ["a wrong content type", { contentType: "text/plain" }, 415],
  ])("%s is rejected with %i and creates no attempt", async (_label, options, status) => {
    await failLatest(pageIds[0]!, "desktop");
    const response = await capturePOST(
      retryRequest(pageIds[0]!, { body: retryBody(), ...options }),
      retryContext(pageIds[0]!),
    );
    expect(response.status).toBe(status);
    expect(await attemptsFor(pageIds[0]!, "desktop")).toHaveLength(1);
  });

  test("a body over the published cap is rejected before parsing", async () => {
    const response = await capturePOST(
      retryRequest(pageIds[0]!, {
        rawBody: "{}",
        contentLength: String(CAPTURE_REQUEST_MAX_BYTES + 1),
      }),
      retryContext(pageIds[0]!),
    );
    expect(response.status).toBe(413);
    expect(await attemptsFor(pageIds[0]!, "desktop")).toHaveLength(1);
  });

  test.each([
    ["invalid JSON", { rawBody: "{" }],
    ["an unknown field", { body: retryBody({ force: true }) }],
    ["an unknown variant", { body: retryBody({ variant: "tablet" }) }],
    ["a missing idempotency key", { body: { variant: "desktop" } }],
    ["a short idempotency key", { body: retryBody({ idempotencyKey: "short" }) }],
  ])("%s is a bounded 400", async (_label, options) => {
    const response = await capturePOST(
      retryRequest(pageIds[0]!, options),
      retryContext(pageIds[0]!),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request." });
    expect(await attemptsFor(pageIds[0]!, "desktop")).toHaveLength(1);
  });

  test("unsupported methods answer 405", async () => {
    for (const handler of [captureGET, capturePUT, captureDELETE]) {
      expect(handler().status).toBe(405);
    }
  });
});

describe("POST /api/pages/[pageId]/captures scoped retry", () => {
  test("a terminal attempt gets exactly one newer attempt", async () => {
    await failLatest(pageIds[0]!, "desktop");
    const response = await capturePOST(
      retryRequest(pageIds[0]!, { body: retryBody() }),
      retryContext(pageIds[0]!),
    );
    expect(response.status).toBe(201);
    const { attempt } = await response.json();
    expect(attempt).toMatchObject({ variant: "desktop", attempt: 2, status: "pending" });
    expect(await attemptsFor(pageIds[0]!, "desktop")).toHaveLength(2);
    // The sibling variant and the sibling page were not resubmitted.
    expect(await attemptsFor(pageIds[0]!, "mobile")).toHaveLength(1);
    expect(await attemptsFor(pageIds[1]!, "desktop")).toHaveLength(1);
  });

  test("the same key replays the same attempt with 200", async () => {
    await failLatest(pageIds[0]!, "desktop");
    const first = await capturePOST(
      retryRequest(pageIds[0]!, { body: retryBody() }),
      retryContext(pageIds[0]!),
    );
    const second = await capturePOST(
      retryRequest(pageIds[0]!, { body: retryBody() }),
      retryContext(pageIds[0]!),
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(await attemptsFor(pageIds[0]!, "desktop")).toHaveLength(2);
  });

  test("the same key against another target is a bounded 409", async () => {
    await failLatest(pageIds[0]!, "desktop");
    await failLatest(pageIds[0]!, "mobile");
    await capturePOST(
      retryRequest(pageIds[0]!, { body: retryBody() }),
      retryContext(pageIds[0]!),
    );
    const conflict = await capturePOST(
      retryRequest(pageIds[0]!, { body: retryBody({ variant: "mobile" }) }),
      retryContext(pageIds[0]!),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "Request rejected." });
    expect(await attemptsFor(pageIds[0]!, "mobile")).toHaveLength(1);
  });

  test("a non-terminal attempt cannot be retried", async () => {
    const response = await capturePOST(
      retryRequest(pageIds[0]!, { body: retryBody() }),
      retryContext(pageIds[0]!),
    );
    expect(response.status).toBe(409);
    expect(await attemptsFor(pageIds[0]!, "desktop")).toHaveLength(1);
  });

  test("an unknown page answers the same generic 404", async () => {
    const response = await capturePOST(
      retryRequest("no-such-page", { body: retryBody() }),
      retryContext("no-such-page"),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Request rejected." });
  });

  test("retrying issues no provider call", async () => {
    await failLatest(pageIds[0]!, "desktop");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await capturePOST(
      retryRequest(pageIds[0]!, { body: retryBody() }),
      retryContext(pageIds[0]!),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("an unavailable database fails closed", async () => {
    __setDatabaseForTests(null);
    const response = await capturePOST(
      retryRequest(pageIds[0]!, { body: retryBody() }),
      retryContext(pageIds[0]!),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Service unavailable." });
    __setDatabaseForTests(testDb.db);
  });
});
