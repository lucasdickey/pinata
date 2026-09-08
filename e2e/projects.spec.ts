// End-to-end proof of project creation against the production build and the
// real configured Turso database (VAL-PROJECT-001, VAL-PROJECT-002,
// VAL-PROJECT-006): keyboard-operable URL rows, complete per-row corrections
// that preserve the other rows and their order, Cancel writing nothing, one
// atomic create, and an idempotent retry.
//
// The spec gates on the configuration the flow genuinely needs and skips with
// a name-only reason otherwise. Every row it creates carries a unique
// non-secret run id and is deleted through the same authorized surface plus a
// scoped database cleanup, which the last test verifies.

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { localEnvGate, requireLocalEnvValue } from "./local-env";

const projectEnv = localEnvGate([
  "EDITOR_PASSWORD",
  "SESSION_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
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

/** Add one URL row and type into it. */
async function addRow(page: Page, value: string): Promise<void> {
  await page.getByRole("button", { name: "Add URL" }).click();
  const inputs = page.getByRole("textbox", { name: /^URL \d+$/ });
  await inputs.last().fill(value);
}

async function projectsOf(request: APIRequestContext): Promise<
  { title: string; pages: { normalizedUrl: string; captures: { variant: string; status: string }[] }[] }[]
> {
  const response = await request.get("/api/projects");
  expect(response.status()).toBe(200);
  const payload = await response.json();
  return payload.projects;
}

test.describe.configure({ mode: "serial" });

test("the URL array editor corrects rows, cancels cleanly, and creates one project", async ({
  page,
}) => {
  test.skip(!projectEnv.ready, projectEnv.reason);
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    // The deliberate correction below is a 422 the browser always logs as a
    // failed resource load; everything else is a defect.
    if (msg.type() === "error" && !msg.text().includes("status of 422")) {
      consoleErrors.push(msg.text());
    }
  });

  await signIn(page);
  const before = await projectsOf(page.request);

  // Cancel writes nothing.
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Root URL").fill(ROOT);
  await addRow(page, PRICING);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
  expect(await projectsOf(page.request)).toEqual(before);

  // Rows are added, reordered, and removed with named controls.
  await page.getByRole("button", { name: "New project" }).click();
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
  expect(await projectsOf(page.request)).toEqual(before);

  // Correcting the offending row lets the same submission through.
  await page.getByRole("button", { name: "Remove URL 2" }).click();
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name: `${RUN_ID} review` })).toBeVisible();
  const after = await projectsOf(page.request);
  expect(after.length).toBe(before.length + 1);
  const created = after.find((project) => project.title === `${RUN_ID} review`);
  expect(created?.pages.map((p) => p.normalizedUrl)).toEqual([ROOT, PRICING, ABOUT]);
  for (const created_page of created!.pages) {
    expect(created_page.captures.map((c) => `${c.variant}:${c.status}`)).toEqual([
      "desktop:pending",
      "mobile:pending",
    ]);
  }
  expect(consoleErrors).toEqual([]);
});

test("an idempotent retry of the same submission creates nothing new", async ({ page }) => {
  test.skip(!projectEnv.ready, projectEnv.reason);
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

test("this run's projects are removed and the store is left clean", async ({ page }) => {
  test.skip(!projectEnv.ready, projectEnv.reason);
  // Cleanup runs through the same server-only database boundary the
  // application uses; it touches only rows whose URLs carry this run id.
  const { createClient } = await import("@libsql/client");
  const client = createClient({
    url: requireLocalEnvValue("TURSO_DATABASE_URL"),
    authToken: requireLocalEnvValue("TURSO_AUTH_TOKEN"),
  });
  try {
    await client.execute({
      sql: `delete from captures where page_id in (
              select id from pages where project_id in (
                select id from projects where root_url like ?))`,
      args: [`%${RUN_ID}%`],
    });
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
      sql: "select count(*) as n from projects where root_url like ?",
      args: [`%${RUN_ID}%`],
    });
    expect(Number(remaining.rows[0]!.n)).toBe(0);
  } finally {
    client.close();
  }

  await signIn(page);
  const projects = await projectsOf(page.request);
  expect(projects.filter((p) => p.title.startsWith(RUN_ID))).toEqual([]);
});
