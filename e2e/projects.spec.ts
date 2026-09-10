// End-to-end proof of project creation against the production build and the
// real configured Turso database (VAL-PROJECT-001, VAL-PROJECT-002,
// VAL-PROJECT-006): keyboard-operable URL rows, complete per-row corrections
// that preserve the other rows and their order, Cancel writing nothing, one
// atomic create, and an idempotent retry.
//
// The spec gates on the configuration the flow genuinely needs and skips with
// a name-only reason otherwise. Every row it creates carries a unique
// non-secret run id and is deleted — and verified absent — in afterAll, never
// in a trailing test: an aborted or failed run skips trailing tests but still
// runs teardown, so run-scoped rows cannot leak into the real database.

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { localEnvGate, requireLocalEnvValue } from "./local-env";
import { stubDispatchQuota } from "./stub-dispatch";

const projectEnv = localEnvGate([
  "EDITOR_PASSWORD",
  "SESSION_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  // Cleanup deletes Blob objects too: a concurrent spec's editor page runs
  // the real dispatch driver and may legitimately carry this run's pending
  // attempts all the way to ready in the shared store.
  "BLOB_READ_WRITE_TOKEN",
]);

const RUN_ID = `e2e-${Date.now().toString(36)}`;
const ROOT = `https://chickpea.co/?${RUN_ID}`;
const PRICING = `https://chickpea.co/pricing?${RUN_ID}`;
const ABOUT = `https://chickpea.co/about?${RUN_ID}`;

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Password").fill(requireLocalEnvValue("EDITOR_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as Lucas (editor).")).toBeVisible();
}

/**
 * Keep this spec hermetic: the editor's dispatch driver automatically drives
 * every pending attempt it can see, and this spec is about organization, not
 * provider execution. The shared stub (e2e/stub-dispatch.ts) answers every
 * dispatch with the durable quota-exceeded outcome, so this run's attempts
 * are never driven by its own page. A concurrent spec's real driver page may
 * still pick them up in the shared database, so state assertions below are
 * structural and cleanup deletes any Blob objects those captures produced.
 */

/** Add one URL row and type into it. */
async function addRow(page: Page, value: string): Promise<void> {
  await page.getByRole("button", { name: "Add URL" }).click();
  const inputs = page.getByRole("textbox", { name: /^URL \d+$/ });
  await inputs.last().fill(value);
}

interface DeviceSummary {
  variant: string;
  attempts: { id: string; attempt: number; state: string }[];
  latest: { attempt: number; state: string } | null;
  selectedCaptureId: string | null;
  usable: boolean;
  retryable: boolean;
}

async function projectsOf(request: APIRequestContext): Promise<
  {
    publicId: string;
    title: string;
    rootUrl: string;
    pages: { id: string; normalizedUrl: string; devices: DeviceSummary[] }[];
    counts: { pages: number; attempts: number; ready: number; failed: number; inProgress: number };
  }[]
> {
  const response = await request.get("/api/projects");
  expect(response.status()).toBe(200);
  const payload = await response.json();
  return payload.projects;
}

type ProjectList = Awaited<ReturnType<typeof projectsOf>>;

/**
 * The real database is shared with other e2e specs running in the second
 * Playwright worker, so whole-store equality is racy by design. Every
 * assertion here is scoped to rows carrying this run id.
 */
function runScoped(projects: ProjectList): ProjectList {
  return projects.filter(
    (project) => project.title.startsWith(RUN_ID) || project.rootUrl.includes(RUN_ID),
  );
}

test.describe.configure({ mode: "serial" });

test("the URL array editor corrects rows, cancels cleanly, and creates one project", async ({
  page,
}) => {
  test.skip(!projectEnv.ready, projectEnv.reason);
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    // The deliberate correction below is a 422 the browser always logs as a
    // failed resource load; the stubbed dispatch above answers 429, which the
    // driver expects and handles. Everything else is a defect.
    if (
      msg.type() === "error" &&
      !msg.text().includes("status of 422") &&
      !msg.text().includes("status of 429")
    ) {
      consoleErrors.push(msg.text());
    }
  });
  let projectPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/projects") {
      projectPosts += 1;
    }
  });

  await stubDispatchQuota(page);
  await signIn(page);
  const before = runScoped(await projectsOf(page.request));

  // The landing's project form is always active for a signed-in editor
  // (D066) — no toggle. Clear form resets the fields and writes nothing.
  await page.getByLabel("Root URL").fill(ROOT);
  await addRow(page, PRICING);
  await page.getByRole("button", { name: "Clear form" }).click();
  await expect(page.getByLabel("Root URL")).toHaveValue("");
  await expect(page.getByRole("textbox", { name: /^URL \d+$/ })).toHaveCount(0);
  expect(runScoped(await projectsOf(page.request))).toEqual(before);

  // Rows are added, reordered, and removed with named controls.
  await page.getByLabel("Project name (optional)").fill(`${RUN_ID} review`);
  await page.getByLabel("Root URL").fill(ROOT);
  await addRow(page, "http://chickpea.co/insecure");
  await addRow(page, ABOUT);
  await addRow(page, PRICING);
  await page.getByRole("button", { name: "Move URL 4 up" }).click();
  await expect(page.getByRole("textbox", { name: "URL 3" })).toHaveValue(PRICING);
  await expect(page.getByRole("textbox", { name: "URL 4" })).toHaveValue(ABOUT);

  // Every invalid row is reported without clearing the valid ones.
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText("Only public https:// addresses can be captured.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "URL 3" })).toHaveValue(PRICING);
  await expect(page.getByRole("textbox", { name: "URL 4" })).toHaveValue(ABOUT);
  expect(runScoped(await projectsOf(page.request))).toEqual(before);

  // Correcting the offending row lets the same submission through.
  await page.getByRole("button", { name: "Remove URL 2" }).click();
  await page.getByRole("button", { name: "Create project" }).click();

  // VAL-AUTH-009: the project shows up exactly once and the workspace
  // (capture progress included) is right there — no manual route entry.
  await expect(page.getByRole("heading", { name: `${RUN_ID} review` })).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: "Projects, pages, and devices" }),
  ).toBeVisible();

  // Reload and Back/Forward traversal never resubmit the form and never
  // create a second project.
  const postsAfterCreate = projectPosts;
  await page.reload();
  await expect(page.getByRole("heading", { name: `${RUN_ID} review` })).toHaveCount(1);
  await page.goBack();
  await page.goForward();
  await expect(page.getByRole("heading", { name: `${RUN_ID} review` })).toHaveCount(1);
  expect(projectPosts).toBe(postsAfterCreate);
  const after = runScoped(await projectsOf(page.request));
  expect(after.length).toBe(before.length + 1);
  const created = after.find((project) => project.title === `${RUN_ID} review`);
  expect(created?.pages.map((p) => p.normalizedUrl)).toEqual([ROOT, PRICING, ABOUT]);
  for (const created_page of created!.pages) {
    // Creation commits exactly one initial attempt per device. The state is
    // not asserted: the dispatch driver is live by design (D049), so a
    // concurrent real-driver page may already be carrying these attempts to
    // capturing or ready in the shared store.
    expect(created_page.devices.map((d) => d.variant)).toEqual(["desktop", "mobile"]);
    for (const d of created_page.devices) {
      expect(d.attempts).toHaveLength(1);
      expect(d.attempts[0]!.attempt).toBe(1);
    }
  }
  expect(consoleErrors).toEqual([]);
});

test("an idempotent retry of the same submission creates nothing new", async ({ page }) => {
  test.skip(!projectEnv.ready, projectEnv.reason);
  await stubDispatchQuota(page);
  await signIn(page);
  const csrf = (await page.context().cookies()).find((c) => c.name === "pinata_csrf")!.value;
  // Playwright's request context sends no Origin; a real browser fetch does,
  // and the route requires an exact same-origin match.
  const headers = {
    "content-type": "application/json",
    "x-pinata-csrf": csrf,
    origin: new URL(page.url()).origin,
  };
  const body = {
    title: `${RUN_ID} retry`,
    rootUrl: `https://chickpea.co/privacy?${RUN_ID}`,
    urls: [],
    idempotencyKey: `${RUN_ID}-retry-key`,
  };

  const first = await page.request.post("/api/projects", {
    headers,
    data: body,
  });
  expect(first.status()).toBe(201);
  const second = await page.request.post("/api/projects", {
    headers,
    data: body,
  });
  expect(second.status()).toBe(200);
  expect(await second.json()).toEqual(await first.json());

  const conflicting = await page.request.post("/api/projects", {
    headers,
    data: { ...body, urls: [`https://chickpea.co/about?${RUN_ID}`] },
  });
  expect(conflicting.status()).toBe(409);

  const projects = await projectsOf(page.request);
  expect(projects.filter((p) => p.title === `${RUN_ID} retry`)).toHaveLength(1);
});

test("the workspace keeps one active device, retries one variant, and survives reload", async ({
  page,
}) => {
  test.skip(!projectEnv.ready, projectEnv.reason);
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    // The stubbed dispatch answers 429; the driver expects and handles it.
    if (msg.type() === "error" && !msg.text().includes("status of 429")) {
      consoleErrors.push(msg.text());
    }
  });

  await stubDispatchQuota(page);
  await signIn(page);
  const created = (await projectsOf(page.request)).find((p) => p.title === `${RUN_ID} review`)!;
  const pricing = created.pages[1]!;

  // Drive one variant to a terminal failure the way a capture worker will,
  // so the partial-status and scoped-retry surfaces have something to show.
  const { createClient } = await import("@libsql/client");
  const client = createClient({
    url: requireLocalEnvValue("TURSO_DATABASE_URL"),
    authToken: requireLocalEnvValue("TURSO_AUTH_TOKEN"),
  });
  try {
    await client.execute({
      sql: `update captures set status = 'failed', error_code = 'total-timeout',
              error_message = 'The capture exceeded its total time budget.', updated_at = ?
            where page_id = ? and variant = 'mobile' and attempt = 1`,
      args: [Date.now(), pricing.id],
    });
  } finally {
    client.close();
  }

  await page.reload();
  const tree = page.getByRole("navigation", { name: "Projects, pages, and devices" });
  await expect(tree.getByText(`${RUN_ID} review`)).toBeVisible();
  // Exactly one page/device is active at a time.
  await expect(tree.locator('button[aria-current="true"]')).toHaveCount(1);

  const detail = page.getByRole("region", { name: "Selected capture" });
  await tree.getByRole("button", { name: `Mobile capture of ${PRICING}` }).click();
  await expect(tree.locator('button[aria-current="true"]')).toHaveCount(1);
  await expect(detail.getByRole("alert")).toContainText(
    "The capture exceeded its total time budget.",
  );

  // The static stage is an image surface, not a link to the captured site.
  await expect(detail.getByTestId("capture-stage").locator("a, iframe")).toHaveCount(0);

  await detail.getByRole("button", { name: "Retry Mobile capture" }).click();
  await expect(detail.getByRole("list", { name: "Capture versions" })).toBeVisible();

  const afterRetry = (await projectsOf(page.request)).find(
    (p) => p.title === `${RUN_ID} review`,
  )!;
  const retriedPage = afterRetry.pages[1]!;
  expect(retriedPage.devices[1]!.attempts.map((a) => a.attempt)).toEqual([2, 1]);
  // The retry committed attempt 2 as the latest; the live driver (D049) may
  // already be dispatching it, so its state is deliberately not asserted.
  expect(retriedPage.devices[1]!.latest?.attempt).toBe(2);
  // Exactly one variant of one page was retried.
  expect(retriedPage.devices[0]!.attempts).toHaveLength(1);
  expect(afterRetry.pages[0]!.devices.every((d) => d.attempts.length === 1)).toBe(true);
  expect(afterRetry.pages[2]!.devices.every((d) => d.attempts.length === 1)).toBe(true);

  // The organization is durable, not browser-local: a hard reload rebuilds it
  // from the database with the same versions.
  await page.reload();
  await tree.getByRole("button", { name: `Mobile capture of ${PRICING}` }).click();
  await expect(
    detail.getByRole("list", { name: "Capture versions" }).getByRole("button"),
  ).toHaveCount(2);
  expect(consoleErrors).toEqual([]);
});

test("a failed list load retries with exactly one read and never loses logout", async ({
  page,
}) => {
  test.skip(!projectEnv.ready, projectEnv.reason);
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    // The intercepted 500 below is logged by the browser as a failed
    // resource load, as is the stubbed dispatch 429; everything else is a
    // defect.
    if (
      msg.type() === "error" &&
      !msg.text().includes("status of 500") &&
      !msg.text().includes("status of 429")
    ) {
      consoleErrors.push(msg.text());
    }
  });

  // Force the first list read to fail, then let everything else through,
  // counting exactly what the editor asks for.
  let listReads = 0;
  let projectWrites = 0;
  await page.route("**/api/projects", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      projectWrites += 1;
      await route.continue();
      return;
    }
    listReads += 1;
    if (listReads === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "unavailable" }),
      });
      return;
    }
    await route.continue();
  });

  await stubDispatchQuota(page);
  await signIn(page);
  // Loading finished in a distinct, announced failure state; logout survives.
  // (Scoped to `p` — the Next route announcer div also carries role=alert.)
  await expect(page.locator("p[role='alert']")).toContainText(
    "Projects could not be loaded.",
  );
  await expect(page.getByRole("button", { name: "Sign out" })).toBeEnabled();
  await expect(page.getByText("No projects yet.")).toHaveCount(0);
  expect(listReads).toBe(1);

  // One press of the retry control issues exactly one more read and
  // recovers to the populated list.
  const readsBeforeRetry = listReads;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("navigation", { name: "Projects, pages, and devices" }),
  ).toBeVisible();
  expect(listReads).toBe(readsBeforeRetry + 1);

  // A reload re-reads but never writes.
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Projects, pages, and devices" }),
  ).toBeVisible();
  expect(projectWrites).toBe(0);
  expect(consoleErrors).toEqual([]);
});

// Run-scoped cleanup lives in teardown, not in a test: an aborted or failed
// run skips trailing tests but still runs afterAll, so rows carrying this
// run id cannot leak into the real database. Deletion goes through the same
// server-only database boundary the application uses and is verified absent.
test.afterAll(async () => {
  if (!projectEnv.ready) return;
  const { createClient } = await import("@libsql/client");
  const { createVercelBlobStore } = await import("../src/lib/server/providers/blob");
  const client = createClient({
    url: requireLocalEnvValue("TURSO_DATABASE_URL"),
    authToken: requireLocalEnvValue("TURSO_AUTH_TOKEN"),
  });
  try {
    // A concurrent spec's real dispatch driver may have carried this run's
    // attempts to ready; delete any Blob objects those captures produced
    // before removing the rows that reference them.
    const store = createVercelBlobStore({
      BLOB_READ_WRITE_TOKEN: requireLocalEnvValue("BLOB_READ_WRITE_TOKEN"),
    })!;
    const blobbed = await client.execute({
      sql: `select blob_path from captures where blob_path is not null and page_id in (
              select id from pages where project_id in (
                select id from projects where root_url like ?))`,
      args: [`%${RUN_ID}%`],
    });
    for (const row of blobbed.rows) {
      await store.del(String(row.blob_path));
    }
    // Capture-retry idempotency keys carry the page id (not the run id) in
    // their stored result, so collect this run's page ids before deleting
    // the pages they reference.
    const runPages = await client.execute({
      sql: `select id from pages where project_id in (
              select id from projects where root_url like ?)`,
      args: [`%${RUN_ID}%`],
    });
    await client.execute({
      sql: `delete from captures where page_id in (
              select id from pages where project_id in (
                select id from projects where root_url like ?))`,
      args: [`%${RUN_ID}%`],
    });
    for (const row of runPages.rows) {
      await client.execute({
        sql: "delete from idempotency_keys where result_json like ?",
        args: [`%${row.id}%`],
      });
    }
    await client.execute({
      sql: `delete from pages where project_id in (
              select id from projects where root_url like ?)`,
      args: [`%${RUN_ID}%`],
    });
    await client.execute({
      sql: "delete from projects where root_url like ?",
      args: [`%${RUN_ID}%`],
    });
    // Form submissions key on a fresh UUID, so the run id is matched inside
    // the stored result instead.
    await client.execute({
      sql: "delete from idempotency_keys where key like ? or result_json like ?",
      args: [`${RUN_ID}%`, `%${RUN_ID}%`],
    });

    const remaining = await client.execute({
      sql: `select
              (select count(*) from projects where root_url like ?) as projects,
              (select count(*) from idempotency_keys where key like ? or result_json like ?) as keys`,
      args: [`%${RUN_ID}%`, `${RUN_ID}%`, `%${RUN_ID}%`],
    });
    expect(Number(remaining.rows[0]!.projects)).toBe(0);
    expect(Number(remaining.rows[0]!.keys)).toBe(0);
    for (const row of runPages.rows) {
      const orphanKeys = await client.execute({
        sql: "select count(*) as n from idempotency_keys where result_json like ?",
        args: [`%${row.id}%`],
      });
      expect(Number(orphanKeys.rows[0]!.n)).toBe(0);
    }
  } finally {
    client.close();
  }
});
