// Per-project capture progress on the hierarchy read (D076): one unit per
// page device judged by its newest attempt, the page capturing right now,
// and an estimate from the median duration of this project's finished
// attempts — null until one has finished. The read stays read-only.

import { asc } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { STALE_CAPTURE_AGE_MS } from "../../src/lib/boundaries";
import { applyCaptureTransition } from "../../src/lib/server/captures/transitions";
import { schema } from "../../src/lib/server/db/client";
import {
  computeProjectProgress,
  listProjectHierarchies,
  readProjectHierarchy,
} from "../../src/lib/server/projects/hierarchy";
import { attemptsFor, seedProject, T0 } from "./capture-drive-helpers";
import { createTestDb, type TestDb } from "./test-db";

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(() => {
  testDb.client.close();
});

async function attempt(pageId: string, variant: string, index = 1) {
  const rows = await attemptsFor(testDb.db, pageId, variant);
  const row = rows[index - 1];
  if (!row) throw new Error("fixture attempt must exist");
  return row;
}

/** Move one attempt through capturing to a terminal state with real timing. */
async function finish(
  captureId: string,
  to: "ready" | "failed",
  startedAt: number,
  durationMs: number,
) {
  await applyCaptureTransition(testDb.db, {
    captureId,
    from: "pending",
    to: "capturing",
    now: startedAt,
  });
  await applyCaptureTransition(testDb.db, {
    captureId,
    from: "capturing",
    to,
    now: startedAt + durationMs,
    ...(to === "failed" ? { errorCode: "total-timeout" } : {}),
  });
}

describe("progress on the hierarchy read", () => {
  test("a fresh project is all in progress with no estimate", async () => {
    const project = await seedProject(
      testDb.db,
      "https://safe.example",
      ["https://safe.example/two"],
      "progress-0001",
    );
    const [hierarchy] = await listProjectHierarchies(testDb.db, T0 + 1);
    expect(hierarchy!.projectId).toBe(project.projectId);
    expect(hierarchy!.progress).toEqual({
      total: 4,
      done: 0,
      failed: 0,
      inProgress: 4,
      capturingPage: null,
      estimatedRemainingMs: null,
    });
  });

  test("counts done, failed, and in progress by each device's newest attempt", async () => {
    const project = await seedProject(
      testDb.db,
      "https://safe.example",
      ["https://safe.example/two"],
      "progress-0002",
    );
    const [root, two] = project.pages;
    await finish((await attempt(root!.id, "desktop")).id, "ready", T0 + 10, 20_000);
    await finish((await attempt(root!.id, "mobile")).id, "failed", T0 + 10, 40_000);
    await applyCaptureTransition(testDb.db, {
      captureId: (await attempt(two!.id, "desktop")).id,
      from: "pending",
      to: "capturing",
      now: T0 + 60_000,
    });

    const hierarchy = await readProjectHierarchy(testDb.db, project.publicId, T0 + 61_000);
    expect(hierarchy!.progress).toEqual({
      total: 4,
      done: 1,
      failed: 1,
      inProgress: 2,
      capturingPage: "https://safe.example/two",
      // Median of 20 s and 40 s is 30 s, times two devices still open.
      estimatedRemainingMs: 30_000 * 2,
    });
  });

  test("the estimate is the median, so one slow attempt does not dominate", async () => {
    const project = await seedProject(
      testDb.db,
      "https://safe.example",
      ["https://safe.example/two", "https://safe.example/three"],
      "progress-0003",
    );
    const [root, two] = project.pages;
    await finish((await attempt(root!.id, "desktop")).id, "ready", T0, 10_000);
    await finish((await attempt(root!.id, "mobile")).id, "ready", T0, 12_000);
    await finish((await attempt(two!.id, "desktop")).id, "ready", T0, 90_000);
    const hierarchy = await readProjectHierarchy(testDb.db, project.publicId, T0 + 100_000);
    expect(hierarchy!.progress.done).toBe(3);
    expect(hierarchy!.progress.inProgress).toBe(3);
    expect(hierarchy!.progress.estimatedRemainingMs).toBe(12_000 * 3);
  });

  test("a finished project reports zero remaining, a stale attempt stays in progress, and the newest attempt decides", async () => {
    const project = await seedProject(testDb.db, "https://safe.example", [], "progress-0004");
    const page = project.pages[0]!;
    await finish((await attempt(page.id, "desktop")).id, "ready", T0, 5_000);
    await finish((await attempt(page.id, "mobile")).id, "ready", T0, 7_000);
    const done = await readProjectHierarchy(testDb.db, project.publicId, T0 + 10_000);
    expect(done!.progress).toEqual({
      total: 2,
      done: 2,
      failed: 0,
      inProgress: 0,
      capturingPage: null,
      estimatedRemainingMs: 0,
    });

    // A retry row that was claimed and abandoned: the device's newest
    // attempt is stale, which is still "in progress" for progress purposes
    // and not a capturing page.
    await testDb.db.insert(schema.captures).values({
      id: "retry-stale",
      pageId: page.id,
      variant: "desktop",
      attempt: 2,
      status: "capturing",
      idempotencyKey: "retry:stale",
      requestedUrl: page.normalizedUrl,
      viewportWidth: 1440,
      viewportHeight: 900,
      deviceScaleFactor: 1,
      startedAt: T0 + 20_000,
      createdAt: T0 + 20_000,
      updatedAt: T0 + 20_000,
    });
    const later = await readProjectHierarchy(
      testDb.db,
      project.publicId,
      T0 + 20_000 + STALE_CAPTURE_AGE_MS + 1,
    );
    expect(later!.progress).toMatchObject({
      total: 2,
      done: 1,
      failed: 0,
      inProgress: 1,
      capturingPage: null,
      estimatedRemainingMs: 6_000,
    });
  });

  test("each project's estimate comes from its own attempts only", async () => {
    const slow = await seedProject(testDb.db, "https://safe.example/slow", [], "progress-0005");
    const fast = await seedProject(testDb.db, "https://safe.example/fast", [], "progress-0006");
    await finish((await attempt(slow.pages[0]!.id, "desktop")).id, "ready", T0, 80_000);
    await finish((await attempt(fast.pages[0]!.id, "desktop")).id, "ready", T0, 4_000);
    const slowRead = await readProjectHierarchy(testDb.db, slow.publicId, T0 + 100_000);
    const fastRead = await readProjectHierarchy(testDb.db, fast.publicId, T0 + 100_000);
    expect(slowRead!.progress.estimatedRemainingMs).toBe(80_000);
    expect(fastRead!.progress.estimatedRemainingMs).toBe(4_000);
  });

  test("the hierarchy read writes nothing", async () => {
    const project = await seedProject(testDb.db, "https://safe.example", [], "progress-0007");
    const before = await testDb.db.select().from(schema.captures).orderBy(asc(schema.captures.id));
    await listProjectHierarchies(testDb.db, T0 + 1);
    await readProjectHierarchy(testDb.db, project.publicId, T0 + 1);
    const after = await testDb.db.select().from(schema.captures).orderBy(asc(schema.captures.id));
    expect(after).toEqual(before);
    const leases = await testDb.db.select().from(schema.captureLeases);
    expect(leases).toEqual([]);
  });
});

describe("computeProjectProgress", () => {
  test("an empty project has no units and no estimate", () => {
    expect(computeProjectProgress([], [])).toEqual({
      total: 0,
      done: 0,
      failed: 0,
      inProgress: 0,
      capturingPage: null,
      estimatedRemainingMs: null,
    });
  });
});
