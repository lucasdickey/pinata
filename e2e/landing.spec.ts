// End-to-end proof of the branded landing page against the production build
// (VAL-LANDING-001, VAL-LANDING-002, VAL-LANDING-003, D066).
//
// The first test is fully anonymous and needs no configuration, so it runs in
// CI too: brand mark above the capture entry, value proposition, the static
// example render, the sign-in path, zero /api/* traffic, zero external
// requests, and no horizontal overflow at the narrow breakpoints.
//
// The second test is the landing-to-project-create flow. Credentialed sign-in
// is driven here in Playwright (never agent-browser) so the editor password
// is read from the environment inside the test process and never appears in a
// command line. The project it creates carries a run id on the fixtures host
// and is registered for deletion in the Playwright global teardown (D065) —
// never deleted in a trailing test.

import { expect, test } from "@playwright/test";
import { localEnvGate, requireLocalEnvValue } from "./local-env";
import { registerRunCleanup } from "./run-cleanup";
import { stubDispatchQuota } from "./stub-dispatch";

const createEnv = localEnvGate([
  "EDITOR_PASSWORD",
  "SESSION_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  // Teardown deletes any Blob objects a concurrent real dispatch driver
  // produced for this run's pending attempts in the shared store.
  "BLOB_READ_WRITE_TOKEN",
]);

const RUN_ID = `e2e-landing-${Date.now().toString(36)}`;
// Run-scoped projects are rooted on the fixtures host so they can never match
// findReadyTarget's seeded Chickpea regex (D065).
const ROOT = `https://pinata-fixtures.vercel.app/echo-v1.html?landing=${RUN_ID}`;
const EXTRA = `https://pinata-fixtures.vercel.app/links-v1.html?landing=${RUN_ID}`;

test("anonymous landing: brand, entry form, static example, sign-in path, no api traffic", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const apiRequests: string[] = [];
  const externalRequests: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(request.url());
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.host !== "127.0.0.1:3100"
    ) {
      externalRequests.push(request.url());
    }
  });

  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveTitle(/pinata/);
  await expect(page.getByRole("heading", { level: 1, name: "pinata" })).toBeVisible();

  // VAL-LANDING-001: the inline-SVG logo directly above the URL capture form.
  const logo = page.getByRole("img", { name: "pinata logo" });
  await expect(logo).toBeVisible();
  const logoAboveForm = await page.evaluate(() => {
    const mark = document.querySelector(".pinata-logo");
    const field = document.getElementById("entry-root-url");
    return mark && field
      ? Boolean(mark.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING)
      : false;
  });
  expect(logoAboveForm).toBe(true);

  // Required root URL, add-more-URLs control, one visible primary action.
  const rootField = page.getByLabel("Root URL");
  await expect(rootField).toBeVisible();
  await expect(rootField).toHaveAttribute("required", "");
  await expect(page.getByRole("button", { name: "Add URL" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start capturing" })).toBeVisible();
  // The brief value proposition.
  await expect(page.getByText(/pin plain, directional notes/i)).toBeVisible();

  // VAL-LANDING-002: the self-contained static example — a screenshot region
  // with two numbered pins, a two-entry comment thread, and a visible DOM
  // metadata panel.
  const shot = page.getByTestId("example-shot");
  await expect(shot).toBeVisible();
  await expect(shot.locator("[data-pin-number]")).toHaveCount(2);
  await expect(
    page.getByRole("list", { name: "Example thread" }).getByRole("listitem"),
  ).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "DOM context" })).toBeVisible();
  // The element's text shows in the metadata panel, and (D078) the pin's
  // name carries it too, in the example's heading and its pins list.
  await expect(page.getByText("“Annual (save 20%)”")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Pin 1 · “This billing toggle .* · Annual \(save 20%\)$/ }),
  ).toBeVisible();

  // A clear sign-in path.
  await expect(page.getByRole("heading", { name: "Editor sign in" })).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();

  // The favicon is the same-origin shared mark, not an external asset.
  const iconHref = await page.locator('link[rel="icon"]').first().getAttribute("href");
  expect(iconHref).toBeTruthy();
  const iconResponse = await page.request.get(iconHref!);
  expect(iconResponse.status()).toBe(200);
  expect(iconResponse.headers()["content-type"]).toContain("image/svg");

  // Responsive: no horizontal document overflow at 390 or 320 CSS px.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(shot).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("anonymous entry routes to sign-in, retains the draft, and creates exactly one project", async ({
  page,
}) => {
  test.skip(!createEnv.ready, createEnv.reason);
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    // The stubbed dispatch answers 429; the driver expects and handles it.
    if (msg.type() === "error" && !msg.text().includes("status of 429")) {
      consoleErrors.push(msg.text());
    }
  });
  let projectPosts = 0;
  let projectCreates = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/projects") {
      projectPosts += 1;
    }
  });
  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/projects" &&
      response.status() === 201
    ) {
      projectCreates += 1;
    }
  });

  await stubDispatchQuota(page);
  await page.goto("/");

  // Anonymous entry: the submit parks the draft and routes to sign-in without
  // touching the projects API.
  await page.getByLabel("Root URL").fill(ROOT);
  await page.getByRole("button", { name: "Add URL" }).click();
  await page.getByRole("textbox", { name: "URL 2" }).fill(EXTRA);
  await page.getByRole("button", { name: "Start capturing" }).click();
  await expect(page.getByLabel("Password")).toBeFocused();
  expect(projectPosts).toBe(0);

  // Sign in. A parked draft routes the editor to the project form at
  // /pins/new (D069) rather than the workspace, and the draft is retained.
  await page.getByLabel("Password").fill(requireLocalEnvValue("EDITOR_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/pins\/new$/);
  await expect(page.getByLabel("Root URL")).toHaveValue(ROOT);
  await expect(page.getByRole("textbox", { name: "URL 2" })).toHaveValue(EXTRA);

  // Creating the project issues exactly one POST /api/projects, answered 201,
  // and hands off to the workspace, where the project is listed.
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pins$/);
  await expect(page.getByText("Signed in as Lucas (editor).")).toBeVisible();
  await expect(page.getByText(`landing=${RUN_ID}`).first()).toBeVisible();
  expect(projectPosts).toBe(1);
  expect(projectCreates).toBe(1);
  expect(consoleErrors).toEqual([]);
});

// Run-scoped cleanup registers here and executes in the Playwright global
// teardown after every worker's pages have closed (D065): an aborted or
// failed run still runs this hook, so rows carrying the run id cannot leak.
test.afterAll(async () => {
  if (!createEnv.ready) return;
  registerRunCleanup({ runId: RUN_ID, bodyPrefixes: [], suite: "landing" });
});
