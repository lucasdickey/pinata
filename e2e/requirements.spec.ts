import { expect, test } from "@playwright/test";
import {
  CLIENT_REQUEST_TIMEOUT_MS,
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  POLICY_VERSION,
} from "../src/lib/boundaries";

// Public requirements hub: discovery from the landing page, refresh-safe
// routes, current-navigation state, bounded 404, narrow-layout overflow, and
// reduced-motion rendering. Runs against `next start` on 127.0.0.1:3100.

const ROUTES = [
  { path: "/reqs", heading: "Pinata requirements" },
  { path: "/reqs/architecture", heading: "Pinata architecture" },
  { path: "/reqs/milestones", heading: "Pinata milestones" },
  { path: "/reqs/decisions", heading: "Decisions" },
  { path: "/reqs/evals", heading: "Pinata evals" },
] as const;

function watchConsoleErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test("the landing page links visibly to the requirements hub", async ({ page }) => {
  const errors = watchConsoleErrors(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Requirements, architecture/ }).click();
  await expect(page).toHaveURL(/\/reqs$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pinata requirements" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("all five routes are navigable, refresh-safe, and show current navigation", async ({
  page,
}) => {
  const errors = watchConsoleErrors(page);
  await page.goto("/reqs");
  for (const { path, heading } of ROUTES) {
    await page.getByRole("navigation", { name: "Requirements" }).getByRole("link", { name: heading.replace("Pinata ", "") }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const current = page.locator('.reqs-nav a[aria-current="page"]');
    await expect(current).toHaveAttribute("href", path);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("an unknown /reqs/* path returns a bounded 404 with a working hub link", async ({ page }) => {
  const errors = watchConsoleErrors(page);
  const response = await page.goto("/reqs/definitely-not-a-page");
  expect(response?.status()).toBe(404);
  // The browser logs the navigation's own 404 as a resource error; that is
  // the correct status, not a defect. Everything else must stay clean.
  const unexpected = errors.filter(
    (e) => !/Failed to load resource: the server responded with a status of 404/.test(e),
  );
  await expect(page.getByRole("heading", { level: 1, name: /not found/i })).toBeVisible();
  await page.getByRole("link", { name: /requirements hub/i }).click();
  await expect(page).toHaveURL(/\/reqs$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pinata requirements" })).toBeVisible();
  expect(unexpected).toEqual([]);
});

for (const width of [390, 320]) {
  test(`no horizontal document overflow at ${width}px`, async ({ page }) => {
    const errors = watchConsoleErrors(page);
    await page.setViewportSize({ width, height: 800 });
    for (const { path, heading } of ROUTES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows at ${width}px`).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
  });
}

test("core content renders with reduced motion preferred", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  const errors = watchConsoleErrors(page);
  for (const { path, heading } of ROUTES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  expect(errors).toEqual([]);
  await context.close();
});

test("the decisions route renders the real decision log", async ({ page }) => {
  await page.goto("/reqs/decisions");
  const cards = page.locator("article[data-decision-id]");
  await expect(cards.first()).toHaveAttribute("data-decision-id", "D001");
  expect(await cards.count()).toBeGreaterThan(15);
  await expect(page.locator('article[data-decision-id="D009"] a[href="#D003"]')).toBeVisible();
});

// VAL-REQS-007: the deployed routes publish the versioned boundary catalog,
// reading the same exported constants the runtime will enforce.
test("evals and architecture publish the versioned boundary catalog", async ({ page }) => {
  const errors = watchConsoleErrors(page);
  const viewportText = `${DESKTOP_VIEWPORT.width} × ${DESKTOP_VIEWPORT.height}`;
  const mobileText = `${MOBILE_VIEWPORT.width} × ${MOBILE_VIEWPORT.height}`;

  await page.goto("/reqs/evals");
  const evals = page.locator("article.doc");
  await expect(evals).toContainText(POLICY_VERSION);
  await expect(evals).toContainText(viewportText);
  await expect(evals).toContainText(mobileText);
  await expect(evals).toContainText("CLIENT_REQUEST_TIMEOUT_MS");
  await expect(evals).toContainText(CLIENT_REQUEST_TIMEOUT_MS.toLocaleString("en-US"));
  await expect(evals).toContainText("stale-lease");
  await expect(evals).toContainText("trailing-dot-stripped");

  await page.goto("/reqs/architecture");
  const arch = page.locator("article.doc");
  await expect(arch).toContainText(POLICY_VERSION);
  await expect(arch).toContainText(viewportText);
  await expect(arch).toContainText("STALE_CAPTURE_AGE_MS");
  expect(errors).toEqual([]);
});
