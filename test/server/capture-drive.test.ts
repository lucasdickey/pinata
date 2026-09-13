// Server-driven capture (D076): driveCapture runs one attempt to a terminal
// row and schedules the project's next attempt; driveProject schedules at
// most the durable lease cap; a full lease table defers without touching the
// attempt; a retryable failure earns exactly one automatic retry and never a
// second; a non-retryable failure earns none; and the project-wide attempt
// cap still holds. Every case runs against the committed migrations on an
// in-memory database with the provider doubles.

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  MAX_ACTIVE_CAPTURES,
  MAX_AUTOMATIC_CAPTURE_RETRIES,
  MAX_CAPTURE_ATTEMPTS_PER_PROJECT,
} from "../../src/lib/boundaries";
import {
  automaticRetryKey,
  driveCapture,
  driveProject,
  scheduleAutomaticRetry,
  type CaptureDriveDeps,
} from "../../src/lib/server/captures/drive";
import {
  claimCaptureLease,
  countActiveCaptureLeases,
} from "../../src/lib/server/captures/leases";
import { schema } from "../../src/lib/server/db/client";
import {
  echoClient,
  failureEnvelope,
  recordingClient,
  recordingStore,
  type RecordingClient,
} from "./capture-provider-fakes";
import {
  allCaptures,
  attemptsFor,
  inlineScheduler,
  resolverFor,
  safeAdmission,
  seedProject,
  T0,
  type InlineScheduler,
} from "./capture-drive-helpers";
import { createTestDb, type TestDb } from "./test-db";

let testDb: TestDb;
let scheduler: InlineScheduler;
let provider: RecordingClient;
let clock: number;

const tick = () => (clock += 1_000);

function deps(overrides: Partial<CaptureDriveDeps> = {}): CaptureDriveDeps {
  return {
    admission: safeAdmission(),
    execution: { client: provider.client, store: recordingStore().store },
    after: scheduler.after,
    now: tick,
    retry: { now: tick, newId: () => `retry-${String(clock)}` },
    ...overrides,
  };
}

beforeEach(async () => {
  testDb = await createTestDb();
  scheduler = inlineScheduler();
  provider = echoClient();
  clock = T0;
});

afterEach(() => {
  testDb.client.close();
});

describe("driveCapture", () => {
  test("runs one attempt to ready, releases its slot, and schedules the project's next attempt", async () => {
    const project = await seedProject(testDb.db, "https://safe.example", [], "drive-0001");
    const [first] = await attemptsFor(testDb.db, project.pages[0]!.id, "desktop");

    const result = await driveCapture(testDb.db, first!.id, deps());
    expect(result.ok).toBe(true);

    const [row] = await attemptsFor(testDb.db, project.pages[0]!.id, "desktop");
    expect(row!.status).toBe("ready");
    expect(row!.startedAt).not.toBeNull();
    expect(row!.finishedAt).toBeGreaterThan(row!.startedAt!);
    expect(await countActiveCaptureLeases(testDb.db, clock)).toBe(0);

    // The continuation was handed over but has not run: the mobile sibling
    // is still pending until the scheduler runs the task.
    expect(scheduler.queue).toHaveLength(1);
    const [mobile] = await attemptsFor(testDb.db, project.pages[0]!.id, "mobile");
    expect(mobile!.status).toBe("pending");

    await scheduler.step();
    // driveProject scheduled the sibling; running it captures it.
    await scheduler.step();
    const [mobileAfter] = await attemptsFor(testDb.db, project.pages[0]!.id, "mobile");
    expect(mobileAfter!.status).toBe("ready");
  });

  test("a project chains to completion with no further caller", async () => {
    const project = await seedProject(
      testDb.db,
      "https://safe.example",
      ["https://safe.example/two", "https://safe.example/three"],
      "drive-0002",
    );
    const [first] = await attemptsFor(testDb.db, project.pages[0]!.id, "desktop");
    await driveCapture(testDb.db, first!.id, deps());
    await scheduler.flush();

    const rows = await allCaptures(testDb.db);
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.status === "ready")).toBe(true);
    expect(provider.requests).toHaveLength(6);
    expect(await countActiveCaptureLeases(testDb.db, clock)).toBe(0);
    // Once nothing is pending, the last continuation schedules nothing.
    expect(scheduler.queue).toHaveLength(0);
  });

  test("a full lease table defers: the attempt stays pending and nothing is scheduled", async () => {
    const project = await seedProject(testDb.db, "https://safe.example", [], "drive-0003");
    for (let slot = 0; slot < MAX_ACTIVE_CAPTURES; slot += 1) {
      const held = await claimCaptureLease(testDb.db, `foreign-${slot}`, clock);
      expect(held.ok).toBe(true);
    }
    const [first] = await attemptsFor(testDb.db, project.pages[0]!.id, "desktop");

    const result = await driveCapture(testDb.db, first!.id, deps());
    expect(result).toEqual({ ok: false, error: "quota" });
    const [row] = await attemptsFor(testDb.db, project.pages[0]!.id, "desktop");
    expect(row!.status).toBe("pending");
    expect(provider.requests).toHaveLength(0);
    expect(scheduler.scheduled).toBe(0);
  });

  test("an unknown or already claimed attempt is reported without a provider call", async () => {
    const project = await seedProject(testDb.db, "https://safe.example", [], "drive-0004");
    expect(await driveCapture(testDb.db, "no-such-attempt", deps())).toEqual({
      ok: false,
      error: "not-found",
    });
    const [first] = await attemptsFor(testDb.db, project.pages[0]!.id, "desktop");
    await testDb.db
      .update(schema.captures)
      .set({ status: "capturing" })
      .where(eq(schema.captures.id, first!.id));
    expect(await driveCapture(testDb.db, first!.id, deps())).toEqual({
      ok: false,
      error: "not-dispatchable",
    });
    expect(provider.requests).toHaveLength(0);
  });
});

describe("driveProject", () => {
  test("schedules at most the durable lease cap, in hierarchy order", async () => {
    const project = await seedProject(
      testDb.db,
      "https://safe.example",
      ["https://safe.example/two"],
      "drive-0005",
    );
    const driven = await driveProject(testDb.db, project.projectId, deps());
    expect(driven.scheduled).toHaveLength(MAX_ACTIVE_CAPTURES);
    const rootDesktop = (await attemptsFor(testDb.db, project.pages[0]!.id, "desktop"))[0]!;
    const rootMobile = (await attemptsFor(testDb.db, project.pages[0]!.id, "mobile"))[0]!;
    expect(driven.scheduled).toEqual([rootDesktop.id, rootMobile.id]);
    expect(scheduler.queue).toHaveLength(MAX_ACTIVE_CAPTURES);
  });

  test("schedules nothing for a project with no pending attempt", async () => {
    const project = await seedProject(testDb.db, "https://safe.example", [], "drive-0006");
    const [first] = await attemptsFor(testDb.db, project.pages[0]!.id, "desktop");
    await driveCapture(testDb.db, first!.id, deps());
    await scheduler.flush();
    const driven = await driveProject(testDb.db, project.projectId, deps());
    expect(driven.scheduled).toEqual([]);
  });
});

describe("automatic retry", () => {
  test("a retryable catalog failure earns exactly one automatic attempt, never a second", async () => {
    provider = recordingClient(failureEnvelope("navigation-timeout"));
    const project = await seedProject(testDb.db, "https://safe.example", [], "drive-0007");
    const page = project.pages[0]!;
    const [first] = await attemptsFor(testDb.db, page.id, "desktop");

    const result = await driveCapture(testDb.db, first!.id, deps());
    expect(result).toEqual({ ok: false, outcome: "navigation-timeout" });

    const afterFirst = await attemptsFor(testDb.db, page.id, "desktop");
    expect(afterFirst.map((row) => [row.attempt, row.status, row.origin])).toEqual([
      [1, "failed", "manual"],
      [2, "pending", "automatic"],
    ]);
    expect(afterFirst[1]!.idempotencyKey).toBe(`retry:${automaticRetryKey(first!.id)}`);

    // Drain every continuation: the automatic attempt runs and fails too,
    // and the mobile sibling goes through the same two-attempt story.
    await scheduler.flush();
    const desktop = await attemptsFor(testDb.db, page.id, "desktop");
    const mobile = await attemptsFor(testDb.db, page.id, "mobile");
    expect(desktop.map((row) => [row.status, row.origin])).toEqual([
      ["failed", "manual"],
      ["failed", "automatic"],
    ]);
    expect(mobile.map((row) => [row.status, row.origin])).toEqual([
      ["failed", "manual"],
      ["failed", "automatic"],
    ]);
    expect(provider.requests).toHaveLength(2 * (1 + MAX_AUTOMATIC_CAPTURE_RETRIES));
    expect(scheduler.queue).toHaveLength(0);
  });

  test("a non-retryable catalog failure earns no automatic attempt", async () => {
    provider = recordingClient(failureEnvelope("document-too-tall"));
    const project = await seedProject(testDb.db, "https://safe.example", [], "drive-0008");
    const page = project.pages[0]!;
    const [first] = await attemptsFor(testDb.db, page.id, "desktop");
    await driveCapture(testDb.db, first!.id, deps());
    await scheduler.flush();
    const desktop = await attemptsFor(testDb.db, page.id, "desktop");
    expect(desktop.map((row) => [row.status, row.errorCode])).toEqual([
      ["failed", "document-too-tall"],
    ]);
  });

  test("an admission rejection is a finalization too: one automatic attempt, then it stops", async () => {
    const project = await seedProject(testDb.db, "https://unknown.example", [], "drive-0009");
    const page = project.pages[0]!;
    const [first] = await attemptsFor(testDb.db, page.id, "desktop");
    const result = await driveCapture(
      testDb.db,
      first!.id,
      deps({ admission: { resolver: resolverFor({}), dnsTimeoutMs: 50 } }),
    );
    expect(result).toEqual({ ok: false, outcome: "dns-failed" });
    await scheduler.flush();
    const desktop = await attemptsFor(testDb.db, page.id, "desktop");
    expect(desktop.map((row) => [row.status, row.origin, row.errorCode])).toEqual([
      ["failed", "manual", "dns-failed"],
      ["failed", "automatic", "dns-failed"],
    ]);
    expect(provider.requests).toHaveLength(0);
  });

  test("scheduleAutomaticRetry replays rather than creating a second row", async () => {
    provider = recordingClient(failureEnvelope("total-timeout"));
    const project = await seedProject(testDb.db, "https://safe.example", [], "drive-0010");
    const page = project.pages[0]!;
    const [first] = await attemptsFor(testDb.db, page.id, "desktop");
    await driveCapture(testDb.db, first!.id, deps());
    const again = await scheduleAutomaticRetry(testDb.db, first!.id, { now: tick });
    expect(again).toEqual({ projectId: project.projectId, created: false });
    expect(await attemptsFor(testDb.db, page.id, "desktop")).toHaveLength(2);
  });

  test("a ready attempt is never retried automatically", async () => {
    const project = await seedProject(testDb.db, "https://safe.example", [], "drive-0011");
    const page = project.pages[0]!;
    const [first] = await attemptsFor(testDb.db, page.id, "desktop");
    await driveCapture(testDb.db, first!.id, deps());
    const result = await scheduleAutomaticRetry(testDb.db, first!.id, { now: tick });
    expect(result.created).toBe(false);
    expect(await attemptsFor(testDb.db, page.id, "desktop")).toHaveLength(1);
  });

  test("the project-wide attempt cap is respected", async () => {
    provider = recordingClient(failureEnvelope("navigation-timeout"));
    const project = await seedProject(testDb.db, "https://safe.example", [], "drive-0012");
    const page = project.pages[0]!;
    // Fill the project's attempt budget with terminal history rows.
    const existing = await allCaptures(testDb.db);
    const filler = MAX_CAPTURE_ATTEMPTS_PER_PROJECT - existing.length;
    await testDb.db.insert(schema.captures).values(
      Array.from({ length: filler }, (_, index) => ({
        id: `filler-${index}`,
        pageId: page.id,
        variant: "mobile",
        attempt: 100 + index,
        status: "failed",
        idempotencyKey: `filler:${index}`,
        origin: "manual",
        requestedUrl: page.normalizedUrl,
        viewportWidth: 390,
        viewportHeight: 844,
        deviceScaleFactor: 1,
        createdAt: T0,
        updatedAt: T0,
      })),
    );
    const [first] = await attemptsFor(testDb.db, page.id, "desktop");
    const result = await driveCapture(testDb.db, first!.id, deps());
    expect(result).toEqual({ ok: false, outcome: "navigation-timeout" });
    expect(await attemptsFor(testDb.db, page.id, "desktop")).toHaveLength(1);
    expect(await allCaptures(testDb.db)).toHaveLength(MAX_CAPTURE_ATTEMPTS_PER_PROJECT);
  });
});
