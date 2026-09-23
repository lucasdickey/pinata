// The invocation budget and the handoff to a fresh invocation (D095).
//
// Every continuation runs inside the invocation that started it, and that
// invocation dies at its maxDuration. The drive therefore checks, before it
// starts another capture, that a whole capture still fits; when it does not,
// it hands the chain to the app's own sweep route, which re-drives pending
// work under a fresh maxDuration. These tests pin the budget to the routes'
// literal maxDuration, prove the handoff happens once and only when it is
// needed, prove the fallback when no handoff is configured, and prove that
// the request the handoff sends is one the sweep route accepts and acts on.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { maxDuration as dispatchMaxDuration } from "../../app/api/captures/[captureId]/dispatch/route";
import { POST as sweepPOST, maxDuration as sweepMaxDuration } from "../../app/api/captures/sweep/route";
import { maxDuration as retryMaxDuration } from "../../app/api/pages/[pageId]/captures/route";
import { maxDuration as projectsMaxDuration } from "../../app/api/projects/route";
import {
  CAPTURE_CONTINUATION_MARGIN_MS,
  CAPTURE_INVOCATION_MAX_DURATION_MS,
  TOTAL_CAPTURE_TIMEOUT_MS,
} from "../../src/lib/boundaries";
import {
  __setContinuationSchedulerForTests,
  createSweepHandoff,
  PROTECTION_BYPASS_HEADER,
} from "../../src/lib/server/captures/continuation";
import {
  __setAdmissionDepsForTests,
  __setCaptureExecutionDepsForTests,
  __setCaptureHandoffForTests,
  getCaptureDriveDeps,
} from "../../src/lib/server/captures/deps";
import {
  driveCapture,
  invocationHasCaptureBudget,
  type CaptureDriveDeps,
} from "../../src/lib/server/captures/drive";
import { SWEEP_SECRET_HEADER } from "../../src/lib/server/captures/sweep-auth";
import { __resetDatabaseCacheForTests, __setDatabaseForTests } from "../../src/lib/server/db/client";
import { echoClient, recordingStore, type RecordingClient } from "./capture-provider-fakes";
import {
  allCaptures,
  attemptsFor,
  inlineScheduler,
  safeAdmission,
  seedProject,
  T0,
  type InlineScheduler,
} from "./capture-drive-helpers";
import { createTestDb, type TestDb } from "./test-db";

/** The last instant at which another capture may still start. */
const LAST_START = CAPTURE_INVOCATION_MAX_DURATION_MS - TOTAL_CAPTURE_TIMEOUT_MS - CAPTURE_CONTINUATION_MARGIN_MS;

let testDb: TestDb;
let scheduler: InlineScheduler;
let provider: RecordingClient;
let clock: number;
let handoffs: number;

function deps(overrides: Partial<CaptureDriveDeps> = {}): CaptureDriveDeps {
  return {
    admission: safeAdmission(),
    execution: { client: provider.client, store: recordingStore().store },
    after: scheduler.after,
    now: () => clock,
    retry: { now: () => clock, newId: () => `retry-${String(clock)}` },
    invocation: { startedAt: T0 },
    handoff: async () => {
      handoffs += 1;
      return true;
    },
    ...overrides,
  };
}

beforeEach(async () => {
  testDb = await createTestDb();
  scheduler = inlineScheduler();
  provider = echoClient();
  clock = T0;
  handoffs = 0;
});

afterEach(() => {
  testDb.client.close();
});

describe("the budget matches the routes", () => {
  test("every capture-running route's literal maxDuration is the published invocation limit", () => {
    for (const value of [
      dispatchMaxDuration,
      sweepMaxDuration,
      retryMaxDuration,
      projectsMaxDuration,
    ]) {
      expect(value * 1_000).toBe(CAPTURE_INVOCATION_MAX_DURATION_MS);
    }
  });

  test("no other route runs captures without the same limit", () => {
    // Any route that drives capture must export the same literal; the four
    // above are all of them today.
    const routes = [
      "app/api/captures/[captureId]/dispatch/route.ts",
      "app/api/captures/sweep/route.ts",
      "app/api/pages/[pageId]/captures/route.ts",
      "app/api/projects/route.ts",
    ];
    for (const path of routes) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source, path).toContain(`export const maxDuration = ${CAPTURE_INVOCATION_MAX_DURATION_MS / 1_000};`);
    }
  });

  test("a whole capture fits until the last start instant, and not a millisecond later", () => {
    const at = (elapsed: number) =>
      invocationHasCaptureBudget({ invocation: { startedAt: T0 }, now: () => T0 + elapsed });
    expect(at(0)).toBe(true);
    expect(at(LAST_START)).toBe(true);
    expect(at(LAST_START + 1)).toBe(false);
    // No invocation recorded means no budget applies.
    expect(invocationHasCaptureBudget({ now: () => T0 + CAPTURE_INVOCATION_MAX_DURATION_MS })).toBe(
      true,
    );
  });
});

describe("the drive near the end of its invocation", () => {
  test("within budget, the chain continues in this invocation and nothing hands off", async () => {
    const project = await seedProject(testDb.db, "https://safe.example", [], "budget-0001");
    const [first] = await attemptsFor(testDb.db, project.pages[0]!.id, "desktop");
    await driveCapture(testDb.db, first!.id, deps());
    await scheduler.flush();
    expect((await allCaptures(testDb.db)).every((row) => row.status === "ready")).toBe(true);
    expect(handoffs).toBe(0);
  });

  test("past the last start, the finalized attempt hands the chain off instead of starting another", async () => {
    const project = await seedProject(
      testDb.db,
      "https://safe.example",
      ["https://safe.example/two"],
      "budget-0002",
    );
    const page = project.pages[0]!;
    const [desktop] = await attemptsFor(testDb.db, page.id, "desktop");
    const [mobile] = await attemptsFor(testDb.db, page.id, "mobile");
    clock = T0 + LAST_START + 1;
    // Two captures that were already running finish now; one handoff covers both.
    const shared = deps();
    await driveCapture(testDb.db, desktop!.id, shared);
    await driveCapture(testDb.db, mobile!.id, shared);
    await scheduler.flush();

    expect(handoffs).toBe(1);
    expect(provider.requests).toHaveLength(2);
    const rows = await allCaptures(testDb.db);
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(2);
  });

  test("with nothing pending, running out of budget hands nothing off", async () => {
    const project = await seedProject(testDb.db, "https://safe.example", [], "budget-0003");
    const page = project.pages[0]!;
    const [desktop] = await attemptsFor(testDb.db, page.id, "desktop");
    const [mobile] = await attemptsFor(testDb.db, page.id, "mobile");
    await driveCapture(testDb.db, desktop!.id, deps());
    scheduler.queue.splice(0);
    clock = T0 + LAST_START + 1;
    await driveCapture(testDb.db, mobile!.id, deps());
    await scheduler.flush();
    expect(handoffs).toBe(0);
  });

  test("without a handoff configured, the chain keeps today's behavior and continues here", async () => {
    const project = await seedProject(
      testDb.db,
      "https://safe.example",
      ["https://safe.example/two"],
      "budget-0004",
    );
    const [first] = await attemptsFor(testDb.db, project.pages[0]!.id, "desktop");
    clock = T0 + LAST_START + 1;
    await driveCapture(testDb.db, first!.id, deps({ handoff: undefined }));
    await scheduler.flush();
    expect((await allCaptures(testDb.db)).every((row) => row.status === "ready")).toBe(true);
  });

  test("a failing handoff never throws into the drive", async () => {
    const project = await seedProject(
      testDb.db,
      "https://safe.example",
      ["https://safe.example/two"],
      "budget-0005",
    );
    const [first] = await attemptsFor(testDb.db, project.pages[0]!.id, "desktop");
    clock = T0 + LAST_START + 1;
    const result = await driveCapture(
      testDb.db,
      first!.id,
      deps({ handoff: () => Promise.reject(new Error("network down")) }),
    );
    expect(result.ok).toBe(true);
    await expect(scheduler.flush()).resolves.toBeUndefined();
  });
});

describe("createSweepHandoff", () => {
  const recorded: { url: string; init: RequestInit }[] = [];
  const okFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    recorded.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  beforeEach(() => {
    recorded.length = 0;
  });

  test("is absent without a deployment origin or a sweep secret", () => {
    expect(createSweepHandoff({ CRON_SECRET: "c" }, okFetch)).toBeNull();
    expect(createSweepHandoff({ VERCEL_URL: "app-abc.vercel.app" }, okFetch)).toBeNull();
    expect(createSweepHandoff({}, okFetch)).toBeNull();
  });

  test("posts this deployment's sweep route with the sweep secret and the protection bypass", async () => {
    const handoff = createSweepHandoff(
      {
        VERCEL_URL: "app-abc.vercel.app",
        CAPTURE_SWEEP_SECRET: "sweep-secret",
        CRON_SECRET: "cron-secret",
        VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-secret",
      },
      okFetch,
    );
    expect(await handoff!()).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.url).toBe("https://app-abc.vercel.app/api/captures/sweep");
    expect(recorded[0]!.init.method).toBe("POST");
    expect(recorded[0]!.init.headers).toEqual({
      [SWEEP_SECRET_HEADER]: "sweep-secret",
      [PROTECTION_BYPASS_HEADER]: "bypass-secret",
    });
  });

  test("falls back to the cron bearer, and answers false instead of throwing", async () => {
    const handoff = createSweepHandoff({ VERCEL_URL: "app-abc.vercel.app", CRON_SECRET: "c" }, okFetch);
    await handoff!();
    expect(recorded[0]!.init.headers).toEqual({ authorization: "Bearer c" });

    const failing = createSweepHandoff(
      { VERCEL_URL: "app-abc.vercel.app", CRON_SECRET: "c" },
      (() => Promise.reject(new Error("reset"))) as typeof fetch,
    );
    expect(await failing!()).toBe(false);
    const refused = createSweepHandoff(
      { VERCEL_URL: "app-abc.vercel.app", CRON_SECRET: "c" },
      (async () => new Response(null, { status: 401 })) as typeof fetch,
    );
    expect(await refused!()).toBe(false);
  });
});

describe("the sweep route, called by the handoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    __setDatabaseForTests(testDb.db);
    __setContinuationSchedulerForTests(scheduler.after);
    __setAdmissionDepsForTests(safeAdmission());
    __setCaptureExecutionDepsForTests({ client: provider.client, store: recordingStore().store });
  });

  afterEach(() => {
    __setContinuationSchedulerForTests(null);
    __setAdmissionDepsForTests(null);
    __setCaptureExecutionDepsForTests(null);
    __setCaptureHandoffForTests(undefined);
    __resetDatabaseCacheForTests();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  test.each([
    ["the sweep secret", { CAPTURE_SWEEP_SECRET: "sweep-secret" }],
    ["the cron bearer", { CRON_SECRET: "cron-secret" }],
  ])("accepts %s and drives the pending work, not only counts it", async (_label, secrets) => {
    for (const [name, value] of Object.entries(secrets)) vi.stubEnv(name, value);
    await seedProject(testDb.db, "https://safe.example", [], `budget-sweep-${_label}`);
    const handoff = createSweepHandoff(
      { VERCEL_URL: "app-abc.vercel.app", ...secrets },
      ((url: string | URL | Request, init?: RequestInit) =>
        sweepPOST(new Request(String(url), init))) as typeof fetch,
    );
    expect(await handoff!()).toBe(true);
    // The sweep scheduled the project's pending attempts in its own
    // invocation; running them captures them.
    expect(scheduler.scheduled).toBeGreaterThan(0);
    await scheduler.flush();
    expect((await allCaptures(testDb.db)).every((row) => row.status === "ready")).toBe(true);
  });

  test("route deps start a fresh budget per request and carry the configured handoff", () => {
    const handoff = async () => true;
    __setCaptureHandoffForTests(handoff);
    const drive = getCaptureDriveDeps();
    expect(drive.invocation).toEqual({ startedAt: T0 });
    expect(drive.handoff).toBe(handoff);
    __setCaptureHandoffForTests(null);
    expect(getCaptureDriveDeps().handoff).toBeUndefined();
  });
});
