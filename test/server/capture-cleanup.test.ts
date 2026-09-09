// Bounded orphan cleanup state (VAL-CAPTURE-009).
//
// When a lost finalization cannot delete the object it just wrote, the known
// orphan must be tracked so it is retried and never silently dropped — and
// that tracking is itself bounded. These tests drive the reconcile pass over
// deterministic store outcomes and a fake clock.

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CAPTURE_CLEANUP_WINDOW_MS } from "../../src/lib/boundaries";
import {
  reconcileCaptureCleanups,
  recordOrphanCleanup,
} from "../../src/lib/server/captures/cleanup";
import { schema } from "../../src/lib/server/db/client";
import type { ScreenshotStore } from "../../src/lib/server/providers/blob";
import { createTestDb, type TestDb } from "./test-db";

const T0 = 1_800_000_000_000;

let testDb: TestDb;

function storeReturning(del: (pathname: string) => Promise<{ ok: true; value: null } | { ok: false; error: "unavailable" | "not-found" }>): { store: ScreenshotStore; deletes: string[] } {
  const deletes: string[] = [];
  return {
    deletes,
    store: {
      put: async () => ({ ok: false as const, error: "unavailable" as const }),
      head: async () => ({ ok: false as const, error: "not-found" as const }),
      get: async () => ({ ok: false as const, error: "not-found" as const }),
      del: async (pathname: string) => {
        deletes.push(pathname);
        return del(pathname);
      },
    },
  };
}

async function cleanupRow(blobPath: string) {
  const rows = await testDb.db
    .select()
    .from(schema.captureCleanups)
    .where(eq(schema.captureCleanups.blobPath, blobPath));
  return rows[0] ?? null;
}

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(() => {
  testDb.client.close();
});

describe("recordOrphanCleanup", () => {
  test("records one bounded row for a known orphan", async () => {
    await recordOrphanCleanup(
      testDb.db,
      { blobPath: "captures/p/c-abc.png", captureId: "c" },
      T0,
    );
    const row = await cleanupRow("captures/p/c-abc.png");
    expect(row).toMatchObject({
      blobPath: "captures/p/c-abc.png",
      captureId: "c",
      attempts: 0,
      lastError: "orphan-delete-failed",
      createdAt: T0,
    });
    expect(row!.deadlineAt).toBe(T0 + CAPTURE_CLEANUP_WINDOW_MS);
  });

  test("re-recording the same orphan refreshes rather than duplicating", async () => {
    await recordOrphanCleanup(testDb.db, { blobPath: "captures/p/c.png", captureId: "c" }, T0);
    await recordOrphanCleanup(
      testDb.db,
      { blobPath: "captures/p/c.png", captureId: "c" },
      T0 + 1_000,
    );
    const rows = await testDb.db.select().from(schema.captureCleanups);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deadlineAt).toBe(T0 + 1_000 + CAPTURE_CLEANUP_WINDOW_MS);
  });
});

describe("reconcileCaptureCleanups", () => {
  test("deletes a pending orphan and removes its row once the object is gone", async () => {
    await recordOrphanCleanup(testDb.db, { blobPath: "captures/p/a.png", captureId: "a" }, T0);
    const { store, deletes } = storeReturning(async () => ({ ok: true, value: null }));
    const result = await reconcileCaptureCleanups(testDb.db, store, T0 + 1_000);
    expect(result).toEqual({ deleted: 1, pending: 0 });
    expect(deletes).toEqual(["captures/p/a.png"]);
    expect(await cleanupRow("captures/p/a.png")).toBeNull();
  });

  test("an already-absent object completes cleanup without error", async () => {
    await recordOrphanCleanup(testDb.db, { blobPath: "captures/p/b.png", captureId: "b" }, T0);
    const { store } = storeReturning(async () => ({ ok: false, error: "not-found" }));
    const result = await reconcileCaptureCleanups(testDb.db, store, T0 + 1_000);
    expect(result).toEqual({ deleted: 1, pending: 0 });
    expect(await cleanupRow("captures/p/b.png")).toBeNull();
  });

  test("a failed delete is retried with a bounded attempt count", async () => {
    await recordOrphanCleanup(testDb.db, { blobPath: "captures/p/c.png", captureId: "c" }, T0);
    const { store } = storeReturning(async () => ({ ok: false, error: "unavailable" }));
    const first = await reconcileCaptureCleanups(testDb.db, store, T0 + 1_000);
    expect(first).toEqual({ deleted: 0, pending: 1 });
    expect(await cleanupRow("captures/p/c.png")).toMatchObject({ attempts: 1 });
    const second = await reconcileCaptureCleanups(testDb.db, store, T0 + 2_000);
    expect(second).toEqual({ deleted: 0, pending: 1 });
    expect(await cleanupRow("captures/p/c.png")).toMatchObject({ attempts: 2 });
  });

  test("a past-deadline orphan stops retrying but stays on the books", async () => {
    await recordOrphanCleanup(testDb.db, { blobPath: "captures/p/d.png", captureId: "d" }, T0);
    const { store, deletes } = storeReturning(async () => ({ ok: false, error: "unavailable" }));
    // Past the deadline: still deleted on sight, but the attempt count is not
    // incremented and the row is never silently dropped.
    const result = await reconcileCaptureCleanups(
      testDb.db,
      store,
      T0 + CAPTURE_CLEANUP_WINDOW_MS + 1,
    );
    expect(result).toEqual({ deleted: 0, pending: 1 });
    expect(deletes).toEqual(["captures/p/d.png"]);
    expect(await cleanupRow("captures/p/d.png")).toMatchObject({ attempts: 0 });
  });
});
