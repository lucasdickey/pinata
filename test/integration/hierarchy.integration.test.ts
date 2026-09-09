// Real-Turso proof that the project/page/device organization and the capture
// attempt status model are durable (VAL-PROJECT-003, VAL-PROJECT-004,
// VAL-PROJECT-005).
//
// Focused tests prove the logic against an in-memory database; this suite
// proves the same behaviour against the configured Turso database and, in
// particular, that a *fresh* database handle — the readback a restarted
// process or a new deployment instance performs — returns the same hierarchy.
//
// It runs only when the Turso environment is present (locally via
// `node --env-file=.env.local node_modules/vitest/vitest.mjs run
// test/integration`) and skips silently otherwise. Every durable row carries
// a unique non-secret run id and is deleted with verified cleanup. No
// credential or connection detail is ever printed.

import { randomBytes } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { retryCapture } from "../../src/lib/server/captures/retry";
import { applyCaptureTransition } from "../../src/lib/server/captures/transitions";
import { createDatabase, schema, type Database } from "../../src/lib/server/db/client";
import {
  createProjectAtomically,
  type CreateProjectDeps,
} from "../../src/lib/server/projects/create";
import {
  listProjectHierarchies,
  readProjectHierarchy,
} from "../../src/lib/server/projects/hierarchy";
import { validateProjectSubmission } from "../../src/lib/server/projects/submission";

const hasDatabaseEnv = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
const RUN_ID = `valrun-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const createdKeys: string[] = [];

/** A brand-new client each time: the seam a restarted process goes through. */
const freshDatabase = (): Database => createDatabase(process.env)!;

function runDeps(suffix: string): CreateProjectDeps {
  let counter = 0;
  return {
    now: () => Date.now(),
    newId: () => `${RUN_ID}-${suffix}-${(counter += 1)}`,
    newPublicId: () => `${RUN_ID}-${suffix}-public`,
  };
}

function idempotencyKey(suffix: string): string {
  const key = `${RUN_ID}-${suffix}`;
  createdKeys.push(key);
  return key;
}

async function seedProject(db: Database, suffix: string) {
  const submission = validateProjectSubmission({
    title: `${RUN_ID} review`,
    rootUrl: "https://chickpea.co",
    urls: ["https://chickpea.co/pricing", "https://chickpea.co/about"],
  });
  if (!submission.ok) throw new Error("fixture submission must be valid");
  const result = await createProjectAtomically(
    db,
    submission,
    idempotencyKey(suffix),
    runDeps(suffix),
  );
  if (!result.ok) throw new Error("expected creation to succeed");
  return result.project;
}

async function captureRow(db: Database, pageId: string, variant: string, attempt: number) {
  const rows = await db
    .select()
    .from(schema.captures)
    .where(
      and(
        eq(schema.captures.pageId, pageId),
        eq(schema.captures.variant, variant),
        eq(schema.captures.attempt, attempt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("expected attempt row to exist");
  return row;
}

describe.skipIf(!hasDatabaseEnv)("real Turso hierarchy durability", () => {
  test("a fresh handle returns the same organization after the writing one is gone", async () => {
    const created = await seedProject(freshDatabase(), "durable");

    // A different client instance — no shared cache, no in-process state.
    const reader = freshDatabase();
    const hierarchy = await readProjectHierarchy(reader, created.publicId, Date.now());
    expect(hierarchy).not.toBeNull();
    expect(hierarchy!.projectId).toBe(created.projectId);
    expect(hierarchy!.rootUrl).toBe("https://chickpea.co/");
    expect(hierarchy!.pages.map((page) => page.normalizedUrl)).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);
    expect(hierarchy!.pages.map((page) => page.sortIndex)).toEqual([0, 1, 2]);
    for (const page of hierarchy!.pages) {
      expect(page.devices.map((device) => device.variant)).toEqual(["desktop", "mobile"]);
      expect(page.devices.every((device) => device.attempts.length === 1)).toBe(true);
    }
    expect(hierarchy!.counts).toEqual({
      pages: 3,
      attempts: 6,
      ready: 0,
      failed: 0,
      inProgress: 6,
    });

    // The list view scoped to this run agrees with the single-project read.
    const listed = (await listProjectHierarchies(freshDatabase(), Date.now())).find(
      (project) => project.projectId === created.projectId,
    );
    expect(JSON.stringify(listed)).toBe(JSON.stringify(hierarchy));
  }, 60_000);

  test("a partial failure keeps ordered successful siblings usable", async () => {
    const db = freshDatabase();
    const created = await seedProject(db, "partial");
    const [root, pricing] = created.pages;

    await applyCaptureTransition(db, {
      captureId: (await captureRow(db, root!.id, "desktop", 1)).id,
      from: "pending",
      to: "ready",
      imageHash: `${RUN_ID}-hash-root-desktop`,
      blobPath: `${RUN_ID}/root-desktop.webp`,
      now: Date.now(),
    });
    await applyCaptureTransition(db, {
      captureId: (await captureRow(db, pricing!.id, "mobile", 1)).id,
      from: "pending",
      to: "failed",
      errorCode: "total-timeout",
      errorMessage: "The capture exceeded its total time budget.",
      now: Date.now(),
    });

    const hierarchy = await readProjectHierarchy(freshDatabase(), created.publicId, Date.now());
    const pages = hierarchy!.pages;
    expect(pages.map((page) => page.normalizedUrl)).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);
    expect(pages[0]!.devices[0]!.usable).toBe(true);
    expect(pages[0]!.devices[0]!.selectedCaptureId).toBe(
      (await captureRow(db, root!.id, "desktop", 1)).id,
    );
    // The failing mobile sibling neither rolled back nor hid the ready one.
    expect(pages[1]!.devices[1]!.latest?.state).toBe("failed");
    expect(pages[1]!.devices[1]!.latest?.errorCode).toBe("total-timeout");
    expect(pages[1]!.devices[0]!.latest?.state).toBe("pending");
    expect(hierarchy!.counts).toMatchObject({ ready: 1, failed: 1, inProgress: 4 });
  }, 60_000);

  test("a scoped retry is idempotent and a late old result cannot win", async () => {
    const db = freshDatabase();
    const created = await seedProject(db, "retry");
    const page = created.pages[0]!;

    const first = await captureRow(db, page.id, "desktop", 1);
    await applyCaptureTransition(db, {
      captureId: first.id,
      from: "pending",
      to: "capturing",
      now: Date.now(),
    });

    const key = idempotencyKey("retry-attempt");
    const target = { pageId: page.id, variant: "desktop", idempotencyKey: key };
    const retryDeps = {
      // Far enough past the published stale age that attempt 1 computes stale.
      now: () => Date.now() + 3_600_000,
      newId: () => `${RUN_ID}-retry-attempt-2`,
    };
    const retried = await retryCapture(db, target, retryDeps);
    if (!retried.ok) throw new Error("a stale attempt must be retryable");
    expect(retried.created).toBe(true);
    expect(retried.attempt.attempt).toBe(2);

    // The exact same intent, replayed: one attempt, not two.
    const replay = await retryCapture(freshDatabase(), target, retryDeps);
    expect(replay).toEqual({ ok: true, created: false, attempt: retried.attempt });

    // The same key aimed at the mobile sibling conflicts instead of scheduling.
    const conflict = await retryCapture(
      freshDatabase(),
      { ...target, variant: "mobile" },
      retryDeps,
    );
    expect(conflict).toEqual({ ok: false, error: "conflict" });

    // Attempt 2 commits ready; only then does the abandoned attempt 1 report.
    await applyCaptureTransition(db, {
      captureId: retried.attempt.id,
      from: "pending",
      to: "ready",
      imageHash: `${RUN_ID}-hash-new`,
      blobPath: `${RUN_ID}/desktop-2.webp`,
      now: Date.now(),
    });
    const late = await applyCaptureTransition(db, {
      captureId: first.id,
      from: "capturing",
      to: "ready",
      imageHash: `${RUN_ID}-hash-old`,
      blobPath: `${RUN_ID}/desktop-1.webp`,
      now: Date.now(),
    });
    expect(late).toBe("applied");
    // A second late report of the same attempt is fenced by the terminal row.
    expect(
      await applyCaptureTransition(db, {
        captureId: first.id,
        from: "capturing",
        to: "failed",
        errorCode: "total-timeout",
        now: Date.now(),
      }),
    ).toBe("fenced");

    const device = (
      await readProjectHierarchy(freshDatabase(), created.publicId, Date.now())
    )!.pages[0]!.devices[0]!;
    expect(device.attempts.map((attempt) => attempt.attempt)).toEqual([2, 1]);
    expect(device.selectedCaptureId).toBe(retried.attempt.id);
    // Both versions stay addressable with their own immutable image hashes.
    expect(device.attempts.map((attempt) => attempt.imageHash)).toEqual([
      `${RUN_ID}-hash-new`,
      `${RUN_ID}-hash-old`,
    ]);
    // The mobile sibling was never resubmitted.
    const mobile = (
      await readProjectHierarchy(freshDatabase(), created.publicId, Date.now())
    )!.pages[0]!.devices[1]!;
    expect(mobile.attempts).toHaveLength(1);
  }, 60_000);
});

afterAll(async () => {
  if (!hasDatabaseEnv) return;
  const db = freshDatabase();
  const projectRows = await db
    .select()
    .from(schema.projects)
    .where(like(schema.projects.id, `${RUN_ID}-%`));
  if (projectRows.length > 0) {
    const pageRows = await db
      .select()
      .from(schema.pages)
      .where(
        inArray(
          schema.pages.projectId,
          projectRows.map((project) => project.id),
        ),
      );
    if (pageRows.length > 0) {
      await db.delete(schema.captures).where(
        inArray(
          schema.captures.pageId,
          pageRows.map((page) => page.id),
        ),
      );
      await db.delete(schema.pages).where(
        inArray(
          schema.pages.id,
          pageRows.map((page) => page.id),
        ),
      );
    }
    await db.delete(schema.projects).where(
      inArray(
        schema.projects.id,
        projectRows.map((project) => project.id),
      ),
    );
  }
  for (const key of createdKeys) {
    await db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, key));
  }

  const remaining = {
    projects: (
      await db.select().from(schema.projects).where(like(schema.projects.id, `${RUN_ID}-%`))
    ).length,
    pages: (await db.select().from(schema.pages).where(like(schema.pages.id, `${RUN_ID}-%`)))
      .length,
    captures: (
      await db.select().from(schema.captures).where(like(schema.captures.id, `${RUN_ID}-%`))
    ).length,
    keys: (
      await db
        .select()
        .from(schema.idempotencyKeys)
        .where(like(schema.idempotencyKeys.key, `${RUN_ID}-%`))
    ).length,
  };
  expect(remaining).toEqual({ projects: 0, pages: 0, captures: 0, keys: 0 });
}, 60_000);
