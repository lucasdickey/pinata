// The project → page → device hierarchy read from the durable store
// (VAL-PROJECT-003, VAL-PROJECT-004, VAL-PROJECT-005): only explicitly
// submitted pages, under their owning project, in submitted order, each with
// exactly the Desktop and Mobile devices and their ordered attempt history.

import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyCaptureTransition } from "../../src/lib/server/captures/transitions";
import { schema } from "../../src/lib/server/db/client";
import { createProjectAtomically } from "../../src/lib/server/projects/create";
import {
  listProjectHierarchies,
  readProjectHierarchy,
} from "../../src/lib/server/projects/hierarchy";
import { validateProjectSubmission } from "../../src/lib/server/projects/submission";
import { createTestDb, type TestDb } from "./test-db";

const T0 = 1_800_000_000_000;

let testDb: TestDb;
let counter = 0;

function deps(createdAt: number) {
  return {
    now: () => createdAt,
    newId: () => `id-${String(++counter).padStart(4, "0")}`,
    newPublicId: () => `pub-${String(counter)}`,
  };
}

async function seed(rootUrl: string, urls: string[], key: string, createdAt = T0) {
  const submission = validateProjectSubmission({ rootUrl, urls });
  if (!submission.ok) throw new Error("fixture submission must be valid");
  const result = await createProjectAtomically(testDb.db, submission, key, deps(createdAt));
  if (!result.ok) throw new Error("fixture project must be created");
  return result.project;
}

async function captureId(pageId: string, variant: string, attempt: number) {
  const rows = await testDb.db
    .select()
    .from(schema.captures)
    .where(and(eq(schema.captures.pageId, pageId), eq(schema.captures.variant, variant)))
    .orderBy(asc(schema.captures.attempt));
  const row = rows[attempt - 1];
  if (!row) throw new Error("fixture attempt must exist");
  return row.id;
}

beforeEach(async () => {
  counter = 0;
  testDb = await createTestDb();
});

afterEach(() => {
  testDb.client.close();
});

describe("listProjectHierarchies", () => {
  test("contains only submitted pages, under their owner, in submitted order", async () => {
    await seed(
      "https://chickpea.co",
      ["https://chickpea.co/pricing", "https://chickpea.co/about"],
      "key-a-0001",
      T0,
    );
    await seed("https://example.com", ["https://example.com/two"], "key-b-0001", T0 + 1);

    const hierarchies = await listProjectHierarchies(testDb.db, T0 + 10);
    expect(hierarchies).toHaveLength(2);
    const byRoot = new Map(hierarchies.map((project) => [project.rootUrl, project]));

    expect(byRoot.get("https://chickpea.co/")!.pages.map((p) => p.normalizedUrl)).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);
    expect(byRoot.get("https://example.com/")!.pages.map((p) => p.normalizedUrl)).toEqual([
      "https://example.com/",
      "https://example.com/two",
    ]);
    // No page from one project ever appears under the other.
    for (const project of hierarchies) {
      const host = new URL(project.rootUrl).hostname;
      expect(project.pages.every((page) => new URL(page.normalizedUrl).hostname === host)).toBe(
        true,
      );
    }
  });

  test("every page exposes exactly Desktop then Mobile", async () => {
    await seed("https://chickpea.co", ["https://chickpea.co/pricing"], "key-a-0002");
    const [project] = await listProjectHierarchies(testDb.db, T0);
    for (const page of project!.pages) {
      expect(page.devices.map((device) => device.variant)).toEqual(["desktop", "mobile"]);
      expect(page.devices.every((device) => device.attempts.length === 1)).toBe(true);
      expect(page.devices.every((device) => device.latest?.state === "pending")).toBe(true);
      expect(page.devices.every((device) => device.usable)).toBe(false);
    }
  });

  test("a partial failure leaves ordered successful siblings usable", async () => {
    const project = await seed(
      "https://chickpea.co",
      ["https://chickpea.co/pricing", "https://chickpea.co/about"],
      "key-a-0003",
    );
    const [root, pricing, about] = project.pages;
    // Root: both ready. Pricing: desktop ready, mobile failed. About: both failed.
    for (const variant of ["desktop", "mobile"]) {
      await applyCaptureTransition(testDb.db, {
        captureId: await captureId(root!.id, variant, 1),
        from: "pending",
        to: "ready",
        imageHash: `hash-root-${variant}`,
        blobPath: `captures/root-${variant}.webp`,
        now: T0 + 1,
      });
    }
    await applyCaptureTransition(testDb.db, {
      captureId: await captureId(pricing!.id, "desktop", 1),
      from: "pending",
      to: "ready",
      imageHash: "hash-pricing-desktop",
      blobPath: "captures/pricing-desktop.webp",
      now: T0 + 2,
    });
    for (const [pageId, variant] of [
      [pricing!.id, "mobile"],
      [about!.id, "desktop"],
      [about!.id, "mobile"],
    ] as const) {
      await applyCaptureTransition(testDb.db, {
        captureId: await captureId(pageId, variant, 1),
        from: "pending",
        to: "failed",
        errorCode: "total-timeout",
        errorMessage: "The capture exceeded its total time budget.",
        now: T0 + 3,
      });
    }

    const [hierarchy] = await listProjectHierarchies(testDb.db, T0 + 10);
    expect(hierarchy!.pages.map((page) => page.normalizedUrl)).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);
    const usable = hierarchy!.pages.map((page) => page.devices.map((device) => device.usable));
    expect(usable).toEqual([
      [true, true],
      [true, false],
      [false, false],
    ]);
    expect(hierarchy!.counts).toEqual({
      pages: 3,
      attempts: 6,
      ready: 3,
      failed: 3,
      inProgress: 0,
    });
    // Retry is offered on exactly the terminal failed devices and the ready ones.
    expect(
      hierarchy!.pages[1]!.devices.map((device) => ({
        variant: device.variant,
        retryable: device.retryable,
        errorCode: device.latest?.errorCode ?? null,
      })),
    ).toEqual([
      { variant: "desktop", retryable: true, errorCode: null },
      { variant: "mobile", retryable: true, errorCode: "total-timeout" },
    ]);
  });

  test("two reads of the same rows produce identical output", async () => {
    await seed("https://chickpea.co", ["https://chickpea.co/pricing"], "key-a-0004");
    const first = await listProjectHierarchies(testDb.db, T0 + 5);
    const second = await listProjectHierarchies(testDb.db, T0 + 5);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("readProjectHierarchy", () => {
  test("returns one project by its public id", async () => {
    const created = await seed("https://chickpea.co", ["https://chickpea.co/pricing"], "key-a-0005");
    await seed("https://example.com", [], "key-b-0005", T0 + 1);
    const hierarchy = await readProjectHierarchy(testDb.db, created.publicId, T0 + 5);
    expect(hierarchy?.projectId).toBe(created.projectId);
    expect(hierarchy?.pages).toHaveLength(2);
    expect(hierarchy?.pages.every((page) => page.normalizedUrl.includes("chickpea.co"))).toBe(true);
  });

  test("an unknown public id is null rather than an error", async () => {
    expect(await readProjectHierarchy(testDb.db, "no-such-project", T0)).toBeNull();
  });

  test("a tombstoned project is not readable", async () => {
    const created = await seed("https://chickpea.co", [], "key-a-0006");
    await testDb.db
      .update(schema.projects)
      .set({ deletedAt: T0 + 1 })
      .where(eq(schema.projects.id, created.projectId));
    expect(await readProjectHierarchy(testDb.db, created.publicId, T0 + 5)).toBeNull();
    expect(await listProjectHierarchies(testDb.db, T0 + 5)).toEqual([]);
  });
});
