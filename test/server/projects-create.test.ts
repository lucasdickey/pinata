// Atomic project creation against a migrated in-memory libSQL database
// (VAL-PROJECT-001, VAL-PROJECT-006). Real Turso corroboration lives in
// test/integration/projects.integration.test.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { asc } from "drizzle-orm";
import { DESKTOP_VIEWPORT, MOBILE_VIEWPORT } from "../../src/lib/boundaries";
import { schema } from "../../src/lib/server/db/client";
import {
  createProjectAtomically,
  PROJECT_CREATE_SCOPE,
  type CreateProjectDeps,
  type CreateProjectResult,
} from "../../src/lib/server/projects/create";
import { validateProjectSubmission } from "../../src/lib/server/projects/submission";
import { createTestDb, type TestDb } from "./test-db";

const T0 = 1_800_000_000_000;

function deterministicDeps(prefix: string): CreateProjectDeps {
  let counter = 0;
  return {
    now: () => T0,
    newId: () => `${prefix}-id-${(counter += 1)}`,
    newPublicId: () => `${prefix}-public`,
  };
}

function submissionOf(rootUrl: string, urls?: string[]) {
  const result = validateProjectSubmission({ rootUrl, urls });
  if (!result.ok) throw new Error("fixture submission must be valid");
  return result;
}

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(() => {
  testDb.client.close();
});

const rows = {
  projects: () => testDb.db.select().from(schema.projects),
  pages: () => testDb.db.select().from(schema.pages).orderBy(asc(schema.pages.sortIndex)),
  captures: () =>
    testDb.db
      .select()
      .from(schema.captures)
      .orderBy(asc(schema.captures.pageId), asc(schema.captures.variant)),
  keys: () => testDb.db.select().from(schema.idempotencyKeys),
};

describe("one transaction creates the whole hierarchy", () => {
  test("project, ordered pages, and two pending attempts per page appear together", async () => {
    const submission = submissionOf("https://chickpea.co", [
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);
    const result = await createProjectAtomically(
      testDb.db,
      submission,
      "idem-key-000001",
      deterministicDeps("a"),
    );
    expect(result).toMatchObject({ ok: true, created: true });

    expect(await rows.projects()).toHaveLength(1);
    const pageRows = await rows.pages();
    expect(pageRows.map((page) => page.normalizedUrl)).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);
    expect(pageRows.map((page) => page.sortIndex)).toEqual([0, 1, 2]);

    const captureRows = await rows.captures();
    expect(captureRows).toHaveLength(6);
    for (const page of pageRows) {
      const forPage = captureRows.filter((capture) => capture.pageId === page.id);
      expect(forPage.map((capture) => capture.variant).sort()).toEqual(["desktop", "mobile"]);
      for (const capture of forPage) {
        expect(capture.status).toBe("pending");
        expect(capture.attempt).toBe(1);
        expect(capture.requestedUrl).toBe(page.normalizedUrl);
        expect(capture.blobPath).toBeNull();
        expect(capture.errorCode).toBeNull();
      }
      const desktop = forPage.find((capture) => capture.variant === "desktop");
      const mobile = forPage.find((capture) => capture.variant === "mobile");
      expect(desktop?.viewportWidth).toBe(DESKTOP_VIEWPORT.width);
      expect(desktop?.viewportHeight).toBe(DESKTOP_VIEWPORT.height);
      expect(mobile?.viewportWidth).toBe(MOBILE_VIEWPORT.width);
      expect(mobile?.viewportHeight).toBe(MOBILE_VIEWPORT.height);
    }
  });

  test("the returned identities match the persisted rows exactly", async () => {
    const result = await createProjectAtomically(
      testDb.db,
      submissionOf("https://chickpea.co", ["https://chickpea.co/pricing"]),
      "idem-key-000002",
      deterministicDeps("b"),
    );
    if (!result.ok) throw new Error("expected success");
    const [project] = await rows.projects();
    expect(project?.id).toBe(result.project.projectId);
    expect(project?.publicId).toBe(result.project.publicId);
    const pageRows = await rows.pages();
    expect(pageRows.map((page) => page.id)).toEqual(result.project.pages.map((page) => page.id));
    const captureIds = (await rows.captures()).map((capture) => capture.id).sort();
    expect(captureIds).toEqual(
      result.project.pages.flatMap((page) => page.captures.map((c) => c.id)).sort(),
    );
  });

  test("a failure inside the transaction leaves no subset behind", async () => {
    const submission = submissionOf("https://chickpea.co", ["https://chickpea.co/pricing"]);
    // Force the last insert of the transaction to fail: two pages cannot
    // share one page id, so the capture insert violates its foreign key.
    const brokenDeps: CreateProjectDeps = {
      now: () => T0,
      newId: () => "collide",
      newPublicId: () => "collide-public",
    };
    await expect(
      createProjectAtomically(testDb.db, submission, "idem-key-000003", brokenDeps),
    ).rejects.toThrow();

    expect(await rows.projects()).toEqual([]);
    expect(await rows.pages()).toEqual([]);
    expect(await rows.captures()).toEqual([]);
    expect(await rows.keys()).toEqual([]);
  });

  test("a same-key retry after a rolled-back attempt completes exactly once", async () => {
    const submission = submissionOf("https://chickpea.co", ["https://chickpea.co/pricing"]);
    const brokenDeps: CreateProjectDeps = {
      now: () => T0,
      newId: () => "collide",
      newPublicId: () => "collide-public",
    };
    await expect(
      createProjectAtomically(testDb.db, submission, "idem-key-000004", brokenDeps),
    ).rejects.toThrow();

    const retry = await createProjectAtomically(
      testDb.db,
      submission,
      "idem-key-000004",
      deterministicDeps("c"),
    );
    expect(retry).toMatchObject({ ok: true, created: true });
    expect(await rows.projects()).toHaveLength(1);
    expect(await rows.captures()).toHaveLength(4);
  });

  test("no network call is made while creating a project", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await createProjectAtomically(
      testDb.db,
      submissionOf("https://chickpea.co", ["https://chickpea.co/pricing"]),
      "idem-key-000005",
      deterministicDeps("d"),
    );
    // Pinata never crawls, and provider work starts only after the commit.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("idempotency", () => {
  test("the same key and payload return the original identities without writing again", async () => {
    const submission = submissionOf("https://chickpea.co", ["https://chickpea.co/pricing"]);
    const first = await createProjectAtomically(
      testDb.db,
      submission,
      "idem-key-000010",
      deterministicDeps("e"),
    );
    const second = await createProjectAtomically(
      testDb.db,
      submission,
      "idem-key-000010",
      deterministicDeps("f"),
    );
    if (!first.ok || !second.ok) throw new Error("expected both to succeed");
    expect(second.created).toBe(false);
    expect(second.project).toEqual(first.project);
    expect(await rows.projects()).toHaveLength(1);
    expect(await rows.pages()).toHaveLength(2);
    expect(await rows.captures()).toHaveLength(4);
  });

  test("an equivalent payload (fragments, duplicates, case) still replays", async () => {
    const first = await createProjectAtomically(
      testDb.db,
      submissionOf("https://chickpea.co", ["https://chickpea.co/pricing"]),
      "idem-key-000011",
      deterministicDeps("g"),
    );
    const second = await createProjectAtomically(
      testDb.db,
      submissionOf("https://CHICKPEA.co/#top", [
        "https://chickpea.co/pricing#plans",
        "https://chickpea.co/",
      ]),
      "idem-key-000011",
      deterministicDeps("h"),
    );
    if (!first.ok || !second.ok) throw new Error("expected both to succeed");
    expect(second.project).toEqual(first.project);
  });

  test("the same key with a different payload conflicts and writes nothing", async () => {
    await createProjectAtomically(
      testDb.db,
      submissionOf("https://chickpea.co", ["https://chickpea.co/pricing"]),
      "idem-key-000012",
      deterministicDeps("i"),
    );
    const conflict = await createProjectAtomically(
      testDb.db,
      submissionOf("https://chickpea.co", ["https://chickpea.co/about"]),
      "idem-key-000012",
      deterministicDeps("j"),
    );
    expect(conflict).toEqual({ ok: false, error: "conflict" });
    expect(await rows.projects()).toHaveLength(1);
    expect(await rows.pages()).toHaveLength(2);
  });

  test("a deliberate new key creates a separate review of the same root", async () => {
    const submission = submissionOf("https://chickpea.co", ["https://chickpea.co/pricing"]);
    const first = await createProjectAtomically(
      testDb.db,
      submission,
      "idem-key-000013",
      deterministicDeps("k"),
    );
    const second = await createProjectAtomically(
      testDb.db,
      submission,
      "idem-key-000014",
      deterministicDeps("l"),
    );
    if (!first.ok || !second.ok) throw new Error("expected both to succeed");
    expect(second.created).toBe(true);
    expect(second.project.projectId).not.toBe(first.project.projectId);
    expect(second.project.publicId).not.toBe(first.project.publicId);
    expect(await rows.projects()).toHaveLength(2);
    expect(await rows.captures()).toHaveLength(8);
  });

  test("a key committed by a concurrent request converges instead of failing", async () => {
    // The production race: this caller's pre-check found nothing, another
    // request committed the same key, and this transaction then loses on the
    // idempotency primary key. Simulated deterministically because a single
    // libSQL connection cannot hold two overlapping transactions; real Turso
    // concurrency is exercised in the integration suite.
    const submission = submissionOf("https://chickpea.co", ["https://chickpea.co/pricing"]);
    const race: { winner: CreateProjectResult | null } = { winner: null };
    const racingDb = new Proxy(testDb.db, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async () => {
            race.winner = await createProjectAtomically(
              testDb.db,
              submission,
              "idem-key-000015",
              deterministicDeps("winner"),
            );
            throw new Error("UNIQUE constraint failed: idempotency_keys.scope");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const loser = await createProjectAtomically(
      racingDb,
      submission,
      "idem-key-000015",
      deterministicDeps("loser"),
    );
    const committed = race.winner;
    expect(committed).toMatchObject({ ok: true, created: true });
    expect(loser).toMatchObject({ ok: true, created: false });
    if (!loser.ok || !committed?.ok) throw new Error("expected convergence");
    expect(loser.project).toEqual(committed.project);
    expect(await rows.projects()).toHaveLength(1);
    expect(await rows.captures()).toHaveLength(4);
  });

  test("a conflicting payload that lost the race still conflicts", async () => {
    const mine = submissionOf("https://chickpea.co", ["https://chickpea.co/about"]);
    const theirs = submissionOf("https://chickpea.co", ["https://chickpea.co/pricing"]);
    const racingDb = new Proxy(testDb.db, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async () => {
            await createProjectAtomically(
              testDb.db,
              theirs,
              "idem-key-000017",
              deterministicDeps("winner"),
            );
            throw new Error("UNIQUE constraint failed: idempotency_keys.scope");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const loser = await createProjectAtomically(
      racingDb,
      mine,
      "idem-key-000017",
      deterministicDeps("loser"),
    );
    expect(loser).toEqual({ ok: false, error: "conflict" });
    expect(await rows.projects()).toHaveLength(1);
  });

  test("the idempotency record is scoped and stores only a digest", async () => {
    const submission = submissionOf("https://chickpea.co");
    await createProjectAtomically(
      testDb.db,
      submission,
      "idem-key-000016",
      deterministicDeps("o"),
    );
    const [record] = await rows.keys();
    expect(record?.scope).toBe(PROJECT_CREATE_SCOPE);
    expect(record?.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(record?.payloadDigest).toBe(submission.payloadDigest);
  });
});
