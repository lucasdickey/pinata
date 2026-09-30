import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The light/dark theme (D104), end to end on the production build with no
// configuration, so it runs in CI: the toggle switches and remembers, a saved
// choice is on <html> before the app hydrates, a device that prefers dark
// gets dark with no click, and the public surfaces pass the same axe sweep in
// dark that they pass in light.

const DARK_BG = "rgb(24, 24, 24)";
const LIGHT_BG = "rgb(252, 252, 249)";

async function pageBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

test("the toggle switches to dark, remembers it, and switches back", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  expect(await pageBackground(page)).toBe(LIGHT_BG);

  const toggle = page.getByRole("button", { name: "Dark mode" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await pageBackground(page)).toBe(DARK_BG);

  // A reload paints dark from the <head> script, before any app code runs.
  await page.reload({ waitUntil: "commit" });
  await page.waitForSelector("body");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // The choice follows the visitor to the other public surfaces.
  await page.goto("/reqs");
  expect(await pageBackground(page)).toBe(DARK_BG);
  const reqsToggle = page.getByRole("button", { name: "Dark mode" });
  await expect(reqsToggle).toHaveAttribute("aria-pressed", "true");
  await reqsToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await pageBackground(page)).toBe(LIGHT_BG);
});

test("a device that prefers dark gets dark with no click", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(await pageBackground(page)).toBe(DARK_BG);
  await expect(page.getByRole("button", { name: "Dark mode" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

for (const route of ["/", "/reqs", "/reqs/decisions"] as const) {
  test(`axe wcag2a/2aa reports zero serious violations on ${route} in dark`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(route);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious.map((v) => `${v.id} [${v.impact}] on ${v.nodes.length} node(s)`),
      `${route} has serious axe violations in the dark theme`,
    ).toEqual([]);
  });
}
