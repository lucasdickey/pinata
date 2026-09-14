// The capture sweep (D076): the shared-secret boundary of
// /api/captures/sweep (missing configuration is a 404, a wrong or absent
// secret a 401, the sweep header and the cron bearer both admit), and the
// sweep itself — pending attempts are re-driven, a stale attempt earns its
// one automatic retry and is then driven, and the report carries counts only.

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DELETE as sweepDELETE,
  GET as sweepGET,
  POST as sweepPOST,
  PUT as sweepPUT,
} from "../../app/api/captures/sweep/route";
import { MAX_ACTIVE_CAPTURES, STALE_CAPTURE_AGE_MS } from "../../src/lib/boundaries";
import { __setContinuationSchedulerForTests } from "../../src/lib/server/captures/continuation";
import {
  __setAdmissionDepsForTests,
  __setCaptureExecutionDepsForTests,
} from "../../src/lib/server/captures/deps";
import { sweepCaptures } from "../../src/lib/server/captures/drive";
import { authorizeSweep, SWEEP_SECRET_HEADER } from "../../src/lib/server/captures/sweep-auth";
import { applyCaptureTransition } from "../../src/lib/server/captures/transitions";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
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

const ORIGIN = "http://127.0.0.1:3100";
const SWEEP_SECRET = "sweep-secret-sentinel-value";
const CRON_SECRET = "cron-secret-sentinel-value";

let testDb: TestDb;
let scheduler: InlineScheduler;
let provider: RecordingClient;
let clock: number;

function request(method: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/captures/sweep`, { method, headers });
}

beforeEach(async () => {
  vi.useFakeTimers();
  clock = T0 + STALE_CAPTURE_AGE_MS * 2;
  vi.setSystemTime(clock);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  scheduler = inlineScheduler();
  provider = echoClient();
  __setContinuationSchedulerForTests(scheduler.after);
  __setAdmissionDepsForTests(safeAdmission());
  __setCaptureExecutionDepsForTests({ client: provider.client, store: recordingStore().store });
});

afterEach(() => {
  __setContinuationSchedulerForTests(null);
  __setAdmissionDepsForTests(null);
  __setCaptureExecutionDepsForTests(null);
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("authorizeSweep", () => {
  test("is unconfigured when neither secret is set", () => {
    expect(authorizeSweep(request("POST"), {})).toBe("unconfigured");
    expect(authorizeSweep(request("POST"), { CAPTURE_SWEEP_SECRET: "" })).toBe("unconfigured");
  });

  test("admits the sweep header and the cron bearer, and nothing else", () => {
    const env = { CAPTURE_SWEEP_SECRET: SWEEP_SECRET, CRON_SECRET };
    expect(authorizeSweep(request("POST"), env)).toBe("denied");
    expect(authorizeSweep(request("POST", { [SWEEP_SECRET_HEADER]: "wrong" }), env)).toBe("denied");
    expect(
      authorizeSweep(request("POST", { [SWEEP_SECRET_HEADER]: `${SWEEP_SECRET}x` }), env),
    ).toBe("denied");
    expect(authorizeSweep(request("GET", { authorization: `Bearer ${SWEEP_SECRET}` }), env)).toBe(
      "denied",
    );
    expect(authorizeSweep(request("GET", { authorization: CRON_SECRET }), env)).toBe("denied");
    expect(authorizeSweep(request("POST", { [SWEEP_SECRET_HEADER]: SWEEP_SECRET }), env)).toBe(
      "allowed",
    );
    expect(authorizeSweep(request("GET", { authorization: `Bearer ${CRON_SECRET}` }), env)).toBe(
      "allowed",
    );
  });

  test("a secret configured for one channel does not admit the other", () => {
    expect(
      authorizeSweep(request("GET", { authorization: `Bearer ${SWEEP_SECRET}` }), {
        CAPTURE_SWEEP_SECRET: SWEEP_SECRET,
      }),
    ).toBe("denied");
    expect(
      authorizeSweep(request("POST", { [SWEEP_SECRET_HEADER]: CRON_SECRET }), { CRON_SECRET }),
    ).toBe("denied");
  });
});

describe("/api/captures/sweep boundary", () => {
  test("answers 404 when no secret is configured, even with a matching header", async () => {
    const response = await sweepPOST(request("POST", { [SWEEP_SECRET_HEADER]: SWEEP_SECRET }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Request rejected." });
    expect(scheduler.scheduled).toBe(0);
  });

  test("rejects a wrong or missing secret with a generic 401 and sweeps nothing", async () => {
    vi.stubEnv("CAPTURE_SWEEP_SECRET", SWEEP_SECRET);
    await seedProject(testDb.db, "https://safe.example", [], "sweep-0001");
    const attempts: Record<string, string>[] = [
      {},
      { [SWEEP_SECRET_HEADER]: "not-it" },
      { authorization: "Bearer x" },
    ];
    for (const headers of attempts) {
      const response = await sweepPOST(request("POST", headers));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Authentication required." });
    }
    expect(scheduler.scheduled).toBe(0);
    expect((await allCaptures(testDb.db)).every((row) => row.status === "pending")).toBe(true);
  });

  test("the sweep header and the cron bearer both run the sweep and report counts only", async () => {
    vi.stubEnv("CAPTURE_SWEEP_SECRET", SWEEP_SECRET);
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const project = await seedProject(testDb.db, "https://safe.example", [], "sweep-0002");

    const byHeader = await sweepPOST(request("POST", { [SWEEP_SECRET_HEADER]: SWEEP_SECRET }));
    expect(byHeader.status).toBe(200);
    expect(await byHeader.json()).toEqual({
      sweep: { projects: 1, pending: 2, stale: 0, retried: 0, scheduled: 2 },
    });
    await scheduler.flush();
    expect((await allCaptures(testDb.db)).every((row) => row.status === "ready")).toBe(true);
    expect(project.pages).toHaveLength(1);

    const byCron = await sweepGET(request("GET", { authorization: `Bearer ${CRON_SECRET}` }));
    expect(byCron.status).toBe(200);
    expect(await byCron.json()).toEqual({
      sweep: { projects: 0, pending: 0, stale: 0, retried: 0, scheduled: 0 },
    });
  });

  test("other methods are refused", async () => {
    for (const handler of [sweepPUT, sweepDELETE]) {
      const response = await handler();
      expect(response.status).toBe(405);
    }
  });
});

describe("sweepCaptures", () => {
  const deps = () => ({
    admission: safeAdmission(),
    execution: { client: provider.client, store: recordingStore().store },
    after: scheduler.after,
    now: () => clock,
  });

  test("re-drives pending attempts across projects, bounded per project by the lease cap", async () => {
    await seedProject(testDb.db, "https://safe.example", ["https://safe.example/a"], "sweep-0003");
    await seedProject(testDb.db, "https://safe.example/b", [], "sweep-0004");
    const report = await sweepCaptures(testDb.db, deps());
    expect(report).toEqual({
      projects: 2,
      pending: 6,
      stale: 0,
      retried: 0,
      scheduled: MAX_ACTIVE_CAPTURES * 2,
    });
    await scheduler.flush();
    expect((await allCaptures(testDb.db)).every((row) => row.status === "ready")).toBe(true);
  });

  test("a stale attempt earns one automatic retry, which the sweep then drives; a second sweep adds nothing", async () => {
    const project = await seedProject(testDb.db, "https://safe.example", [], "sweep-0005");
    const page = project.pages[0]!;
    const [desktop, mobile] = [
      (await attemptsFor(testDb.db, page.id, "desktop"))[0]!,
      (await attemptsFor(testDb.db, page.id, "mobile"))[0]!,
    ];
    // Desktop was claimed long ago and never finalized; mobile finished.
    await applyCaptureTransition(testDb.db, {
      captureId: desktop.id,
      from: "pending",
      to: "capturing",
      now: clock - STALE_CAPTURE_AGE_MS - 1,
    });
    await applyCaptureTransition(testDb.db, {
      captureId: mobile.id,
      from: "pending",
      to: "ready",
      now: clock - 1,
    });

    const first = await sweepCaptures(testDb.db, deps());
    expect(first).toEqual({ projects: 1, pending: 0, stale: 1, retried: 1, scheduled: 1 });
    await scheduler.flush();

    const rows = await attemptsFor(testDb.db, page.id, "desktop");
    expect(rows.map((row) => [row.attempt, row.status, row.origin])).toEqual([
      [1, "capturing", "manual"],
      [2, "ready", "automatic"],
    ]);

    // The stale row is still there (immutable history), but its variant now
    // has a newer attempt, so no further automatic retry is created.
    const second = await sweepCaptures(testDb.db, deps());
    expect(second).toEqual({ projects: 1, pending: 0, stale: 1, retried: 0, scheduled: 0 });
    expect(await attemptsFor(testDb.db, page.id, "desktop")).toHaveLength(2);
  });

  test("a stale automatic attempt is not retried again", async () => {
    const project = await seedProject(testDb.db, "https://safe.example", [], "sweep-0006");
    const page = project.pages[0]!;
    const [desktop] = await attemptsFor(testDb.db, page.id, "desktop");
    await testDb.db
      .update(schema.captures)
      .set({ origin: "automatic" })
      .where(eq(schema.captures.id, desktop!.id));
    await applyCaptureTransition(testDb.db, {
      captureId: desktop!.id,
      from: "pending",
      to: "capturing",
      now: clock - STALE_CAPTURE_AGE_MS - 1,
    });
    const report = await sweepCaptures(testDb.db, deps());
    expect(report.stale).toBe(1);
    expect(report.retried).toBe(0);
    expect(await attemptsFor(testDb.db, page.id, "desktop")).toHaveLength(1);
  });

  test("a capturing attempt inside the stale age is left alone", async () => {
    const project = await seedProject(testDb.db, "https://safe.example", [], "sweep-0007");
    const page = project.pages[0]!;
    const [desktop] = await attemptsFor(testDb.db, page.id, "desktop");
    await applyCaptureTransition(testDb.db, {
      captureId: desktop!.id,
      from: "pending",
      to: "capturing",
      now: clock - 1,
    });
    const report = await sweepCaptures(testDb.db, deps());
    expect(report.stale).toBe(0);
    expect(report.retried).toBe(0);
    expect(await attemptsFor(testDb.db, page.id, "desktop")).toHaveLength(1);
  });
});
