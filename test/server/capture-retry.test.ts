// Scoped, idempotent capture retry and late-result fencing
// (VAL-PROJECT-005, VAL-CAPTURE-008). Every case runs against the committed
// migrations on an in-memory libSQL database; real Turso proof lives in
// test/integration/hierarchy.integration.test.ts.

import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MAX_CAPTURE_ATTEMPTS_PER_PROJECT, STALE_CAPTURE_AGE_MS } from "../../src/lib/boundaries";
import { applyCaptureTransition } from "../../src/lib/server/captures/transitions";
import { retryCapture } from "../../src/lib/server/captures/retry";
import { summarizeVariant } from "../../src/lib/server/captures/status";
import { schema } from "../../src/lib/server/db/client";
import { createProjectAtomically } from "../../src/lib/server/projects/create";
import { validateProjectSubmission } from "../../src/lib/server/projects/submission";
import { createTestDb, type TestDb } from "./test-db";

const T0 = 1_800_000_000_000;

let testDb: TestDb;
let pageIds: string[];

let counter = 0;
const newId = () => `id-${String(++counter).padStart(4, "0")}`;
const deps = { now: () => T0, newId, newPublicId: () => `pub-${String(counter)}` };
const retryDeps = (now: number) => ({ now: () => now, newId });

async function seedProject(): Promise<string[]> {
  const submission = validateProjectSubmission({
    rootUrl: "https://chickpea.co",
    urls: ["https://chickpea.co/pricing"],
  });
  if (!submission.ok) throw new Error("fixture submission must be valid");
  const result = await createProjectAtomically(testDb.db, submission, "seed-key-0001", deps);
  if (!result.ok) throw new Error("fixture project must be created");
  return result.project.pages.map((page) => page.id);
}

async function attemptsFor(pageId: string, variant: string) {
  return testDb.db
    .select()
    .from(schema.captures)
    .where(and(eq(schema.captures.pageId, pageId), eq(schema.captures.variant, variant)))
    .orderBy(asc(schema.captures.attempt));
}

/** Drive an attempt to a terminal state so a retry is legal. */
async function markFailed(captureId: string, errorCode = "total-timeout") {
  await applyCaptureTransition(testDb.db, {
    captureId,
    from: "pending",
    to: "failed",
    errorCode,
    errorMessage: "The capture exceeded its total time budget.",
    now: T0,
  });
}

beforeEach(async () => {
  counter = 0;
  testDb = await createTestDb();
  pageIds = await seedProject();
});

afterEach(() => {
  testDb.client.close();
});

describe("applyCaptureTransition", () => {
  test("walks pending → capturing → ready and stamps the result", async () => {
    const [attempt1] = await attemptsFor(pageIds[0]!, "desktop");
    expect(
      await applyCaptureTransition(testDb.db, {
        captureId: attempt1!.id,
        from: "pending",
        to: "capturing",
        now: T0 + 1,
      }),
    ).toBe("applied");
    expect(
      await applyCaptureTransition(testDb.db, {
        captureId: attempt1!.id,
        from: "capturing",
        to: "ready",
        imageHash: "hash-a",
        blobPath: "captures/a.webp",
        now: T0 + 2,
      }),
    ).toBe("applied");
    const [row] = await attemptsFor(pageIds[0]!, "desktop");
    expect(row!.status).toBe("ready");
    expect(row!.imageHash).toBe("hash-a");
    expect(row!.capturedAt).toBe(T0 + 2);
  });

  test("a transition from the wrong expected state is fenced and writes nothing", async () => {
    const [attempt1] = await attemptsFor(pageIds[0]!, "desktop");
    await markFailed(attempt1!.id);
    expect(
      await applyCaptureTransition(testDb.db, {
        captureId: attempt1!.id,
        from: "capturing",
        to: "ready",
        imageHash: "late-hash",
        blobPath: "captures/late.webp",
        now: T0 + 10,
      }),
    ).toBe("fenced");
    const [row] = await attemptsFor(pageIds[0]!, "desktop");
    expect(row!.status).toBe("failed");
    expect(row!.imageHash).toBeNull();
  });

  test("a terminal attempt can never be rewritten", async () => {
    const [attempt1] = await attemptsFor(pageIds[0]!, "desktop");
    await applyCaptureTransition(testDb.db, {
      captureId: attempt1!.id,
      from: "pending",
      to: "ready",
      imageHash: "hash-a",
      blobPath: "captures/a.webp",
      now: T0 + 1,
    });
    for (const from of ["pending", "capturing", "ready"] as const) {
      expect(
        await applyCaptureTransition(testDb.db, {
          captureId: attempt1!.id,
          from,
          to: "failed",
          errorCode: "total-timeout",
          now: T0 + 5,
        }),
      ).toBe("fenced");
    }
    const [row] = await attemptsFor(pageIds[0]!, "desktop");
    expect(row!.status).toBe("ready");
    expect(row!.imageHash).toBe("hash-a");
  });
});

describe("retryCapture", () => {
  test("creates the next attempt for exactly one page and variant", async () => {
    const [attempt1] = await attemptsFor(pageIds[0]!, "desktop");
    await markFailed(attempt1!.id);

    const result = await retryCapture(
      testDb.db,
      { pageId: pageIds[0]!, variant: "desktop", idempotencyKey: "retry-key-0001" },
      retryDeps(T0 + 100),
    );
    expect(result).toMatchObject({ ok: true, created: true });
    if (!result.ok) throw new Error("unreachable");
    expect(result.attempt.attempt).toBe(2);
    expect(result.attempt.status).toBe("pending");

    const desktop = await attemptsFor(pageIds[0]!, "desktop");
    expect(desktop.map((row) => row.attempt)).toEqual([1, 2]);
    // The failed sibling row is history, untouched by its successor.
    expect(desktop[0]!.status).toBe("failed");
    // The mobile variant and the other page were not resubmitted.
    expect(await attemptsFor(pageIds[0]!, "mobile")).toHaveLength(1);
    expect(await attemptsFor(pageIds[1]!, "desktop")).toHaveLength(1);
  });

  test("a ready sibling stays ready and selected until the new attempt commits", async () => {
    const [mobile1] = await attemptsFor(pageIds[0]!, "mobile");
    await applyCaptureTransition(testDb.db, {
      captureId: mobile1!.id,
      from: "pending",
      to: "ready",
      imageHash: "hash-mobile-1",
      blobPath: "captures/m1.webp",
      now: T0 + 1,
    });
    await retryCapture(
      testDb.db,
      { pageId: pageIds[0]!, variant: "mobile", idempotencyKey: "retry-key-0002" },
      retryDeps(T0 + 100),
    );
    const rows = await attemptsFor(pageIds[0]!, "mobile");
    const summary = summarizeVariant("mobile", rows, T0 + 100);
    expect(summary.latest?.attempt).toBe(2);
    expect(summary.latest?.state).toBe("pending");
    expect(summary.selectedCaptureId).toBe(mobile1!.id);
    expect(summary.usable).toBe(true);
  });

  test("a late old result persists on its own row but never becomes selected", async () => {
    const [desktop1] = await attemptsFor(pageIds[0]!, "desktop");
    await applyCaptureTransition(testDb.db, {
      captureId: desktop1!.id,
      from: "pending",
      to: "capturing",
      now: T0 + 1,
    });
    // Attempt 1 is abandoned; it computes stale, so a retry is offered.
    const retry = await retryCapture(
      testDb.db,
      { pageId: pageIds[0]!, variant: "desktop", idempotencyKey: "retry-key-0003" },
      retryDeps(T0 + STALE_CAPTURE_AGE_MS + 2),
    );
    if (!retry.ok) throw new Error("retry must be allowed for a stale attempt");
    await applyCaptureTransition(testDb.db, {
      captureId: retry.attempt.id,
      from: "pending",
      to: "ready",
      imageHash: "hash-new",
      blobPath: "captures/new.webp",
      now: T0 + STALE_CAPTURE_AGE_MS + 3,
    });
    // Only now does the abandoned attempt 1 report back.
    const late = await applyCaptureTransition(testDb.db, {
      captureId: desktop1!.id,
      from: "capturing",
      to: "ready",
      imageHash: "hash-old",
      blobPath: "captures/old.webp",
      now: T0 + STALE_CAPTURE_AGE_MS + 9,
    });
    expect(late).toBe("applied");

    const summary = summarizeVariant(
      "desktop",
      await attemptsFor(pageIds[0]!, "desktop"),
      T0 + STALE_CAPTURE_AGE_MS + 10,
    );
    expect(summary.selectedCaptureId).toBe(retry.attempt.id);
    expect(summary.attempts.map((a) => a.attempt)).toEqual([2, 1]);
    // Both versions remain addressable; the old one is simply not default.
    expect(summary.attempts[1]!.imageHash).toBe("hash-old");
  });

  test("the same key and target replays the one created attempt", async () => {
    const [attempt1] = await attemptsFor(pageIds[0]!, "desktop");
    await markFailed(attempt1!.id);
    const target = { pageId: pageIds[0]!, variant: "desktop" as const, idempotencyKey: "retry-key-0004" };
    const first = await retryCapture(testDb.db, target, retryDeps(T0 + 100));
    const second = await retryCapture(testDb.db, target, retryDeps(T0 + 200));
    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: false });
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(second.attempt).toEqual(first.attempt);
    expect(await attemptsFor(pageIds[0]!, "desktop")).toHaveLength(2);
  });

  test("the same key against a different target conflicts", async () => {
    const [desktop1] = await attemptsFor(pageIds[0]!, "desktop");
    const [mobile1] = await attemptsFor(pageIds[0]!, "mobile");
    await markFailed(desktop1!.id);
    await markFailed(mobile1!.id);
    await retryCapture(
      testDb.db,
      { pageId: pageIds[0]!, variant: "desktop", idempotencyKey: "retry-key-0005" },
      retryDeps(T0 + 100),
    );
    const conflict = await retryCapture(
      testDb.db,
      { pageId: pageIds[0]!, variant: "mobile", idempotencyKey: "retry-key-0005" },
      retryDeps(T0 + 200),
    );
    expect(conflict).toEqual({ ok: false, error: "conflict" });
    expect(await attemptsFor(pageIds[0]!, "mobile")).toHaveLength(1);
  });

  test.each([
    ["pending", "pending"],
    ["in-flight", "capturing"],
  ])("a %s latest attempt is not retryable", async (_label, status) => {
    if (status === "capturing") {
      const [attempt1] = await attemptsFor(pageIds[0]!, "desktop");
      await applyCaptureTransition(testDb.db, {
        captureId: attempt1!.id,
        from: "pending",
        to: "capturing",
        now: T0 + 1,
      });
    }
    const result = await retryCapture(
      testDb.db,
      { pageId: pageIds[0]!, variant: "desktop", idempotencyKey: "retry-key-0006" },
      retryDeps(T0 + 2),
    );
    expect(result).toEqual({ ok: false, error: "not-retryable" });
    expect(await attemptsFor(pageIds[0]!, "desktop")).toHaveLength(1);
  });

  test("an outcome the catalog marks non-retryable is refused", async () => {
    const [attempt1] = await attemptsFor(pageIds[0]!, "desktop");
    await markFailed(attempt1!.id, "document-too-tall");
    const result = await retryCapture(
      testDb.db,
      { pageId: pageIds[0]!, variant: "desktop", idempotencyKey: "retry-key-0007" },
      retryDeps(T0 + 100),
    );
    expect(result).toEqual({ ok: false, error: "not-retryable" });
    expect(await attemptsFor(pageIds[0]!, "desktop")).toHaveLength(1);
  });

  test("an unknown page is a generic not-found and writes nothing", async () => {
    const result = await retryCapture(
      testDb.db,
      { pageId: "no-such-page", variant: "desktop", idempotencyKey: "retry-key-0008" },
      deps,
    );
    expect(result).toEqual({ ok: false, error: "not-found" });
    expect(await testDb.db.select().from(schema.captures)).toHaveLength(4);
  });

  test("the per-project attempt cap stops unbounded retries", async () => {
    // Fill the project to its published attempt cap, then ask for one more.
    const [desktop1] = await attemptsFor(pageIds[0]!, "desktop");
    let latestId = desktop1!.id;
    let created = 4; // the four initial attempts of the seeded project
    let key = 0;
    while (created < MAX_CAPTURE_ATTEMPTS_PER_PROJECT) {
      await markFailed(latestId);
      const result = await retryCapture(
        testDb.db,
        {
          pageId: pageIds[0]!,
          variant: "desktop",
          idempotencyKey: `cap-key-${String(++key).padStart(4, "0")}`,
        },
        retryDeps(T0 + key),
      );
      if (!result.ok) throw new Error(`retry ${key} must succeed below the cap`);
      latestId = result.attempt.id;
      created += 1;
    }
    await markFailed(latestId);
    const overflow = await retryCapture(
      testDb.db,
      { pageId: pageIds[0]!, variant: "desktop", idempotencyKey: "cap-key-overflow" },
      retryDeps(T0 + 9999),
    );
    expect(overflow).toEqual({ ok: false, error: "quota" });
    expect(await testDb.db.select().from(schema.captures)).toHaveLength(
      MAX_CAPTURE_ATTEMPTS_PER_PROJECT,
    );
  });
});
