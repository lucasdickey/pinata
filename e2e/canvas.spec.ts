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

import { expect, test } from "@playwright/test";
import { CANVAS_MAX_ZOOM, CANVAS_PADDING_PX } from "../src/lib/canvas/camera";
import {
  expectedContainZoom,
  expectEntireCaptureVisible,
  findReadyTarget,
  openPlane,
  paneRect,
  planeButton,
  readCamera,
  signIn,
  toNatural,
  toScreen,
  trackConsoleErrors,
  visiblePane,
  waitForZoom,
} from "./canvas-session";
import { localEnvGate } from "./local-env";
import { stubDispatchQuota } from "./stub-dispatch";

const gate = localEnvGate(["EDITOR_PASSWORD", "SESSION_SECRET"]);

test.describe.configure({ mode: "serial" });

test("canvas camera modes, focal zoom, extents, and fixed panel", async ({ page }) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(180_000);

  const consoleErrors = trackConsoleErrors(page);

  await stubDispatchQuota(page);
  await signIn(page);

  const target = await findReadyTarget(page);
  test.skip(
    !target,
    "no ready capture with document dimensions exists in the local store (CI or fresh checkout)",
  );
  const doc = { width: target!.width, height: target!.height };

  // Select the target plane through the out-of-canvas navigation.
  await openPlane(page, target!);

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

  await openPlane(page, target!);

  // Take the camera somewhere else, then reload: the camera is local state,
  // so the capture reopens in the entire-in-view default.
  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  expect((await readCamera(page)).zoom).toBe(1);
  await page.reload();
  await planeButton(page, target!).click();
  await expect(page.getByRole("img", { name: `Screenshot of ${target!.pageUrl}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entire page" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const pane = await paneRect(page);
  await waitForZoom(page, expectedContainZoom(pane, doc));
  await expectEntireCaptureVisible(page, doc);
});
