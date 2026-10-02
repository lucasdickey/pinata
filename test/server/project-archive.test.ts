// Archiving a project (D108, D110): the store function, the project list
// that leaves archived projects out, the founder link that keeps working,
// and the editor-only POST /api/projects/[publicId]/archive boundary.
// Runs against the committed migrations in an in-memory libSQL database,
// so it also proves migration 0007 applies.

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DELETE as archiveDELETE,
  GET as archiveGET,
  POST as archivePOST,
} from "../../app/api/projects/[publicId]/archive/route";
import { GET as projectsGET } from "../../app/api/projects/route";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { createEditorSession } from "../../src/lib/server/auth/session";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import {
  exchangeFounderToken,
  issueFounderCapability,
} from "../../src/lib/server/founder/capability";
import { archiveProject } from "../../src/lib/server/projects/archive";
import {
  listProjectHierarchies,
  readProjectHierarchy,
} from "../../src/lib/server/projects/hierarchy";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "archive-route-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let session: { token: string; csrf: string };

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  const created = createEditorSession(TEST_SECRET, T0);
  session = { token: created.token, csrf: created.payload.csrf };
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
      createdAt: T0 + 1,
      updatedAt: T0 + 1,
    },
    {
      id: "proj-gone",
      publicId: "pub-gone",
      title: "Gone",
      rootUrl: "https://gone.example/",
      createdAt: T0,
      updatedAt: T0,
      deletedAt: T0 + 2,
    },
  ]);
});

afterEach(() => {
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function projectRow(id: string) {
  const rows = await testDb.db.select().from(schema.projects).where(eq(schema.projects.id, id));
  return rows[0]!;
}

interface RequestOptions {
  method?: string;
  origin?: string | null;
  cookie?: string | null;
  csrf?: string | null;
}

function archiveRequest(publicId: string, options: RequestOptions = {}): Request {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.set("origin", origin);
  headers.set("host", "127.0.0.1:3100");
  const cookie =
    options.cookie === undefined ? `${EDITOR_SESSION_COOKIE}=${session.token}` : options.cookie;
  if (cookie) headers.set("cookie", cookie);
  const csrf = options.csrf === undefined ? session.csrf : options.csrf;
  if (csrf) headers.set(EDITOR_CSRF_HEADER, csrf);
  return new Request(`${ORIGIN}/api/projects/${publicId}/archive`, {
    method: options.method ?? "POST",
    headers,
  });
}

const context = (publicId: string) => ({ params: Promise.resolve({ publicId }) });

describe("archiveProject", () => {
  test("stamps archivedAt and updatedAt and changes nothing else", async () => {
    const before = await projectRow("proj-a");
    const result = await archiveProject(testDb.db, "pub-a", T0 + 10);
    expect(result).toEqual({ ok: true, archivedAt: T0 + 10 });
    const after = await projectRow("proj-a");
    expect(after).toEqual({ ...before, archivedAt: T0 + 10, updatedAt: T0 + 10 });
    expect(after.deletedAt).toBeNull();
  });

  test("archiving twice keeps the first timestamp", async () => {
    await archiveProject(testDb.db, "pub-a", T0 + 10);
    const again = await archiveProject(testDb.db, "pub-a", T0 + 20);
    expect(again).toEqual({ ok: true, archivedAt: T0 + 10 });
    expect((await projectRow("proj-a")).updatedAt).toBe(T0 + 10);
  });

  test("a missing or deleted project is not found", async () => {
    expect(await archiveProject(testDb.db, "pub-nope", T0)).toEqual({
      ok: false,
      error: "not-found",
    });
    expect(await archiveProject(testDb.db, "pub-gone", T0)).toEqual({
      ok: false,
      error: "not-found",
    });
    expect((await projectRow("proj-gone")).archivedAt).toBeNull();
  });
});

describe("what an archive hides and what it leaves alone", () => {
  test("the project list leaves archived projects out", async () => {
    await archiveProject(testDb.db, "pub-a", T0 + 10);
    const listed = await listProjectHierarchies(testDb.db, T0 + 10);
    expect(listed.map((p) => p.publicId)).toEqual(["pub-b"]);
  });

  test("an archived project still reads by its public locator", async () => {
    await archiveProject(testDb.db, "pub-a", T0 + 10);
    const project = await readProjectHierarchy(testDb.db, "pub-a", T0 + 10);
    expect(project?.publicId).toBe("pub-a");
  });

  test("the founder link keeps working after an archive (D110)", async () => {
    const issued = await issueFounderCapability(testDb.db, "pub-a", T0);
    expect(issued).not.toBeNull();
    await archiveProject(testDb.db, "pub-a", T0 + 10);
    const grant = await exchangeFounderToken(testDb.db, "pub-a", issued!.token);
    expect(grant?.projectId).toBe("proj-a");
  });
});

describe("POST /api/projects/[publicId]/archive", () => {
  test("the editor archives a project and it leaves GET /api/projects", async () => {
    const response = await archivePOST(archiveRequest("pub-a"), context("pub-a"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ archived: { publicId: "pub-a", archivedAt: T0 } });

    const list = await projectsGET(
      new Request(`${ORIGIN}/api/projects`, {
        headers: { cookie: `${EDITOR_SESSION_COOKIE}=${session.token}` },
      }),
    );
    const { projects } = await list.json();
    expect(projects.map((p: { publicId: string }) => p.publicId)).toEqual(["pub-b"]);
  });

  test("a cross-origin or originless request is rejected and archives nothing", async () => {
    for (const origin of ["https://evil.example", null]) {
      const response = await archivePOST(archiveRequest("pub-a", { origin }), context("pub-a"));
      expect(response.status).toBe(403);
    }
    expect((await projectRow("proj-a")).archivedAt).toBeNull();
  });

  test("an anonymous caller or a missing CSRF proof archives nothing", async () => {
    const anonymous = await archivePOST(archiveRequest("pub-a", { cookie: null }), context("pub-a"));
    expect(anonymous.status).toBeGreaterThanOrEqual(401);
    expect(anonymous.status).toBeLessThan(404);
    const noProof = await archivePOST(archiveRequest("pub-a", { csrf: null }), context("pub-a"));
    expect(noProof.status).toBeGreaterThanOrEqual(401);
    expect(noProof.status).toBeLessThan(404);
    expect((await projectRow("proj-a")).archivedAt).toBeNull();
  });

  test("a missing or deleted project is the generic 404", async () => {
    expect((await archivePOST(archiveRequest("pub-nope"), context("pub-nope"))).status).toBe(404);
    expect((await archivePOST(archiveRequest("pub-gone"), context("pub-gone"))).status).toBe(404);
  });

  test("other methods are not allowed (unarchive is deferred, D109)", async () => {
    expect((await archiveGET()).status).toBe(405);
    expect((await archiveDELETE()).status).toBe(405);
  });
});
