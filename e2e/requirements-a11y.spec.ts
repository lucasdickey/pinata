import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// VAL-REQS-006 regression guard: axe wcag2a/2aa sweep over all five /reqs
// routes, plus the anonymous landing (D078), at BOTH desktop and 390 CSS
// pixels. Round 1 swept desktop only and missed
// scrollable-region-focusable on the ASCII diagram and wide tables at
// 390px; this spec keeps the narrow sweep from regressing. Runs against
// `next start` on 127.0.0.1:3100 with no editor session, so "/" is the
// anonymous landing.

const ROUTES = [
  "/",
  "/reqs",
  "/reqs/architecture",
  "/reqs/milestones",
  "/reqs/decisions",
  "/reqs/evals",
] as const;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "narrow-390", width: 390, height: 844 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`axe wcag2a/2aa reports zero serious violations at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const route of ROUTES) {
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious.map((v) => `${v.id} [${v.impact}] on ${v.nodes.length} node(s)`),
        `${route} has serious axe violations at ${viewport.width}px`,
      ).toEqual([]);
    }
  });
}

// Keyboard operability (WCAG 2.1.1): the horizontally scrolling code diagram
// and wide tables must be reachable by Tab and scrollable by arrow keys.
const SCROLLABLE_TARGETS = [
  { route: "/reqs/architecture", selector: "pre[tabindex='0']" },
  { route: "/reqs/evals", selector: ".table-scroll[tabindex='0']" },
] as const;

for (const { route, selector } of SCROLLABLE_TARGETS) {
  test(`keyboard can focus and horizontally scroll ${selector} on ${route} at 390px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);

    // A page may hold several code/table regions; the VAL-REQS-006 premise is
    // that at least one of them overflows horizontally at 390px.
    const candidates = page.locator(selector);
    const geometries = await candidates.evaluateAll((els) =>
      els.map((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })),
    );
    const index = geometries.findIndex((g) => g.scrollWidth > g.clientWidth);
    expect(
      index,
      `no horizontally scrollable ${selector} found on ${route} at 390px`,
    ).toBeGreaterThanOrEqual(0);
    const target = candidates.nth(index);
    await expect(target).toBeVisible();

    // Tab through the page until the scroll region holds focus. The hub is
    // small, so 60 presses is a generous bound, not an expected count.
    let focused = false;
    for (let i = 0; i < 60 && !focused; i++) {
      await page.keyboard.press("Tab");
      focused = await target.evaluate(
        (el) => document.activeElement === el,
      );
    }
    expect(focused, `${selector} never received keyboard focus on ${route}`).toBe(true);

    const before = await target.evaluate((el) => el.scrollLeft);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    // Keyboard scrolling runs on the compositor; scrollLeft lands
    // asynchronously, so poll instead of reading immediately.
    await expect
      .poll(
        () => target.evaluate((el) => el.scrollLeft),
        { message: `${selector} on ${route} did not scroll via keyboard` },
      )
      .toBeGreaterThan(before);
  });
}
