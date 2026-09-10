// End-to-end canvas navigation against the production build (VAL-CANVAS-002).
//
// Runs against whatever ready captures the local durable store holds — in
// practice the seeded Chickpea project the milestone-1 checkpoint left in
// place for exactly this purpose. When no ready capture exists (CI never has
// one) the spec skips with a reason rather than failing. Everything here is
// read-only: no project, capture, or annotation is created, so there is no
// cleanup to leak. The dispatch route is stubbed so the editor's background
// driver can never fire a real capture mid-measurement.
//
// The measurements are the contract: the initial contain camera puts the
// entire capture in view, fit-width and natural-size are reachable named
// modes, wheel zoom keeps the natural pixel under the focal screen point
// within one natural pixel, 8x is reachable and clamped, panning at 8x
// reaches the far corner, and camera work issues zero mutation requests and
// zero history entries.

import { expect, test, type Page } from "@playwright/test";
import { CANVAS_MAX_ZOOM, CANVAS_PADDING_PX } from "../src/lib/canvas/camera";
import { localEnvGate, requireLocalEnvValue } from "./local-env";
import { stubDispatchQuota } from "./stub-dispatch";

const gate = localEnvGate(["EDITOR_PASSWORD", "SESSION_SECRET"]);

test.describe.configure({ mode: "serial" });

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Password").fill(requireLocalEnvValue("EDITOR_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as Lucas (editor).")).toBeVisible();
}

interface ReadyTarget {
  pageUrl: string;
  variant: "desktop" | "mobile";
  captureId: string;
  width: number;
  height: number;
}

/** The first ready capture with persisted natural dimensions, if any. */
async function findReadyTarget(page: Page): Promise<ReadyTarget | null> {
  return page.evaluate(async () => {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      projects: {
        pages: {
          normalizedUrl: string;
          devices: {
            variant: string;
            attempts: {
              id: string;
              state: string;
              documentWidth: number | null;
              documentHeight: number | null;
            }[];
          }[];
        }[];
      }[];
    };
    for (const project of payload.projects) {
      for (const p of project.pages) {
        for (const device of p.devices) {
          const ready = device.attempts.find(
            (a) => a.state === "ready" && a.documentWidth && a.documentHeight,
          );
          if (ready) {
            return {
              pageUrl: p.normalizedUrl,
              variant: device.variant as "desktop" | "mobile",
              captureId: ready.id,
              width: ready.documentWidth!,
              height: ready.documentHeight!,
            };
          }
        }
      }
    }
    return null;
  });
}

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** The live React Flow transform, read from the viewport element style. */
async function readCamera(page: Page): Promise<Viewport> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".react-flow__viewport");
    const match = el?.style.transform.match(
      /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/,
    );
    if (!match) throw new Error("no React Flow viewport transform found");
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  });
}

/** The canvas pane's own bounding rect (the camera's reference frame). */
async function paneRect(page: Page): Promise<{ left: number; top: number; width: number; height: number }> {
  return page.evaluate(() => {
    const el = document.querySelector(".react-flow");
    if (!el) throw new Error("no React Flow pane");
    const rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
}

/**
 * Scroll the pane fully into the browser viewport and return its fresh
 * rect. Mouse gestures dispatched outside the window hit nothing, and
 * clicking the toolbar above the canvas scrolls the page — so every gesture
 * section re-anchors through this.
 */
async function visiblePane(page: Page): Promise<{ left: number; top: number; width: number; height: number }> {
  await page.evaluate(() => {
    document.querySelector(".capture-canvas")?.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(100);
  return paneRect(page);
}

/** Screen coordinates of a screenshot-natural point under a camera. */
function toScreen(point: { x: number; y: number }, camera: Viewport): { x: number; y: number } {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}

/** The natural pixel under a pane-local screen point. */
function toNatural(point: { x: number; y: number }, camera: Viewport): { x: number; y: number } {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}

/** Wait until the live camera settles at an expected zoom (mode changes are
    applied by an effect after mount/click, never synchronously). */
async function waitForZoom(page: Page, expected: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const zoom = (await readCamera(page)).zoom;
    if (Math.abs(zoom - expected) / expected < 0.02) return;
    if (Date.now() > deadline) {
      throw new Error(`camera never settled at zoom ${expected}; last seen ${zoom}`);
    }
    await page.waitForTimeout(50);
  }
}

/** The contain zoom the pure camera math predicts for this pane/doc. */
function expectedContainZoom(
  pane: { width: number; height: number },
  doc: { width: number; height: number },
): number {
  const area = {
    width: Math.max(1, pane.width - 2 * CANVAS_PADDING_PX),
    height: Math.max(1, pane.height - 2 * CANVAS_PADDING_PX),
  };
  return Math.min(CANVAS_MAX_ZOOM, Math.min(area.width / doc.width, area.height / doc.height));
}

/** Every document corner renders inside the pane (the contain contract). */
async function expectEntireCaptureVisible(
  page: Page,
  doc: { width: number; height: number },
): Promise<Viewport> {
  const [camera, pane] = await Promise.all([readCamera(page), paneRect(page)]);
  for (const corner of [
    { x: 0, y: 0 },
    { x: doc.width, y: 0 },
    { x: 0, y: doc.height },
    { x: doc.width, y: doc.height },
  ]) {
    const screen = toScreen(corner, camera);
    expect(screen.x, `corner ${corner.x},${corner.y} x`).toBeGreaterThanOrEqual(-1);
    expect(screen.x, `corner ${corner.x},${corner.y} x`).toBeLessThanOrEqual(pane.width + 1);
    expect(screen.y, `corner ${corner.x},${corner.y} y`).toBeGreaterThanOrEqual(-1);
    expect(screen.y, `corner ${corner.x},${corner.y} y`).toBeLessThanOrEqual(pane.height + 1);
  }
  return camera;
}

test("canvas camera modes, focal zoom, extents, and fixed panel", async ({ page }) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(180_000);

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await stubDispatchQuota(page);
  await signIn(page);

  const target = await findReadyTarget(page);
  test.skip(
    !target,
    "no ready capture with document dimensions exists in the local store (CI or fresh checkout)",
  );
  const doc = { width: target!.width, height: target!.height };

  // Select the target plane through the out-of-canvas navigation.
  const deviceName = `${target!.variant === "desktop" ? "Desktop" : "Mobile"} capture of ${target!.pageUrl}`;
  await page.getByRole("button", { name: deviceName, exact: true }).click();
  const image = page.getByRole("img", { name: `Screenshot of ${target!.pageUrl}` });
  await expect(image).toBeVisible();
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>(".capture-frame-image");
    return img !== null && img.complete && img.naturalWidth > 0;
  });

  // The decoded image is exactly the persisted document plane.
  const intrinsic = await page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>(".capture-frame-image")!;
    return { width: img.naturalWidth, height: img.naturalHeight };
  });
  expect(intrinsic).toEqual(doc);

  // Camera work starts here: count every mutation request and history
  // entry. The stubbed background dispatch route is excluded — it is not
  // camera-caused, and a deferred driver re-drive must not flake the count.
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.method() !== "HEAD" &&
      !request.url().includes("/dispatch")
    ) {
      mutations.push(`${request.method()} ${request.url()}`);
    }
  });
  const urlBefore = page.url();
  const historyBefore = await page.evaluate(() => history.length);

  // Initial camera: the named entire-capture mode, pressed, all corners in.
  await expect(page.getByRole("button", { name: "Entire page" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  let pane = await visiblePane(page);
  await waitForZoom(page, expectedContainZoom(pane, doc));
  await expectEntireCaptureVisible(page, doc);

  // Fit width: the capture fills the pane horizontally, top edge visible.
  await page.getByRole("button", { name: "Fit width" }).click();
  const expectedWidthZoom = (pane.width - 2 * CANVAS_PADDING_PX) / doc.width;
  await waitForZoom(page, expectedWidthZoom);
  const widthCamera = await readCamera(page);
  expect(Math.abs(widthCamera.zoom - expectedWidthZoom) / expectedWidthZoom).toBeLessThan(0.02);
  const widthTopLeft = toScreen({ x: 0, y: 0 }, widthCamera);
  expect(Math.abs(widthTopLeft.y - CANVAS_PADDING_PX)).toBeLessThanOrEqual(1);

  // Natural size: exactly 1:1.
  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  expect((await readCamera(page)).zoom).toBe(1);

  // Back to the overview; all four corners visible again.
  await page.getByRole("button", { name: "Entire page" }).click();
  await waitForZoom(page, expectedContainZoom(pane, doc));
  await expectEntireCaptureVisible(page, doc);

  // Focal zoom, measured per wheel step: the natural pixel under the
  // cursor must not move on screen by more than one natural pixel (8
  // screen px at 8x, the contract bar) or two screen pixels of sub-pixel
  // wheel jitter, whichever is looser. The focus is re-aimed at the pane
  // center each step so nothing stale compounds.
  pane = await visiblePane(page);
  let camera = await readCamera(page);
  for (let i = 0; i < 200 && camera.zoom < CANVAS_MAX_ZOOM; i += 1) {
    const before = await paneRect(page);
    const focus = { x: before.width / 2, y: before.height / 2 };
    const focalContent = toNatural(focus, camera);
    await page.mouse.move(before.left + focus.x, before.top + focus.y);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(30);
    camera = await readCamera(page);
    const now = toScreen(focalContent, camera);
    const toleranceScreen = Math.max(2, camera.zoom);
    expect(
      Math.abs(now.x - focus.x),
      `focal x drift (screen px) at zoom ${camera.zoom}`,
    ).toBeLessThanOrEqual(toleranceScreen);
    expect(
      Math.abs(now.y - focus.y),
      `focal y drift (screen px) at zoom ${camera.zoom}`,
    ).toBeLessThanOrEqual(toleranceScreen);
  }
  expect(camera.zoom).toBeLessThanOrEqual(CANVAS_MAX_ZOOM + 1e-6);
  expect(camera.zoom).toBeGreaterThan(CANVAS_MAX_ZOOM / 2);
  await expect(page.getByLabel("Current zoom")).toHaveText(`${Math.round(camera.zoom * 100)}%`);

  // Pan at 8x to the far corner: drag until the pane center shows the
  // bottom-right natural pixel. Intermediate frames never write.
  const dragToNatural = async (target2: { x: number; y: number }) => {
    for (let i = 0; i < 12; i += 1) {
      const current = await readCamera(page);
      const delta = {
        x: (toScreen(target2, current).x - pane.width / 2) * -1,
        y: (toScreen(target2, current).y - pane.height / 2) * -1,
      };
      if (Math.hypot(delta.x, delta.y) < 2) break;
      await page.mouse.move(pane.left + pane.width / 2, pane.top + pane.height / 2);
      await page.mouse.down();
      await page.mouse.move(pane.left + pane.width / 2 + delta.x, pane.top + pane.height / 2 + delta.y, {
        steps: 4,
      });
      await page.mouse.up();
    }
  };
  await dragToNatural({ x: doc.width, y: doc.height });
  const atCorner = await readCamera(page);
  const centerNatural = toNatural({ x: pane.width / 2, y: pane.height / 2 }, atCorner);
  expect(Math.abs(centerNatural.x - doc.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(centerNatural.y - doc.height)).toBeLessThanOrEqual(1);
  expect(atCorner.zoom).toBeCloseTo(camera.zoom, 6);

  // Returning to 1x restores image-relative targeting.
  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  const natural = await readCamera(page);
  expect(natural.zoom).toBe(1);
  const naturalTopLeft = toScreen({ x: 0, y: 0 }, natural);
  expect(Math.abs(naturalTopLeft.y - CANVAS_PADDING_PX)).toBeLessThanOrEqual(1);

  // The screen-fixed panel shows the synchronized empty selection and never
  // moved during pan/zoom.
  const panel = page.getByTestId("capture-panel");
  await expect(panel).toContainText("Nothing selected.");
  await expect(panel).toContainText(`${doc.width} × ${doc.height} px`);
  // Screen-fixed: a canvas drag neither scrolls the page nor moves the
  // panel. Measure around the gesture with no scroll in between.
  pane = await visiblePane(page);
  const panelBox = await panel.boundingBox();
  await page.mouse.move(pane.left + pane.width / 2, pane.top + pane.height / 2);
  await page.mouse.down();
  await page.mouse.move(pane.left + pane.width / 2 + 120, pane.top + pane.height / 2 + 80, {
    steps: 3,
  });
  await page.mouse.up();
  expect(await panel.boundingBox()).toEqual(panelBox);

  // Camera and selection work is local UI state: zero mutations, zero
  // history entries, zero console errors.
  expect(mutations).toEqual([]);
  expect(page.url()).toBe(urlBefore);
  expect(await page.evaluate(() => history.length)).toBe(historyBefore);
  expect(consoleErrors).toEqual([]);
});

test("a hard reload restores the entire-capture initial camera", async ({ page }) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(120_000);

  await stubDispatchQuota(page);
  await signIn(page);

  const target = await findReadyTarget(page);
  test.skip(!target, "no ready capture in the local store");
  const doc = { width: target!.width, height: target!.height };

  const deviceName = `${target!.variant === "desktop" ? "Desktop" : "Mobile"} capture of ${target!.pageUrl}`;
  await page.getByRole("button", { name: deviceName, exact: true }).click();
  await expect(page.getByRole("img", { name: `Screenshot of ${target!.pageUrl}` })).toBeVisible();

  // Take the camera somewhere else, then reload: the camera is local state,
  // so the capture reopens in the entire-in-view default.
  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  expect((await readCamera(page)).zoom).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: deviceName, exact: true }).click();
  await expect(page.getByRole("img", { name: `Screenshot of ${target!.pageUrl}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entire page" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const pane = await paneRect(page);
  await waitForZoom(page, expectedContainZoom(pane, doc));
  await expectEntireCaptureVisible(page, doc);
});
