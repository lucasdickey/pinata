// End-to-end proof of the branded landing page against the production build
// (VAL-LANDING-001, VAL-LANDING-002, VAL-LANDING-003, D066).
//
// The first test is fully anonymous and needs no configuration, so it runs in
// CI too: brand mark and value proposition, a call to sign in and no address
// field before sign-in (D103), the demo video under the hero (D140), the
// static example render, the sign-in path, zero /api/* traffic, zero
// external requests, and no horizontal overflow at the narrow breakpoints.
//
// The second test is the landing-to-project-create flow: sign in from the
// landing, then create the project on /pins/new. Credentialed sign-in
// is driven here in Playwright (never agent-browser) so the editor password
// is read from the environment inside the test process and never appears in a
// command line. The project it creates carries a run id on the fixtures host
// and is registered for deletion in the Playwright global teardown (D065) —
// never deleted in a trailing test.

import { expect, test } from "@playwright/test";
import { localEnvGate, requireLocalEnvValue } from "./local-env";
import { registerRunCleanup } from "./run-cleanup";
import { stubDispatchQuota } from "./stub-dispatch";
import { openPageFromMenu, openNewProject } from "./rail";

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

test("anonymous landing: brand, sign-in call, static example, sign-in path, no api traffic", async ({
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
  await expect(page).toHaveTitle(/Pinata/);
  await expect(page.getByRole("heading", { level: 1, name: "Pinata" })).toBeVisible();

  // VAL-LANDING-001: the inline-SVG logo opens the page, ahead of the name.
  const logo = page.getByRole("img", { name: "Pinata logo" });
  await expect(logo).toBeVisible();
  const logoFirst = await page.evaluate(() => {
    const mark = document.querySelector(".pinata-logo");
    const heading = document.querySelector("h1");
    return mark && heading
      ? Boolean(mark.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)
      : false;
  });
  expect(logoFirst).toBe(true);

  // D103: no address field before sign-in; the hero's way in is a call to
  // sign in that lands on the sign-in form.
  await expect(page.getByLabel("Root URL")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start capturing" })).toHaveCount(0);
  // It opens the sign-in dialog (D123) with focus in the password field.
  const cta = page.getByRole("button", { name: "Sign in to start a review" });
  await expect(cta).toBeVisible();
  await cta.click();
  const dialog = page.getByRole("dialog", { name: "Editor sign in" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Password")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(cta).toBeFocused();
  await expect(page.getByText("Mark up a page. Hand it off.")).toBeVisible();
  await expect(page.getByText(/coding agent or a friend/i)).toBeVisible();
  await expect(page.getByText(/Pinata does not make the edits/i)).toBeVisible();

  // D140: the demo video, filmed in the product, comes straight after the
  // hero and plays with motion allowed; its chapter buttons jump to a part.
  const demo = page.getByTestId("demo-video");
  await expect(demo).toBeVisible();
  await expect(demo).toHaveAccessibleName(/filmed in the product/);
  const afterHero = await page.evaluate(() => {
    const hero = document.querySelector(".illustrated-hero");
    const video = document.querySelector(".landing-demo");
    return Boolean(hero && video && hero.nextElementSibling === video);
  });
  expect(afterHero).toBe(true);
  await expect(demo.locator(".demo-poster")).toHaveCount(0);
  const chapters = page.getByRole("list", { name: "Chapters" });
  await expect(chapters.getByRole("button")).toHaveCount(5);
  await expect(chapters.getByRole("button", { name: "Capture" })).toHaveAttribute("aria-current", "true");
  await chapters.getByRole("button", { name: "Share" }).click();
  await expect(chapters.getByRole("button", { name: "Share" })).toHaveAttribute("aria-current", "true");

  // With reduced motion the video does not start: a still of the real
  // workspace with a play button stands in until the visitor asks.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(demo.locator(".demo-poster-light")).toBeVisible();
  const play = demo.getByRole("button", { name: "Play the demo" });
  await expect(play).toBeVisible();
  await play.click();
  await expect(demo.locator(".demo-poster")).toHaveCount(0);
  await expect(chapters.getByRole("button", { name: "Capture" })).toHaveAttribute("aria-current", "true");

  // VAL-LANDING-002: the self-contained static example — a screenshot
  // region with one numbered mark of each kind (D103), a two-entry comment
  // thread, and a visible DOM metadata panel.
  const shot = page.getByTestId("example-shot");
  await expect(shot).toBeVisible();
  await expect(shot.locator("[data-mark-number]")).toHaveCount(4);
  await expect(
    page.getByRole("list", { name: "Example thread" }).getByRole("listitem"),
  ).toHaveCount(2);
  const details = page.locator(".example-details");
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();
  // The details are the app's pin table (D126); the element's text shows
  // in its Element column, and (D078) the pin's name carries it too.
  const table = details.getByRole("table");
  await expect(table.getByRole("rowheader")).toHaveCount(4);
  await expect(table.getByText("<button> role=switch “Annual (save 20%)”")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Pin 1 · “This billing toggle .* · Annual \(save 20%\)$/ }),
  ).toBeVisible();

  // A clear sign-in path: an old /#editor-login link still opens it.
  await page.goto("/#editor-login");
  await expect(page.getByRole("dialog", { name: "Editor sign in" })).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await page.keyboard.press("Escape");

  // The favicon is the same-origin shared mark, not an external asset.
  const iconHref = await page.locator('link[rel="icon"]').first().getAttribute("href");
  expect(iconHref).toBeTruthy();
  const iconResponse = await page.request.get(iconHref!);
  expect(iconResponse.status()).toBe(200);
  expect(iconResponse.headers()["content-type"]).toContain("image/svg");

  // D107: the illustrations load from this origin and reserve their size.
  const art = page.locator('img[src*="illustrations"], img[srcset*="illustrations"]');
  await expect(art).toHaveCount(6);
  for (const image of await art.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect(image).toHaveJSProperty("complete", true);
    await expect(image).not.toHaveJSProperty("naturalWidth", 0);
  }

  // Responsive: no horizontal document overflow at 390 or 320 CSS px.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(shot).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    // The page clips sideways overflow (overflow-x: clip), so the scroll
    // width alone cannot see text pushed off the edge: a lost phone rule
    // once squeezed the sign-in card to 120px and its sign-in column past
    // the screen. Every piece of text and every control stays on screen
    // (or inside a box that scrolls sideways, like the pin table's), and
    // the card spans the column with its parts stacked.
    const offscreen = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const scrolls = (element: Element) =>
        ["auto", "scroll"].includes(getComputedStyle(element).overflowX);
      // A box that clips (the video's frame, zoomed inside it) keeps what it
      // holds out of view; only the box itself has to fit.
      const clips = (element: Element) =>
        ["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(element).overflowX);
      const out: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>(
        "main *:not([aria-hidden='true'] *):not([aria-hidden='true'])",
      )) {
        const hasText = [...element.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "",
        );
        if (!hasText && !element.matches("a, button, input, img, video") && !scrolls(element)) {
          continue;
        }
        let inScroller = false;
        for (let up = element.parentElement; up && up.tagName !== "MAIN"; up = up.parentElement) {
          if (clips(up)) inScroller = true;
        }
        if (inScroller) continue;
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.left < -1 || box.right > width + 1) {
          out.push(`${element.tagName.toLowerCase()} “${element.textContent!.trim().slice(0, 40)}”`);
        }
      }
      return out;
    });
    expect(offscreen, `text or controls off screen at ${width}px`).toEqual([]);
    const card = await page.locator(".landing-invitation").boundingBox();
    const column = await page.locator(".landing-example").boundingBox();
    expect(card!.width).toBeGreaterThanOrEqual(column!.width - 1);
    const copy = await page.locator(".invitation-copy").boundingBox();
    const signIn = await page.locator(".invitation-sign-in").boundingBox();
    expect(signIn!.y).toBeGreaterThanOrEqual(copy!.y + copy!.height);
    if (width === 320) {
      const body = await page.locator(".invitation-copy > p:last-of-type").boundingBox();
      const glow = await page.locator(".landing-halftone--card .landing-halftone-glow").boundingBox();
      expect(glow!.y).toBeGreaterThanOrEqual(body!.y + body!.height);
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await details.locator("summary").click();
  await page.screenshot({ path: "test-results/homepage-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/homepage-mobile.png", fullPage: true });

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("the landing's sign-in call leads to the workspace, and /pins/new creates exactly one project", async ({
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

  // The landing takes no address (D103): its call opens the sign-in
  // dialog (D123) without touching the projects API.
  await page.getByRole("button", { name: "Sign in to start a review" }).click();
  const dialog = page.getByRole("dialog", { name: "Editor sign in" });
  await expect(dialog.getByLabel("Password")).toBeInViewport();
  expect(projectPosts).toBe(0);

  // Sign in lands on the workspace; the project form is one link away.
  await dialog.getByLabel("Password").fill(requireLocalEnvValue("EDITOR_PASSWORD"));
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/pins$/);
  await openNewProject(page);
  await expect(page).toHaveURL(/\/pins\/new$/);
  await page.getByLabel("Root URL").fill(ROOT);
  await page.getByRole("button", { name: "Add URL" }).click();
  await page.getByRole("textbox", { name: "URL 2" }).fill(EXTRA);

  // Creating the project issues exactly one POST /api/projects, answered 201,
  // and hands off to the workspace, where the project is listed.
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/pins$/);
  await expect(page.getByText("Signed in as Lucas (editor).")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show projects" })).toBeVisible();
  // The new project is in the menu and holds its page (D128): pick it,
  // then the page in its overview.
  await openPageFromMenu(page, ROOT);
  await expect(
    page.getByRole("group", { name: "Device" }).getByRole("button", { name: `Desktop capture of ${ROOT}` }),
  ).toBeVisible();
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
