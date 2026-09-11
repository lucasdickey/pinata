import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { SLIDES } from "../remotion/walkthrough/slides";

// The public /walkthrough route (D072) against the production build: the
// Remotion player mounts, the chapter list matches the slide table, a chapter
// click moves the current marker and the transcript, the page loads nothing
// from outside the app and calls no /api route, and it passes an axe
// wcag2a/2aa sweep at desktop and 390px with no horizontal overflow.

function watch(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  const apiRequests: string[] = [];
  const externalRequests: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.host !== "127.0.0.1:3100") {
      externalRequests.push(request.url());
    }
  });
  return { errors, apiRequests, externalRequests };
}

test("the walkthrough mounts, lists every chapter, and jumps between them", async ({ page }) => {
  const { errors, apiRequests, externalRequests } = watch(page);
  const response = await page.goto("/walkthrough");
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveTitle(/pinata/);
  await expect(page.getByRole("heading", { level: 1, name: "How pinata works" })).toBeVisible();

  // The Remotion player rendered its root inside the stage.
  const stage = page.getByTestId("walkthrough-stage");
  await expect(stage).toBeVisible();
  await expect(stage.locator(".__remotion-player")).toBeVisible();

  const chapters = page.getByRole("navigation", { name: "Walkthrough chapters" }).getByRole("button");
  await expect(chapters).toHaveCount(SLIDES.length);
  for (const [i, slide] of SLIDES.entries()) {
    await expect(chapters.nth(i)).toContainText(slide.chapter);
  }
  await expect(chapters.nth(0)).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { level: 2, name: SLIDES[0]!.title })).toBeVisible();

  await chapters.nth(4).click();
  await expect(chapters.nth(4)).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { level: 2, name: SLIDES[4]!.title })).toBeVisible();
  await expect(page.getByText(SLIDES[4]!.notes)).toBeVisible();

  // Jumping to a chapter starts playback; the marker keeps following the
  // player rather than only the click.
  await page.getByRole("button", { name: "Next" }).click();
  await expect(chapters.nth(5)).toHaveAttribute("aria-current", "step");

  // Give any lazy image of the visible slide a moment to load before judging
  // the console: a missing borrowed image would surface here as an error.
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("the landing links to the walkthrough", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /ten-chapter walkthrough/i }).click();
  await expect(page).toHaveURL(/\/walkthrough$/);
  await expect(page.getByRole("heading", { level: 1, name: "How pinata works" })).toBeVisible();
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "narrow-390", width: 390, height: 844 },
] as const) {
  test(`axe wcag2a/2aa reports zero serious violations at ${viewport.name}, no overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/walkthrough");
    await expect(page.getByTestId("walkthrough-stage").locator(".__remotion-player")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious.map((v) => `${v.id} [${v.impact}] on ${v.nodes.length} node(s)`),
      `/walkthrough has serious axe violations at ${viewport.width}px`,
    ).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(0);
  });
}
