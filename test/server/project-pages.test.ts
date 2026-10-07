// Adding pages to an existing project (D129): the row validation, the store
// function, and the editor-only POST /api/projects/[publicId]/pages
// boundary. Runs against the committed migrations in an in-memory libSQL
// database; projects are made through the real creation route so the added
// pages sit beside pages exactly as creation writes them.

import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DELETE as pagesDELETE,
  GET as pagesGET,
  POST as pagesPOST,
} from "../../app/api/projects/[publicId]/pages/route";
import { POST as projectsPOST } from "../../app/api/projects/route";
import {
  MAX_CAPTURE_ATTEMPTS_PER_PROJECT,
  MAX_UNIQUE_PAGE_URLS,
  PROJECT_REQUEST_MAX_BYTES,
} from "../../src/lib/boundaries";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { createEditorSession } from "../../src/lib/server/auth/session";
import { __setContinuationSchedulerForTests } from "../../src/lib/server/captures/continuation";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import { addPagesToProject, PAGE_ADD_SCOPE } from "../../src/lib/server/projects/add-pages";
import { archiveProject } from "../../src/lib/server/projects/archive";
import { validatePageAdditions } from "../../src/lib/server/projects/submission";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "project-pages-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let session: { token: string; csrf: string };
let scheduled: number;

interface RequestOptions {
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
  cookie?: string | null;
  csrf?: string | null;
  contentType?: string | null;
}

function request(path: string, options: RequestOptions = {}): Request {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.set("origin", origin);
  headers.set("host", "127.0.0.1:3100");
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType) headers.set("content-type", contentType);
  const cookie =
    options.cookie === undefined ? `${EDITOR_SESSION_COOKIE}=${session.token}` : options.cookie;
  if (cookie) headers.set("cookie", cookie);
  const csrf = options.csrf === undefined ? session.csrf : options.csrf;
  if (csrf) headers.set(EDITOR_CSRF_HEADER, csrf);
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body });
}

const context = (publicId: string) => ({ params: Promise.resolve({ publicId }) });

function addRequest(publicId: string, body: unknown, options: RequestOptions = {}) {
  return pagesPOST(request(`/api/projects/${publicId}/pages`, { body, ...options }), context(publicId));
}

async function createProject(key: string, urls: string[] = []) {
  const response = await projectsPOST(
    request("/api/projects", {
      body: { rootUrl: "https://chickpea.co", urls, idempotencyKey: key },
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).project as { projectId: string; publicId: string };
}

async function pagesOf(projectId: string) {
  return testDb.db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.projectId, projectId))
    .orderBy(asc(schema.pages.sortIndex));
}

async function capturesOf(pageId: string) {
  return testDb.db.select().from(schema.captures).where(eq(schema.captures.pageId, pageId));
}

const countRows = async () => ({
  pages: (await testDb.db.select().from(schema.pages)).length,
  captures: (await testDb.db.select().from(schema.captures)).length,
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  const created = createEditorSession(TEST_SECRET, T0);
  session = { token: created.token, csrf: created.payload.csrf };
  scheduled = 0;
  __setContinuationSchedulerForTests(() => {
    scheduled += 1;
  });
});

afterEach(() => {
  __setContinuationSchedulerForTests(null);
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("validatePageAdditions", () => {
  test("normalizes rows, keeps their indexes, ignores blanks, and drops repeats", () => {
    const result = validatePageAdditions([
      "https://chickpea.co/pricing#plans",
      "",
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          index: 0,
          requestedUrl: "https://chickpea.co/pricing#plans",
          normalizedUrl: "https://chickpea.co/pricing",
        },
        { index: 3, requestedUrl: "https://chickpea.co/about", normalizedUrl: "https://chickpea.co/about" },
      ],
    });
  });

  test("reports every bad row by index, and an all-blank submission on its first row", () => {
    expect(validatePageAdditions(["http://chickpea.co/", "https://ok.co/", "nope"])).toEqual({
      ok: false,
      errors: [
        { field: "urls", index: 0, code: "scheme" },
        { field: "urls", index: 2, code: "relative" },
      ],
    });
    expect(validatePageAdditions(["  ", ""])).toEqual({
      ok: false,
      errors: [{ field: "urls", index: 0, code: "blank" }],
    });
  });
});

describe("addPagesToProject", () => {
  test("writes the new pages after the existing ones, each with a pending Desktop and Mobile attempt", async () => {
    const project = await createProject("pages-create-0001", ["https://chickpea.co/menu"]);
    vi.setSystemTime(T0 + 50);
    const rows = validatePageAdditions(["https://chickpea.co/pricing", "https://chickpea.co/about"]);
    if (!rows.ok) throw new Error("rows should validate");
    const result = await addPagesToProject(testDb.db, project.publicId, rows.rows, "pages-add-0001", {
      now: () => T0 + 50,
      newId: (() => {
        let n = 0;
        return () => `new-${(n += 1)}`;
      })(),
    });
    expect(result).toMatchObject({ ok: true, created: true, projectId: project.projectId });
    if (!result.ok) return;
    expect(result.result.skipped).toEqual([]);
    expect(result.result.added.map((page) => [page.normalizedUrl, page.sortIndex])).toEqual([
      ["https://chickpea.co/pricing", 2],
      ["https://chickpea.co/about", 3],
    ]);

    const pages = await pagesOf(project.projectId);
    expect(pages.map((page) => page.normalizedUrl)).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/menu",
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);
    for (const page of pages.slice(2)) {
      const captures = await capturesOf(page.id);
      expect(captures.map((c) => [c.variant, c.attempt, c.status, c.origin]).sort()).toEqual([
        ["desktop", 1, "pending", "manual"],
        ["mobile", 1, "pending", "manual"],
      ]);
      expect(page.createdAt).toBe(T0 + 50);
    }
    const [row] = await testDb.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.projectId));
    expect(row!.updatedAt).toBe(T0 + 50);
  });

  test("an address the project already has is skipped by row, never added twice", async () => {
    const project = await createProject("pages-create-0002", ["https://chickpea.co/menu"]);
    const rows = validatePageAdditions(["https://chickpea.co/menu#top", "https://chickpea.co/new"]);
    if (!rows.ok) throw new Error("rows should validate");
    const result = await addPagesToProject(testDb.db, project.publicId, rows.rows, "pages-add-0002");
    expect(result.ok && result.result.skipped).toEqual([0]);
    expect(result.ok && result.result.added.map((p) => p.normalizedUrl)).toEqual([
      "https://chickpea.co/new",
    ]);
    expect((await pagesOf(project.projectId)).length).toBe(3);
  });

  test("rows that are all already pages write nothing", async () => {
    const project = await createProject("pages-create-0003");
    const before = await countRows();
    const rows = validatePageAdditions(["https://chickpea.co/"]);
    if (!rows.ok) throw new Error("rows should validate");
    const result = await addPagesToProject(testDb.db, project.publicId, rows.rows, "pages-add-0003");
    expect(result).toMatchObject({ ok: true, created: false, result: { added: [], skipped: [0] } });
    expect(await countRows()).toEqual(before);
    const keys = await testDb.db
      .select()
      .from(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.scope, PAGE_ADD_SCOPE));
    expect(keys).toEqual([]);
  });

  test("a project's page limit holds across additions", async () => {
    const urls = Array.from({ length: MAX_UNIQUE_PAGE_URLS - 2 }, (_, i) => `https://chickpea.co/p${i}`);
    const project = await createProject("pages-create-0004", urls);
    const before = await countRows();
    const rows = validatePageAdditions(["https://chickpea.co/a", "https://chickpea.co/b"]);
    if (!rows.ok) throw new Error("rows should validate");
    expect(
      await addPagesToProject(testDb.db, project.publicId, rows.rows, "pages-add-0004"),
    ).toEqual({
      ok: false,
      error: "limits",
      errors: [{ field: "form", index: null, code: "too-many-pages" }],
    });
    expect(await countRows()).toEqual(before);
    // One more still fits.
    const one = validatePageAdditions(["https://chickpea.co/a"]);
    if (!one.ok) throw new Error("rows should validate");
    expect((await addPagesToProject(testDb.db, project.publicId, one.rows, "pages-add-0005")).ok).toBe(
      true,
    );
  });

  test("a project's screenshot limit holds across additions", async () => {
    const project = await createProject("pages-create-0006");
    const [root] = await pagesOf(project.projectId);
    // Fill the project's attempt history to two short of the limit.
    const existing = 2;
    const filler = MAX_CAPTURE_ATTEMPTS_PER_PROJECT - existing - 1;
    await testDb.db.insert(schema.captures).values(
      Array.from({ length: filler }, (_, i) => ({
        id: `filler-${i}`,
        pageId: root!.id,
        variant: "desktop",
        attempt: i + 2,
        status: "failed",
        idempotencyKey: `filler:${i}`,
        requestedUrl: root!.normalizedUrl,
        viewportWidth: 1440,
        viewportHeight: 900,
        deviceScaleFactor: 1,
        createdAt: T0,
        updatedAt: T0,
      })),
    );
    const rows = validatePageAdditions(["https://chickpea.co/a"]);
    if (!rows.ok) throw new Error("rows should validate");
    expect(await addPagesToProject(testDb.db, project.publicId, rows.rows, "pages-add-0006")).toEqual({
      ok: false,
      error: "limits",
      errors: [{ field: "form", index: null, code: "too-many-captures" }],
    });
  });

  test("a replayed key returns the first result; another intent under it conflicts", async () => {
    const project = await createProject("pages-create-0007");
    const other = await createProject("pages-create-0008");
    const rows = validatePageAdditions(["https://chickpea.co/a"]);
    const changed = validatePageAdditions(["https://chickpea.co/b"]);
    if (!rows.ok || !changed.ok) throw new Error("rows should validate");
    const first = await addPagesToProject(testDb.db, project.publicId, rows.rows, "pages-add-0007");
    const before = await countRows();
    const again = await addPagesToProject(testDb.db, project.publicId, rows.rows, "pages-add-0007");
    expect(again).toEqual({ ...first, created: false });
    expect(await countRows()).toEqual(before);
    expect(
      await addPagesToProject(testDb.db, project.publicId, changed.rows, "pages-add-0007"),
    ).toEqual({ ok: false, error: "conflict" });
    expect(
      await addPagesToProject(testDb.db, other.publicId, rows.rows, "pages-add-0007"),
    ).toEqual({ ok: false, error: "conflict" });
    expect(await countRows()).toEqual(before);
  });

  test("a missing, deleted, or archived project takes no pages", async () => {
    const archived = await createProject("pages-create-0009");
    await archiveProject(testDb.db, archived.publicId, T0 + 1);
    const deleted = await createProject("pages-create-0010");
    await testDb.db
      .update(schema.projects)
      .set({ deletedAt: T0 + 1 })
      .where(eq(schema.projects.id, deleted.projectId));
    const rows = validatePageAdditions(["https://chickpea.co/a"]);
    if (!rows.ok) throw new Error("rows should validate");
    for (const publicId of ["pub-nope", archived.publicId, deleted.publicId]) {
      expect(
        await addPagesToProject(testDb.db, publicId, rows.rows, `pages-add-${publicId}`),
      ).toEqual({ ok: false, error: "not-found" });
    }
  });
});

describe("POST /api/projects/[publicId]/pages", () => {
  test("adds the pages, answers 201, and hands the project to the capture drive", async () => {
    const project = await createProject("pages-route-0001");
    scheduled = 0;
    const response = await addRequest(project.publicId, {
      urls: ["https://chickpea.co/pricing", "https://chickpea.co/"],
      idempotencyKey: "pages-route-add-0001",
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.publicId).toBe(project.publicId);
    expect(body.skipped).toEqual([1]);
    expect(body.added).toHaveLength(1);
    expect(body.added[0]).toMatchObject({
      normalizedUrl: "https://chickpea.co/pricing",
      sortIndex: 1,
      captures: [
        { variant: "desktop", attempt: 1, status: "pending" },
        { variant: "mobile", attempt: 1, status: "pending" },
      ],
    });
    expect(scheduled).toBe(1);

    // The same request again replays: 200, the same pages, nothing new.
    const before = await countRows();
    const replay = await addRequest(project.publicId, {
      urls: ["https://chickpea.co/pricing", "https://chickpea.co/"],
      idempotencyKey: "pages-route-add-0001",
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()).added).toEqual(body.added);
    expect(await countRows()).toEqual(before);
  });

  test("nothing new to add answers 200 with every row skipped and drives nothing", async () => {
    const project = await createProject("pages-route-0002");
    scheduled = 0;
    const response = await addRequest(project.publicId, {
      urls: ["https://chickpea.co"],
      idempotencyKey: "pages-route-add-0002",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ publicId: project.publicId, added: [], skipped: [0] });
    expect(scheduled).toBe(0);
  });

  test("bad rows come back by index with bounded codes, never echoed, and nothing is written", async () => {
    const project = await createProject("pages-route-0003");
    const before = await countRows();
    const response = await addRequest(project.publicId, {
      urls: ["https://chickpea.co/ok", "https://user:secret@chickpea.co/"],
      idempotencyKey: "pages-route-add-0003",
    });
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(text).not.toContain("secret");
    expect(JSON.parse(text).errors).toEqual([{ field: "urls", index: 1, code: "credentials" }]);
    expect(await countRows()).toEqual(before);
  });

  test("the page limit is a 422 form error", async () => {
    const urls = Array.from({ length: MAX_UNIQUE_PAGE_URLS - 1 }, (_, i) => `https://chickpea.co/p${i}`);
    const project = await createProject("pages-route-0004", urls);
    const response = await addRequest(project.publicId, {
      urls: ["https://chickpea.co/x"],
      idempotencyKey: "pages-route-add-0004",
    });
    expect(response.status).toBe(422);
    expect((await response.json()).errors).toEqual([
      { field: "form", index: null, code: "too-many-pages" },
    ]);
  });

  test("a reused key with other rows is 409; a missing project is the generic 404", async () => {
    const project = await createProject("pages-route-0005");
    await addRequest(project.publicId, { urls: ["https://chickpea.co/a"], idempotencyKey: "pages-route-add-0005" });
    const conflict = await addRequest(project.publicId, {
      urls: ["https://chickpea.co/b"],
      idempotencyKey: "pages-route-add-0005",
    });
    expect(conflict.status).toBe(409);
    const missing = await addRequest("pub-nope", {
      urls: ["https://chickpea.co/a"],
      idempotencyKey: "pages-route-add-0006",
    });
    expect(missing.status).toBe(404);
  });

  test("the mutation boundary: origin, session, CSRF, content type, size, and schema", async () => {
    const project = await createProject("pages-route-0007");
    const body = { urls: ["https://chickpea.co/a"], idempotencyKey: "pages-route-add-0007" };
    const before = await countRows();
    for (const origin of ["https://evil.example", null]) {
      expect((await addRequest(project.publicId, body, { origin })).status).toBe(403);
    }
    for (const options of [{ cookie: null }, { csrf: null }]) {
      const status = (await addRequest(project.publicId, body, options)).status;
      expect(status).toBeGreaterThanOrEqual(401);
      expect(status).toBeLessThan(404);
    }
    expect((await addRequest(project.publicId, body, { contentType: "text/plain" })).status).toBe(415);
    expect(
      (
        await addRequest(project.publicId, undefined, {
          rawBody: JSON.stringify({ ...body, pad: "x".repeat(PROJECT_REQUEST_MAX_BYTES) }),
        })
      ).status,
    ).toBe(413);
    for (const bad of [
      { ...body, extra: true },
      { ...body, urls: [] },
      { urls: body.urls },
      { ...body, urls: "https://chickpea.co/a" },
    ]) {
      expect((await addRequest(project.publicId, bad)).status).toBe(400);
    }
    expect(await countRows()).toEqual(before);
  });

  test("other methods are not allowed", async () => {
    expect((await pagesGET()).status).toBe(405);
    expect((await pagesDELETE()).status).toBe(405);
  });
});
