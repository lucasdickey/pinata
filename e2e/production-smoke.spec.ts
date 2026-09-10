// Production smoke for the first real deployment (first-production-deployment;
// VAL-CROSS-001's editor loop on the deployed surface). Unlike every other
// spec this one targets the Vercel production deployment, not the local
// server: deployment protection is OFF since D074, so the deployment is
// publicly reachable and the application's own authorization is the only
// wall — the last test asserts exactly that. The protection-bypass header is
// still sent when the secret is configured, so this spec keeps working if
// protection is ever re-enabled. The editor password is read through the
// shared env gate inside the test process and never printed.
//
// The spec is skipped unless the editor credentials are configured in the
// process environment, so `npm run validate` (local and CI) is unaffected.
// Run it after a deploy with:
//
//   npx playwright test e2e/production-smoke.spec.ts
//
// It writes two real pins (one /pricing Desktop with an explicit element
// choice, one Mobile home with "No element") into the production Chickpea
// demo project — that project is deliberately left in place for the live
// pins checkpoint, and these pins are part of the demo data.

import { expect, test, type Page } from "@playwright/test";
import {
  findClearAim,
  findReadyTarget,
  openPlane,
  panUntilNaturalVisible,
  readCamera,
  signIn,
  toScreen,
  trackConsoleErrors,
  visiblePane,
  waitForZoom,
  type ReadyTarget,
} from "./canvas-session";
import { localEnvGate } from "./local-env";

// Only the editor password is required: deployment protection is off (D074),
// so no bypass secret is needed to reach the deployment.
const gate = localEnvGate(["EDITOR_PASSWORD"]);

const PRODUCTION_URL =
  process.env.PINATA_PRODUCTION_URL ?? "https://pinata-lucasdickeys-projects.vercel.app";
const PRODUCTION_PROJECT_TITLE = "Chickpea (production)";

test.use({
  baseURL: PRODUCTION_URL,
  extraHTTPHeaders: {
    "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "not-configured",
    "x-vercel-set-bypass-cookie": "true",
  },
});

test.describe.configure({ mode: "serial" });

const PIN_NODE = ".react-flow__node-pin";

interface PinRecord {
  id: string;
  number: number;
  tip: { x: number; y: number };
  body: string;
  elementSnapshot: unknown;
}

async function listPins(page: Page, captureId: string): Promise<PinRecord[]> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/captures/${encodeURIComponent(id)}/annotations`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`annotations list failed: ${response.status}`);
    return ((await response.json()) as { annotations: PinRecord[] }).annotations;
  }, captureId);
}

async function waitPinsLoaded(page: Page): Promise<void> {
  await expect(page.getByTestId("capture-panel")).toContainText(/No pins yet\.|Pin \d+ — at \(/);
}

/** Probe the context route for a declared dense pricing cell (td/th). */
async function findDenseCell(
  page: Page,
  target: ReadyTarget,
): Promise<{ point: { x: number; y: number }; elementId: string; label: string }> {
  return page.evaluate(
    async ({ captureId, width, height }) => {
      for (const fy of [0.3, 0.4, 0.5, 0.6, 0.7]) {
        for (const fx of [0.25, 0.5, 0.75]) {
          const x = Math.round(width * fx);
          const y = Math.round(height * fy);
          const response = await fetch(
            `/api/captures/${encodeURIComponent(captureId)}/context?x=${x}&y=${y}`,
            { cache: "no-store" },
          );
          if (!response.ok) continue;
          const { candidates } = (await response.json()) as {
            candidates: { id: string; tag?: string; kind?: string; text?: string }[];
          };
          const cell = candidates?.find((c) => c.tag === "td" || c.tag === "th");
          if (cell) {
            return {
              point: { x, y },
              elementId: cell.id,
              label: `${cell.tag}:${(cell.text ?? "").slice(0, 40)}`,
            };
          }
        }
      }
      throw new Error("no dense pricing cell candidate found on the capture");
    },
    { captureId: target.captureId, width: target.width, height: target.height },
  );
}

/** Zoom the camera to 8x with the wheel, like a precise reviewer would. */
async function zoomToMax(page: Page): Promise<void> {
  let camera = await readCamera(page);
  const pane = await visiblePane(page);
  for (let i = 0; i < 200 && camera.zoom < 8; i += 1) {
    await page.mouse.move(pane.left + pane.width / 2, pane.top + pane.height / 2);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(25);
    camera = await readCamera(page);
  }
}

test("editor signs in on production and a dense-cell pin with a comment survives reload (VAL-CROSS-001)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(300_000);
  const consoleErrors = trackConsoleErrors(page);

  await signIn(page);
  const target = await findReadyTarget(
    page,
    "desktop",
    "https://chickpea.co/pricing",
    PRODUCTION_PROJECT_TITLE,
  );
  if (!target) throw new Error("production /pricing Desktop capture is not ready");
  await openPlane(page, target);
  await waitPinsLoaded(page);
  const before = await listPins(page, target.captureId);

  // Declare the target: a dense pricing table cell offered by the capture's
  // own manifest, aimed at 8x like a reviewer reading the fine print.
  const cell = await findDenseCell(page, target);
  await zoomToMax(page);
  await waitForZoom(page, 8);
  await panUntilNaturalVisible(page, cell.point);

  // Enter placement mode, THEN recompute the screen point: clicking the
  // toolbar scrolls the page, which stales any earlier screen coordinate.
  const pinButton = page.getByRole("button", { name: "Place pin" });
  if ((await pinButton.getAttribute("aria-pressed")) !== "true") await pinButton.click();
  const pane = await visiblePane(page);
  const camera = await readCamera(page);
  const local = toScreen(cell.point, camera);
  expect(local.x, "placement x maps on-pane").toBeGreaterThanOrEqual(0);
  expect(local.y, "placement y maps on-pane").toBeGreaterThanOrEqual(0);
  expect(local.x, "placement x maps on-pane").toBeLessThanOrEqual(pane.width);
  expect(local.y, "placement y maps on-pane").toBeLessThanOrEqual(pane.height);
  await page.mouse.click(pane.left + local.x, pane.top + local.y);
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(1);
  await expect(page.getByTestId("draft-context")).toHaveAttribute(
    "data-candidates-state",
    /ready|failed/,
  );
  // The explicit context decision: this run's declared cell, never the
  // implicit default and never a client-authored snapshot.
  await page.locator(`.panel-candidate[data-element-id="${cell.elementId}"] input`).click();
  const body = `Production UI smoke: dense cell ${cell.label} reads cramped at a glance.`;
  await page.getByLabel("Comment").fill(body);
  await page.getByRole("button", { name: "Save pin" }).click();
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(0);

  const pins = await listPins(page, target.captureId);
  const saved = pins.find((pin) => pin.body === body);
  expect(saved, "pin persisted with its comment").toBeTruthy();
  expect(Math.abs(saved!.tip.x - cell.point.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(saved!.tip.y - cell.point.y)).toBeLessThanOrEqual(1);
  expect(saved!.elementSnapshot, "explicit element choice persisted a snapshot").not.toBeNull();

  // Reload on production: the pin and its comment come back from the store.
  await page.reload();
  await openPlane(page, target);
  await waitPinsLoaded(page);
  await page.getByRole("button", { name: new RegExp(`Pin ${saved!.number} —`) }).click();
  await expect(page.getByTestId("panel-pin")).toContainText("dense cell");
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test("a Mobile home pin with an explicit No-element choice stays on its own plane (VAL-CROSS-001)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(300_000);
  const consoleErrors = trackConsoleErrors(page);

  await signIn(page);
  const mobile = await findReadyTarget(
    page,
    "mobile",
    "https://chickpea.co/",
    PRODUCTION_PROJECT_TITLE,
  );
  const desktop = await findReadyTarget(
    page,
    "desktop",
    "https://chickpea.co/",
    PRODUCTION_PROJECT_TITLE,
  );
  if (!mobile || !desktop) throw new Error("production home captures are not ready");
  await openPlane(page, mobile);
  await waitPinsLoaded(page);

  // The mobile header landmark: visible without opening the closed menu.
  // Place at natural size (1x): at contain zoom the pins this demo project
  // already carries span hundreds of natural px of hit box and would swallow
  // the placement click.
  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  const aim = await findClearAim(
    page,
    mobile.captureId,
    { width: mobile.width, height: mobile.height },
    { from: 0.0, to: 0.05 },
  );
  await panUntilNaturalVisible(page, aim);
  const pinButton = page.getByRole("button", { name: "Place pin" });
  if ((await pinButton.getAttribute("aria-pressed")) !== "true") await pinButton.click();
  // Recompute after the toolbar click: it can scroll the page.
  const pane = await visiblePane(page);
  const camera = await readCamera(page);
  const local = toScreen(aim, camera);
  await page.mouse.click(pane.left + local.x, pane.top + local.y);
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(1);
  await expect(page.getByTestId("draft-context")).toHaveAttribute(
    "data-candidates-state",
    /ready|failed/,
  );
  await page.getByRole("radio", { name: "No element" }).click();
  const body = "Production UI smoke: mobile header pin, deliberately element-free.";
  await page.getByLabel("Comment").fill(body);
  await page.getByRole("button", { name: "Save pin" }).click();
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(0);

  const mobilePins = await listPins(page, mobile.captureId);
  const desktopPins = await listPins(page, desktop.captureId);
  const saved = mobilePins.find((pin) => pin.body === body);
  expect(saved, "mobile pin persisted").toBeTruthy();
  expect(
    desktopPins.some((pin) => pin.id === saved!.id || pin.body === body),
    "desktop plane never sees the mobile pin",
  ).toBe(false);
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test("an unauthorized browser gets no capture bytes, and the application is the wall (VAL-CROSS-001)", async ({
  browser,
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(120_000);

  // Identify a ready production capture through the signed-in session.
  await signIn(page);
  const target = await findReadyTarget(
    page,
    "desktop",
    "https://chickpea.co/pricing",
    PRODUCTION_PROJECT_TITLE,
  );
  if (!target) throw new Error("production /pricing Desktop capture is not ready");

  // A fresh browser context with NO session: the application must answer
  // with its own bounded denial.
  const anonymous = await browser.newContext({
    baseURL: PRODUCTION_URL,
    extraHTTPHeaders: {
      "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "not-configured",
    },
  });
  try {
    const denied = await anonymous.request.get(`/api/captures/${target.captureId}/asset`);
    expect(denied.status()).toBe(401);
    expect(denied.headers()["content-type"]).toContain("application/json");
    expect((await denied.body()).length).toBeLessThan(1024);
    const deniedList = await anonymous.request.get("/api/projects");
    expect(deniedList.status()).toBe(401);
  } finally {
    await anonymous.close();
  }

  // No bypass header at all (the empty extraHTTPHeaders matter:
  // browser.newContext() would otherwise inherit this file's test.use
  // header). Deployment protection is off (D074), so the deployment itself
  // must answer: the landing page is served, it still renders the sign-in
  // prompt (proving the D052 auth bypass is not set in production), and an
  // editor-only route still refuses. This fails if protection is ever
  // silently re-enabled, which would redirect instead of serving.
  const direct = await browser.newContext({ baseURL: PRODUCTION_URL, extraHTTPHeaders: {} });
  try {
    const response = await direct.request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["location"] ?? "").not.toContain("vercel.com/sso");
    expect(await response.text()).toContain('type="password"');
    const refused = await direct.request.get("/api/projects");
    expect(refused.status()).toBe(401);
  } finally {
    await direct.close();
  }
});
