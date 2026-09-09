// End-to-end proof of the capture-dispatch driver against the production
// build, the real Turso database, the real private Blob store, and the real
// Browserless provider: a project whose attempts were committed entirely
// outside the browser reaches `ready` on every attempt with zero manual
// dispatch calls — the editor client drives the scoped dispatch route itself,
// on load and after reload, never more than MAX_ACTIVE_CAPTURES at a time.
// A second project whose target fails admission shows the catalog outcome in
// the workspace and is never re-driven once terminal.
//
// The suite gates on the full local configuration and skips with a name-only
// reason in CI. Fixture targets come from the durable public fixture host
// committed in test/fixtures/capture/host.json. Every Turso row and Blob
// object carries a unique run id and is deleted — and verified absent — in
// afterAll, never in a trailing test.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { like } from "drizzle-orm";
import { MAX_ACTIVE_CAPTURES } from "../src/lib/boundaries";
import { databaseFromClient, schema } from "../src/lib/server/db/client";
import { createVercelBlobStore, type ScreenshotStore } from "../src/lib/server/providers/blob";
import { localEnvGate, requireLocalEnvValue } from "./local-env";

const gate = localEnvGate([
  "EDITOR_PASSWORD",
  "SESSION_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
  "BROWSERLESS_TOKEN",
]);

const RUN_ID = `e2edrive-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

const FIXTURE_HOST = JSON.parse(
  readFileSync(new URL("../test/fixtures/capture/host.json", import.meta.url), "utf8"),
) as { fixtures: Record<string, { url: string }> };
const ECHO = FIXTURE_HOST.fixtures["echo-v1"]!.url;

// Two pages over the fast echo fixture; the query pair keeps each URL unique
// per run and per page, which is also what scopes cleanup.
const ROOT_URL = `${ECHO}?run=${RUN_ID}&page=root`;
const SECOND_URL = `${ECHO}?run=${RUN_ID}&page=second`;
const FAIL_URL = `https://no-such-host-${RUN_ID}.example.com/`;

test.describe.configure({ mode: "serial" });

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Password").fill(requireLocalEnvValue("EDITOR_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as Lucas (editor).")).toBeVisible();
}

interface CreatedProject {
  projectId: string;
  pages: { id: string; captures: { id: string; variant: string; status: string }[] }[];
}

async function createProject(
  request: APIRequestContext,
  page: Page,
  body: { title: string; rootUrl: string; urls: string[] },
): Promise<CreatedProject> {
  const csrf = (await page.context().cookies()).find((c) => c.name === "pinata_csrf")!.value;
  const response = await request.post("/api/projects", {
    headers: {
      "content-type": "application/json",
      "x-pinata-csrf": csrf,
      origin: new URL(page.url()).origin,
    },
    data: { ...body, idempotencyKey: `${RUN_ID}-${body.title}` },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).project;
}

/** The attempt ids committed for a created project, in hierarchy order. */
function attemptIds(project: CreatedProject): string[] {
  return project.pages.flatMap((page) => page.captures.map((capture) => capture.id));
}

interface RunProject {
  title: string;
  pages: {
    id: string;
    devices: {
      variant: string;
      attempts: { id: string; state: string; errorCode: string | null }[];
    }[];
  }[];
  counts: { attempts: number; ready: number; failed: number; inProgress: number };
}

async function runProject(request: APIRequestContext, title: string): Promise<RunProject | null> {
  const response = await request.get("/api/projects");
  expect(response.status()).toBe(200);
  const { projects } = await response.json();
  return projects.find((project: RunProject) => project.title === title) ?? null;
}

function allAttempts(project: RunProject) {
  return project.pages.flatMap((page) => page.devices.flatMap((device) => device.attempts));
}

test("a project created outside the browser is driven to ready by the editor client", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(300_000);
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // The driver drives every pending row the shared database shows it,
    // including other suites' work, and a non-2xx dispatch answer (quota,
    // conflict, a catalog failure, a row deleted under it) is an expected,
    // handled outcome that Chromium still logs as a resource error. Only
    // dispatch-route resource errors are excused; anything else is a defect.
    const url = msg.location()?.url ?? "";
    if (/\/api\/captures\/[^/]+\/dispatch$/.test(url)) return;
    consoleErrors.push(msg.text());
  });

  // Observe every dispatch the page itself issues for THIS run's attempts
  // (other suites' rows are stubbed, but the shared database may legitimately
  // show this page other pending work, which the driver drives by design):
  // the per-attempt count proves no double-dispatch, and the concurrency
  // watermark proves the client never schedules beyond the durable lease cap.
  const dispatched = new Map<string, number>();
  const inFlightRequests = new Set<string>();
  let maxInFlight = 0;
  let own: Set<string> | null = null;
  const dispatchId = (url: string, method: string) => {
    if (method !== "POST") return null;
    const match = /\/api\/captures\/([^/]+)\/dispatch$/.exec(new URL(url).pathname);
    return match ? decodeURIComponent(match[1]!) : null;
  };
  page.on("request", (request) => {
    const id = dispatchId(request.url(), request.method());
    if (!id || !own?.has(id)) return;
    dispatched.set(id, (dispatched.get(id) ?? 0) + 1);
    inFlightRequests.add(request.url());
    maxInFlight = Math.max(maxInFlight, inFlightRequests.size);
  });
  const release = (request: { url: () => string; method: () => string }) => {
    if (dispatchId(request.url(), request.method())) inFlightRequests.delete(request.url());
  };
  page.on("requestfinished", release);
  page.on("requestfailed", release);
  // A reload abandons the page's JS — and with it the driver's in-flight
  // bookkeeping — before the aborted requests report finished/failed, so the
  // watermark restarts with the new document.
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) inFlightRequests.clear();
  });

  await signIn(page);

  // Commit the project entirely outside the browser: four pending attempts,
  // nothing dispatched. This is the "returned to pending work" shape.
  const created = await createProject(page.request, page, {
    title: `${RUN_ID} drive`,
    rootUrl: ROOT_URL,
    urls: [SECOND_URL],
  });
  own = new Set(attemptIds(created));
  expect(own.size).toBe(4);
  const before = await runProject(page.request, `${RUN_ID} drive`);
  expect(before?.counts).toMatchObject({ attempts: 4, ready: 0, failed: 0, inProgress: 4 });
  expect(dispatched.size).toBe(0);

  // Reloading the editor — the plain navigation case — is what drives the
  // pending attempts. No test code ever calls the dispatch route.
  await page.reload();
  await expect(page.getByRole("heading", { name: `${RUN_ID} drive` })).toBeVisible();
  await expect
    .poll(() => dispatched.size, { timeout: 30_000, intervals: [500] })
    .toBeGreaterThan(0);

  // Every attempt reaches ready with no manual dispatch call.
  await expect
    .poll(
      async () => (await runProject(page.request, `${RUN_ID} drive`))?.counts.ready,
      { timeout: 240_000, intervals: [2_000, 5_000] },
    )
    .toBe(4);

  const after = (await runProject(page.request, `${RUN_ID} drive`))!;
  expect(after.counts).toMatchObject({ attempts: 4, ready: 4, failed: 0, inProgress: 0 });
  for (const attempt of allAttempts(after)) {
    expect(attempt.state).toBe("ready");
  }

  // The lease cap held end to end: within any one loaded document this
  // client never ran more dispatches than the durable slot count, and every
  // attempt was driven. A reload racing an in-flight claim may re-dispatch
  // that attempt once (the server fence makes the second dispatch a 409), so
  // the bound is two per attempt — never an unbounded retry.
  expect(maxInFlight).toBeGreaterThan(0);
  expect(maxInFlight).toBeLessThanOrEqual(MAX_ACTIVE_CAPTURES);
  expect(dispatched.size).toBe(4);
  for (const [id, count] of dispatched) {
    expect(count, id).toBeGreaterThanOrEqual(1);
    expect(count, id).toBeLessThanOrEqual(2);
  }

  // Terminal work is never re-driven: once every attempt is ready the driver
  // and the poller both stand down.
  const dispatchTotal = [...dispatched.values()].reduce((sum, count) => sum + count, 0);
  await page.waitForTimeout(12_000);
  expect([...dispatched.values()].reduce((sum, count) => sum + count, 0)).toBe(dispatchTotal);

  // The workspace shows the finished project, not a stuck queue.
  await expect(page.getByText("2 pages · 4 ready · 0 failed · 0 in progress")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("a dispatch-time admission failure surfaces the catalog outcome and never loops", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(120_000);

  // Count only this run's dispatches: the driver legitimately drives any
  // other pending work the shared database shows this page. Requests are
  // tracked separately from terminal (non-429) answers: a quota-held attempt
  // may be re-driven a bounded number of times before its slot frees, but it
  // must reach its terminal answer exactly once.
  let own: Set<string> | null = null;
  let dispatchRequests = 0;
  const terminalAnswers = new Map<string, number>();
  const ownDispatchId = (url: string, method: string): string | null => {
    if (method !== "POST" || !own) return null;
    const match = /\/api\/captures\/([^/]+)\/dispatch$/.exec(new URL(url).pathname);
    const id = match ? decodeURIComponent(match[1]!) : null;
    return id && own.has(id) ? id : null;
  };
  page.on("request", (request) => {
    if (ownDispatchId(request.url(), request.method())) dispatchRequests += 1;
  });
  page.on("response", (response) => {
    const id = ownDispatchId(response.url(), response.request().method());
    if (id && response.status() !== 429) {
      terminalAnswers.set(id, (terminalAnswers.get(id) ?? 0) + 1);
    }
  });

  await signIn(page);
  const created = await createProject(page.request, page, {
    title: `${RUN_ID} unresolvable`,
    rootUrl: FAIL_URL,
    urls: [],
  });
  own = new Set(attemptIds(created));
  expect(own.size).toBe(2);

  await page.reload();
  await expect(page.getByRole("heading", { name: `${RUN_ID} unresolvable` })).toBeVisible();

  // The driver dispatches, admission fails closed, and the workspace
  // surfaces the catalog's bounded message for both variants.
  await expect
    .poll(
      async () => (await runProject(page.request, `${RUN_ID} unresolvable`))?.counts.failed,
      { timeout: 60_000, intervals: [1_000, 2_000] },
    )
    .toBe(2);

  const tree = page.getByRole("navigation", { name: "Projects, pages, and devices" });
  await tree
    .getByRole("button", { name: `Desktop capture of ${FAIL_URL}` })
    .click();
  await expect(page.getByRole("region", { name: "Selected capture" }).getByRole("alert"))
    .toContainText("The address could not be resolved to a public host.");

  // Terminal means terminal: each attempt got exactly one terminal answer,
  // and no further dispatch leaves the browser afterwards.
  for (const id of own) {
    expect(terminalAnswers.get(id), id).toBe(1);
  }
  const settled = dispatchRequests;
  await page.waitForTimeout(8_000);
  expect(dispatchRequests).toBe(settled);
});

// Run-scoped cleanup in teardown: disposable Blob objects first (their paths
// come from the capture rows), then captures by page id (a retry attempt's id
// is not run-prefixed), then the idempotency records, pages, and projects.
test.afterAll(async () => {
  if (!gate.ready) return;
  const { createClient } = await import("@libsql/client");
  const client = createClient({
    url: requireLocalEnvValue("TURSO_DATABASE_URL"),
    authToken: requireLocalEnvValue("TURSO_AUTH_TOKEN"),
  });
  const db = databaseFromClient(client);
  const store: ScreenshotStore = createVercelBlobStore({
    BLOB_READ_WRITE_TOKEN: requireLocalEnvValue("BLOB_READ_WRITE_TOKEN"),
  })!;
  try {
    const captures = await db
      .select({ blobPath: schema.captures.blobPath })
      .from(schema.captures)
      .where(like(schema.captures.requestedUrl, `%${RUN_ID}%`));
    for (const row of captures) {
      if (row.blobPath) await store.del(row.blobPath);
    }
    await db.delete(schema.captures).where(like(schema.captures.requestedUrl, `%${RUN_ID}%`));
    await db
      .delete(schema.idempotencyKeys)
      .where(like(schema.idempotencyKeys.key, `${RUN_ID}%`));
    await db.delete(schema.pages).where(like(schema.pages.normalizedUrl, `%${RUN_ID}%`));
    await db.delete(schema.projects).where(like(schema.projects.rootUrl, `%${RUN_ID}%`));

    const remaining = await db
      .select({ id: schema.captures.id })
      .from(schema.captures)
      .where(like(schema.captures.requestedUrl, `%${RUN_ID}%`));
    expect(remaining).toHaveLength(0);
    for (const row of captures) {
      if (row.blobPath) {
        const head = await store.head(row.blobPath);
        expect(head.ok).toBe(false);
      }
    }
  } finally {
    client.close();
  }
});
