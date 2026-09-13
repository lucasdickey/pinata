// Server continuation from the routes (D076): project creation and the
// scoped retry hand the new project's pending work to the continuation
// scheduler after their response, the dispatch route's own finalization
// schedules the project's next attempt, and a browser-driven dispatch that
// races the server's claim is answered 409 with nothing else changed.
// The scheduler is injected and drained by hand, so every test proves what
// the continuation does without a request scope.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as dispatchPOST } from "../../app/api/captures/[captureId]/dispatch/route";
import { POST as retryPOST } from "../../app/api/pages/[pageId]/captures/route";
import { POST as projectsPOST } from "../../app/api/projects/route";
import { MAX_ACTIVE_CAPTURES } from "../../src/lib/boundaries";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { createEditorSession } from "../../src/lib/server/auth/session";
import { __setContinuationSchedulerForTests } from "../../src/lib/server/captures/continuation";
import {
  __setAdmissionDepsForTests,
  __setCaptureExecutionDepsForTests,
} from "../../src/lib/server/captures/deps";
import { applyCaptureTransition } from "../../src/lib/server/captures/transitions";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
} from "../../src/lib/server/db/client";
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
  safeAdmission,
  T0,
  type InlineScheduler,
} from "./capture-drive-helpers";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "continuation-route-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";

let testDb: TestDb;
let session: { token: string; csrf: string };
let scheduler: InlineScheduler;
let provider: RecordingClient;

function build(path: string, method: string, body?: unknown): Request {
  const headers = new Headers({
    origin: ORIGIN,
    host: "127.0.0.1:3100",
    cookie: `${EDITOR_SESSION_COOKIE}=${session.token}`,
    [EDITOR_CSRF_HEADER]: session.csrf,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface CreatedProject {
  projectId: string;
  pages: { id: string; captures: { id: string; variant: string }[] }[];
}

async function createProject(key: string, urls: string[] = []): Promise<CreatedProject> {
  const response = await projectsPOST(
    build("/api/projects", "POST", { rootUrl: "https://safe.example", urls, idempotencyKey: key }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).project as CreatedProject;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
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

describe("POST /api/projects", () => {
  test("answers before any capture runs, then the continuation drives the project to completion", async () => {
    const project = await createProject("continue-create-0001", ["https://safe.example/two"]);
    // The response is written with every attempt still pending and exactly
    // one continuation handed over.
    expect(provider.requests).toHaveLength(0);
    expect(scheduler.scheduled).toBe(1);
    expect((await allCaptures(testDb.db)).every((row) => row.status === "pending")).toBe(true);

    // driveProject fans out to at most the lease cap, then each finalization
    // schedules the next, until the project is done.
    await scheduler.step();
    expect(scheduler.queue).toHaveLength(MAX_ACTIVE_CAPTURES);
    await scheduler.flush();
    const rows = await allCaptures(testDb.db);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.status === "ready")).toBe(true);
    expect(project.pages).toHaveLength(2);
  });

  test("a replayed idempotency key schedules a drive too", async () => {
    await createProject("continue-create-0002");
    const replay = await projectsPOST(
      build("/api/projects", "POST", {
        rootUrl: "https://safe.example",
        urls: [],
        idempotencyKey: "continue-create-0002",
      }),
    );
    expect(replay.status).toBe(200);
    expect(scheduler.scheduled).toBe(2);
  });

  test("a rejected submission schedules nothing", async () => {
    const response = await projectsPOST(
      build("/api/projects", "POST", { rootUrl: "http://insecure.example", idempotencyKey: "k-0003" }),
    );
    expect([400, 422]).toContain(response.status);
    expect(scheduler.scheduled).toBe(0);
  });
});

describe("POST /api/pages/[pageId]/captures", () => {
  test("a committed retry is driven after the response", async () => {
    const project = await createProject("continue-retry-0001");
    const page = project.pages[0]!;
    await scheduler.flush();
    const [first] = await attemptsFor(testDb.db, page.id, "desktop");
    expect(first!.status).toBe("ready");
    const before = scheduler.scheduled;

    const response = await retryPOST(
      build(`/api/pages/${page.id}/captures`, "POST", {
        variant: "desktop",
        idempotencyKey: "retry-key-0001",
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(response.status).toBe(201);
    expect(scheduler.scheduled).toBe(before + 1);
    const pendingRows = await attemptsFor(testDb.db, page.id, "desktop");
    expect(pendingRows.map((row) => [row.attempt, row.status, row.origin])).toEqual([
      [1, "ready", "manual"],
      [2, "pending", "manual"],
    ]);

    await scheduler.flush();
    const after = await attemptsFor(testDb.db, page.id, "desktop");
    expect(after.map((row) => row.status)).toEqual(["ready", "ready"]);
  });

  test("a refused retry schedules nothing", async () => {
    const project = await createProject("continue-retry-0002");
    const page = project.pages[0]!;
    const before = scheduler.scheduled;
    // The attempt is still pending: not retryable.
    const response = await retryPOST(
      build(`/api/pages/${page.id}/captures`, "POST", {
        variant: "desktop",
        idempotencyKey: "retry-key-0002",
      }),
      { params: Promise.resolve({ pageId: page.id }) },
    );
    expect(response.status).toBe(409);
    expect(scheduler.scheduled).toBe(before);
  });
});

describe("POST /api/captures/[captureId]/dispatch", () => {
  test("a browser-driven dispatch finalizes the attempt and schedules the project's next one", async () => {
    const project = await createProject("continue-dispatch-0001");
    const page = project.pages[0]!;
    scheduler.queue.splice(0); // Pretend the creation continuation never ran.
    const before = scheduler.scheduled;
    const [first] = await attemptsFor(testDb.db, page.id, "desktop");

    const response = await dispatchPOST(build(`/api/captures/${first!.id}/dispatch`, "POST"), {
      params: Promise.resolve({ captureId: first!.id }),
    });
    expect(response.status).toBe(200);
    expect(scheduler.scheduled).toBe(before + 1);
    await scheduler.flush();
    const [mobile] = await attemptsFor(testDb.db, page.id, "mobile");
    expect(mobile!.status).toBe("ready");
  });

  test("a retryable failure through the route creates the automatic attempt and answers the catalog outcome", async () => {
    provider = recordingClient(failureEnvelope("navigation-timeout"));
    __setCaptureExecutionDepsForTests({ client: provider.client, store: recordingStore().store });
    const project = await createProject("continue-dispatch-0002");
    const page = project.pages[0]!;
    scheduler.queue.splice(0);
    const [first] = await attemptsFor(testDb.db, page.id, "desktop");

    const response = await dispatchPOST(build(`/api/captures/${first!.id}/dispatch`, "POST"), {
      params: Promise.resolve({ captureId: first!.id }),
    });
    expect(response.status).toBe(504);
    expect((await response.json()).code).toBe("navigation-timeout");
    const rows = await attemptsFor(testDb.db, page.id, "desktop");
    expect(rows.map((row) => [row.status, row.origin])).toEqual([
      ["failed", "manual"],
      ["pending", "automatic"],
    ]);
  });

  test("a dispatch that races the server's claim is answered 409 and changes nothing", async () => {
    const project = await createProject("continue-dispatch-0003");
    const page = project.pages[0]!;
    scheduler.queue.splice(0);
    const [first] = await attemptsFor(testDb.db, page.id, "desktop");
    // The server's continuation claimed this attempt a moment ago.
    await applyCaptureTransition(testDb.db, {
      captureId: first!.id,
      from: "pending",
      to: "capturing",
      now: T0 + 1,
    });
    const before = scheduler.scheduled;

    const response = await dispatchPOST(build(`/api/captures/${first!.id}/dispatch`, "POST"), {
      params: Promise.resolve({ captureId: first!.id }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Request rejected." });
    expect(provider.requests).toHaveLength(0);
    expect(scheduler.scheduled).toBe(before);
    const [row] = await attemptsFor(testDb.db, page.id, "desktop");
    expect(row!.status).toBe("capturing");
  });
});
