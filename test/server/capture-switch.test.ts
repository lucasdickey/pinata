// The local/test switch for server-driven capture (D076):
// PINATA_SERVER_CAPTURE=off makes every continuation inert — project
// creation, the scoped retry, and a finalized dispatch schedule nothing —
// and turns the sweep into a count-only read, while the dispatch route keeps
// working so the client fallback driver behaves exactly as before. Any other
// value, or the variable unset, means on.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as dispatchPOST } from "../../app/api/captures/[captureId]/dispatch/route";
import { POST as sweepPOST } from "../../app/api/captures/sweep/route";
import { POST as retryPOST } from "../../app/api/pages/[pageId]/captures/route";
import { POST as projectsPOST } from "../../app/api/projects/route";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { STALE_CAPTURE_AGE_MS } from "../../src/lib/boundaries";
import { createEditorSession } from "../../src/lib/server/auth/session";
import {
  __setContinuationSchedulerForTests,
  getContinuationScheduler,
  serverCaptureEnabled,
} from "../../src/lib/server/captures/continuation";
import {
  __setAdmissionDepsForTests,
  __setCaptureExecutionDepsForTests,
} from "../../src/lib/server/captures/deps";
import { SWEEP_SECRET_HEADER } from "../../src/lib/server/captures/sweep-auth";
import { applyCaptureTransition } from "../../src/lib/server/captures/transitions";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
} from "../../src/lib/server/db/client";
import { echoClient, recordingStore, type RecordingClient } from "./capture-provider-fakes";
import {
  allCaptures,
  attemptsFor,
  inlineScheduler,
  safeAdmission,
  T0,
  type InlineScheduler,
} from "./capture-drive-helpers";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "capture-switch-session-secret-sentinel";
const SWEEP_SECRET = "capture-switch-sweep-secret";
const ORIGIN = "http://127.0.0.1:3100";

let testDb: TestDb;
let session: { token: string; csrf: string };
let scheduler: InlineScheduler;
let provider: RecordingClient;

function build(path: string, method: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers = new Headers({
    origin: ORIGIN,
    host: "127.0.0.1:3100",
    cookie: `${EDITOR_SESSION_COOKIE}=${session.token}`,
    [EDITOR_CSRF_HEADER]: session.csrf,
    ...extra,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createProject(key: string) {
  const response = await projectsPOST(
    build("/api/projects", "POST", { rootUrl: "https://safe.example", urls: [], idempotencyKey: key }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).project as { projectId: string; pages: { id: string }[] };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  vi.stubEnv("CAPTURE_SWEEP_SECRET", SWEEP_SECRET);
  vi.stubEnv("PINATA_SERVER_CAPTURE", "off");
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  const created = createEditorSession(TEST_SECRET, T0);
  session = { token: created.token, csrf: created.payload.csrf };
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

describe("serverCaptureEnabled", () => {
  test("only the exact value off turns it off", () => {
    expect(serverCaptureEnabled({})).toBe(true);
    expect(serverCaptureEnabled({ PINATA_SERVER_CAPTURE: undefined })).toBe(true);
    expect(serverCaptureEnabled({ PINATA_SERVER_CAPTURE: "" })).toBe(true);
    expect(serverCaptureEnabled({ PINATA_SERVER_CAPTURE: "on" })).toBe(true);
    expect(serverCaptureEnabled({ PINATA_SERVER_CAPTURE: "OFF" })).toBe(true);
    expect(serverCaptureEnabled({ PINATA_SERVER_CAPTURE: "false" })).toBe(true);
    expect(serverCaptureEnabled({ PINATA_SERVER_CAPTURE: "off" })).toBe(false);
  });

  test("the scheduler is inert while off, and the injected one is back when on", () => {
    getContinuationScheduler()(async () => {});
    expect(scheduler.scheduled).toBe(0);
    vi.stubEnv("PINATA_SERVER_CAPTURE", "on");
    getContinuationScheduler()(async () => {});
    expect(scheduler.scheduled).toBe(1);
  });
});

describe("with PINATA_SERVER_CAPTURE=off", () => {
  test("project creation commits pending attempts and continues nothing", async () => {
    await createProject("switch-create-0001");
    expect(scheduler.scheduled).toBe(0);
    expect(provider.requests).toHaveLength(0);
    expect((await allCaptures(testDb.db)).every((row) => row.status === "pending")).toBe(true);
  });

  test("the dispatch route still captures for the client driver, and chains nothing", async () => {
    const project = await createProject("switch-dispatch-0001");
    const page = project.pages[0]!;
    const [first] = await attemptsFor(testDb.db, page.id, "desktop");
    const response = await dispatchPOST(build(`/api/captures/${first!.id}/dispatch`, "POST"), {
      params: Promise.resolve({ captureId: first!.id }),
    });
    expect(response.status).toBe(200);
    expect(provider.requests).toHaveLength(1);
    expect(scheduler.scheduled).toBe(0);
    const [mobile] = await attemptsFor(testDb.db, page.id, "mobile");
    expect(mobile!.status).toBe("pending");
  });

  test("a committed retry continues nothing", async () => {
    const project = await createProject("switch-retry-0001");
    const page = project.pages[0]!;
    const [first] = await attemptsFor(testDb.db, page.id, "desktop");
    await applyCaptureTransition(testDb.db, {
      captureId: first!.id,
      from: "pending",
      to: "failed",
      now: T0 + 1,
      errorCode: "total-timeout",
    });
    const response = await retryPOST(
      build(`/api/pages/${page.id}/captures`, "POST", {
        variant: "desktop",
        idempotencyKey: "switch-retry-key-0001",
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(response.status).toBe(201);
    expect(scheduler.scheduled).toBe(0);
    expect(provider.requests).toHaveLength(0);
  });

  test("the sweep answers 200 with counts, creates no retry, and schedules nothing", async () => {
    const project = await createProject("switch-sweep-0001");
    const page = project.pages[0]!;
    const [desktop] = await attemptsFor(testDb.db, page.id, "desktop");
    await applyCaptureTransition(testDb.db, {
      captureId: desktop!.id,
      from: "pending",
      to: "capturing",
      now: T0 - STALE_CAPTURE_AGE_MS - 1,
    });
    const before = await allCaptures(testDb.db);

    const response = await sweepPOST(
      build("/api/captures/sweep", "POST", undefined, { [SWEEP_SECRET_HEADER]: SWEEP_SECRET }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sweep: { projects: 1, pending: 1, stale: 1, retried: 0, scheduled: 0 },
    });
    expect(scheduler.scheduled).toBe(0);
    expect(provider.requests).toHaveLength(0);
    expect(await allCaptures(testDb.db)).toEqual(before);
  });
});
