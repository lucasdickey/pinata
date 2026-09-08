// Boundary matrix for /api/projects: method, Origin, session, CSRF, content
// type, byte cap, strict schema, per-row corrections, atomic creation,
// idempotent replay, conflict, and fail-closed storage
// (VAL-PROJECT-001, VAL-PROJECT-002, VAL-PROJECT-006).

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DELETE as projectsDELETE,
  GET as projectsGET,
  PATCH as projectsPATCH,
  POST as projectsPOST,
  PUT as projectsPUT,
} from "../../app/api/projects/route";
import { PROJECT_REQUEST_MAX_BYTES } from "../../src/lib/boundaries";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { createEditorSession } from "../../src/lib/server/auth/session";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "projects-route-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const URL_ = `${ORIGIN}/api/projects`;
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

function projectRequest(method: string, options: RequestOptions = {}): Request {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.set("origin", origin);
  headers.set("host", "127.0.0.1:3100");
  const contentType =
    options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType) headers.set("content-type", contentType);
  const cookie =
    options.cookie === undefined ? `${EDITOR_SESSION_COOKIE}=${session.token}` : options.cookie;
  if (cookie) headers.set("cookie", cookie);
  const csrf = options.csrf === undefined ? session.csrf : options.csrf;
  if (csrf) headers.set(EDITOR_CSRF_HEADER, csrf);
  if (options.contentLength) headers.set("content-length", options.contentLength);
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Request(URL_, { method, headers, body });
}

const validBody = (overrides: Record<string, unknown> = {}) => ({
  rootUrl: "https://chickpea.co",
  urls: ["https://chickpea.co/pricing", "https://chickpea.co/about"],
  idempotencyKey: "route-key-000001",
  ...overrides,
});

const countRows = async () => ({
  projects: (await testDb.db.select().from(schema.projects)).length,
  pages: (await testDb.db.select().from(schema.pages)).length,
  captures: (await testDb.db.select().from(schema.captures)).length,
  keys: (await testDb.db.select().from(schema.idempotencyKeys)).length,
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  const created = createEditorSession(TEST_SECRET, T0);
  session = { token: created.token, csrf: created.payload.csrf };
});

afterEach(() => {
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("POST /api/projects rejections leave no durable state", () => {
  test.each([
    ["a foreign Origin", { origin: "https://evil.example" }, 403],
    ["a missing Origin", { origin: null }, 403],
    ["no session", { cookie: null }, 401],
    ["a forged session", { cookie: `${EDITOR_SESSION_COOKIE}=v1.forged.token` }, 401],
    ["no CSRF proof", { csrf: null }, 403],
    ["a wrong CSRF proof", { csrf: "not-the-proof" }, 403],
    ["a wrong content type", { contentType: "text/plain" }, 415],
  ])("%s is rejected with %i and writes nothing", async (_label, options, status) => {
    const response = await projectsPOST(
      projectRequest("POST", { body: validBody(), ...options }),
    );
    expect(response.status).toBe(status);
    expect(await countRows()).toEqual({ projects: 0, pages: 0, captures: 0, keys: 0 });
  });

  test("a body over the published cap is rejected before parsing", async () => {
    const response = await projectsPOST(
      projectRequest("POST", {
        rawBody: "{}",
        contentLength: String(PROJECT_REQUEST_MAX_BYTES + 1),
      }),
    );
    expect(response.status).toBe(413);
    expect(await countRows()).toEqual({ projects: 0, pages: 0, captures: 0, keys: 0 });
  });

  test.each([
    ["invalid JSON", { rawBody: "{" }],
    ["an unknown field", { body: validBody({ crawl: true }) }],
    ["a missing idempotency key", { body: { rootUrl: "https://chickpea.co/" } }],
    ["a short idempotency key", { body: validBody({ idempotencyKey: "short" }) }],
    ["a non-string root", { body: validBody({ rootUrl: 42 }) }],
    ["a non-array url list", { body: validBody({ urls: "https://chickpea.co/pricing" }) }],
  ])("%s is a bounded 400", async (_label, options) => {
    const response = await projectsPOST(projectRequest("POST", options));
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toEqual({ error: "Invalid request." });
    expect(await countRows()).toEqual({ projects: 0, pages: 0, captures: 0, keys: 0 });
  });

  test("unsupported methods answer 405 without touching storage", async () => {
    for (const handler of [projectsPUT, projectsPATCH, projectsDELETE]) {
      const response = handler();
      expect(response.status).toBe(405);
    }
    expect(await countRows()).toEqual({ projects: 0, pages: 0, captures: 0, keys: 0 });
  });
});

describe("POST /api/projects input corrections", () => {
  test("every invalid row is reported at once and nothing is created", async () => {
    const response = await projectsPOST(
      projectRequest("POST", {
        body: validBody({
          urls: [
            "http://chickpea.co/insecure",
            "https://chickpea.co/pricing",
            "https://user:pass@chickpea.co/",
            "https://169.254.169.254/latest/meta-data/",
          ],
        }),
      }),
    );
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.errors).toEqual([
      { field: "urls", index: 0, code: "scheme" },
      { field: "urls", index: 2, code: "credentials" },
      { field: "urls", index: 3, code: "ip-literal" },
    ]);
    // Bounded codes only: no submitted value is echoed back.
    const text = JSON.stringify(payload);
    expect(text).not.toContain("user:pass");
    expect(text).not.toContain("169.254");
    expect(await countRows()).toEqual({ projects: 0, pages: 0, captures: 0, keys: 0 });
  });

  test("a rejected submission can be corrected and then succeeds", async () => {
    const rejected = await projectsPOST(
      projectRequest("POST", { body: validBody({ rootUrl: "chickpea.co" }) }),
    );
    expect(rejected.status).toBe(422);
    expect((await rejected.json()).errors).toEqual([
      { field: "rootUrl", index: null, code: "relative" },
    ]);

    const accepted = await projectsPOST(projectRequest("POST", { body: validBody() }));
    expect(accepted.status).toBe(201);
    expect((await countRows()).projects).toBe(1);
  });
});

describe("POST /api/projects atomic creation", () => {
  test("one request creates the project, ordered pages, and two attempts per page", async () => {
    const response = await projectsPOST(projectRequest("POST", { body: validBody() }));
    expect(response.status).toBe(201);
    const { project } = await response.json();
    expect(project.pages.map((page: { normalizedUrl: string }) => page.normalizedUrl)).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);
    for (const page of project.pages) {
      expect(page.captures.map((c: { variant: string }) => c.variant)).toEqual([
        "desktop",
        "mobile",
      ]);
      expect(page.captures.every((c: { status: string }) => c.status === "pending")).toBe(true);
    }
    expect(await countRows()).toEqual({ projects: 1, pages: 3, captures: 6, keys: 1 });
  });

  test("the same key replays the same identities with 200 and no new rows", async () => {
    const first = await projectsPOST(projectRequest("POST", { body: validBody() }));
    const second = await projectsPOST(projectRequest("POST", { body: validBody() }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(await countRows()).toEqual({ projects: 1, pages: 3, captures: 6, keys: 1 });
  });

  test("the same key with a different payload is a bounded 409", async () => {
    await projectsPOST(projectRequest("POST", { body: validBody() }));
    const conflict = await projectsPOST(
      projectRequest("POST", { body: validBody({ urls: ["https://chickpea.co/privacy"] }) }),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "Request rejected." });
    expect(await countRows()).toEqual({ projects: 1, pages: 3, captures: 6, keys: 1 });
  });

  test("a new key creates a second review of the same root", async () => {
    await projectsPOST(projectRequest("POST", { body: validBody() }));
    const second = await projectsPOST(
      projectRequest("POST", { body: validBody({ idempotencyKey: "route-key-000002" }) }),
    );
    expect(second.status).toBe(201);
    expect(await countRows()).toEqual({ projects: 2, pages: 6, captures: 12, keys: 2 });
  });

  test("no outbound request is made during creation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await projectsPOST(projectRequest("POST", { body: validBody() }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("an unavailable database fails closed without a partial project", async () => {
    __setDatabaseForTests(null);
    const response = await projectsPOST(projectRequest("POST", { body: validBody() }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Service unavailable." });
    __setDatabaseForTests(testDb.db);
    expect(await countRows()).toEqual({ projects: 0, pages: 0, captures: 0, keys: 0 });
  });
});

describe("GET /api/projects", () => {
  test("anonymous callers get the generic denial and no data", async () => {
    await projectsPOST(projectRequest("POST", { body: validBody() }));
    const response = await projectsGET(projectRequest("GET", { cookie: null, body: undefined }));
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).not.toContain("chickpea");
  });

  test("the editor reads the committed hierarchy in submitted order", async () => {
    await projectsPOST(projectRequest("POST", { body: validBody() }));
    const response = await projectsGET(projectRequest("GET"));
    expect(response.status).toBe(200);
    const { projects } = await response.json();
    expect(projects).toHaveLength(1);
    expect(projects[0].pages.map((p: { sortIndex: number }) => p.sortIndex)).toEqual([0, 1, 2]);
    expect(projects[0].pages[1].normalizedUrl).toBe("https://chickpea.co/pricing");
    expect(projects[0].pages[0].captures).toHaveLength(2);
  });
});
