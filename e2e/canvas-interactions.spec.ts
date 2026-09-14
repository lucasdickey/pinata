// End-to-end interaction contract for the canvas coordinate engine
// (VAL-CANVAS-003, VAL-CANVAS-006, VAL-CANVAS-008, D074): no modes — a
// press that moves pans and a click drops exactly one draft at the clicked
// natural pixel with the composer beside it; grab-offset dragging with
// inclusive frame clamps; per-capture session cameras; plane isolation for
// transient drafts; and touch pan / focal pinch / tap placement via trusted
// CDP touch input.
//
// Runs against the seeded local store like canvas.spec.ts and skips when no
// ready capture exists. Drafts are local UI state, so nothing here creates
// server data; the network assertions prove the gestures stay write-free.

import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { CANVAS_MAX_ZOOM } from "../src/lib/canvas/camera";
import {
  expectedContainZoom,
  findClearAim,
  findReadyTarget,
  openPlane,
  panUntilNaturalVisible,
  clickPlane,
  readCamera,
  signIn,
  toNatural,
  toScreen,
  trackConsoleErrors,
  visiblePane,
  waitForZoom,
  type ReadyTarget,
  type Viewport,
} from "./canvas-session";
import { localEnvGate } from "./local-env";
import { stubDispatchQuota } from "./stub-dispatch";

const gate = localEnvGate(["EDITOR_PASSWORD", "SESSION_SECRET"]);

test.describe.configure({ mode: "serial" });

const DRAFT = ".react-flow__node-draftPin";
const BADGE = '[data-testid="draft-pin-badge"]';

/** The badge's rendered tip in browser-viewport screen coordinates. */
async function badgeTipScreen(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(BADGE).boundingBox();
  if (!box) throw new Error("no draft pin badge rendered");
  // The badge anchors its bottom-center on the canonical tip.
  return { x: box.x + box.width / 2, y: box.y + box.height };
}

/** The badge tip inverse-transformed to screenshot-natural coordinates. */
async function badgeTipNatural(page: Page): Promise<{ x: number; y: number }> {
  const [tip, camera, pane] = await Promise.all([
    badgeTipScreen(page),
    readCamera(page),
    visiblePane(page),
  ]);
  return toNatural({ x: tip.x - pane.left, y: tip.y - pane.top }, camera);
}

/** A screen point inside the pane that maps inside the document. */
async function placeablePoint(
  page: Page,
  doc: { width: number; height: number },
): Promise<{ screen: { x: number; y: number }; natural: { x: number; y: number } }> {
  const [pane, camera] = await Promise.all([visiblePane(page), readCamera(page)]);
  const paneLocal = { x: pane.width / 2, y: pane.height / 2 };
  const natural = toNatural(paneLocal, camera);
  if (natural.x < 0 || natural.y < 0 || natural.x > doc.width || natural.y > doc.height) {
    throw new Error(`pane center maps outside the document: ${JSON.stringify(natural)}`);
  }
  return { screen: { x: pane.left + paneLocal.x, y: pane.top + paneLocal.y }, natural };
}

/** Wait until the live camera stops moving (autopan can outlive a fling). */
async function waitCameraSettled(page: Page): Promise<void> {
  let prev = await readCamera(page);
  for (let i = 0; i < 30; i += 1) {
    await page.waitForTimeout(80);
    const current = await readCamera(page);
    if (current.x === prev.x && current.y === prev.y && current.zoom === prev.zoom) return;
    prev = current;
  }
}

/** Wheel to the deepest zoom, focused on the pane center. */
async function zoomToMax(page: Page): Promise<Viewport> {
  let camera = await readCamera(page);
  const pane = await visiblePane(page);
  for (let i = 0; i < 200 && camera.zoom < CANVAS_MAX_ZOOM; i += 1) {
    await page.mouse.move(pane.left + pane.width / 2, pane.top + pane.height / 2);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(25);
    camera = await readCamera(page);
  }
  return camera;
}

interface TrackedPage {
  mutations: string[];
  historyBefore: number;
  urlBefore: string;
}

/** Begin counting mutation requests and browser-history entries. */
async function trackWrites(page: Page): Promise<TrackedPage> {
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
  return {
    mutations,
    historyBefore: await page.evaluate(() => history.length),
    urlBefore: page.url(),
  };
}

async function expectNoWrites(page: Page, tracked: TrackedPage): Promise<void> {
  expect(tracked.mutations).toEqual([]);
  expect(page.url()).toBe(tracked.urlBefore);
  expect(await page.evaluate(() => history.length)).toBe(tracked.historyBefore);
}

interface TouchPoint {
  x: number;
  y: number;
  id: number;
}

async function touch(
  session: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  points: TouchPoint[],
): Promise<void> {
  await session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}

async function openDesktopPlane(page: Page): Promise<ReadyTarget> {
  await stubDispatchQuota(page);
  await signIn(page);
  const target = await findReadyTarget(page, "desktop");
  test.skip(!target, "no ready desktop capture in the local store");
  await openPlane(page, target!);
  return target!;
}

test("a drag pans and a click places exactly one draft at the clicked natural pixel, at 1x and 8x", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(180_000);

  const consoleErrors = trackConsoleErrors(page);

  const target = await openDesktopPlane(page);
  const doc = { width: target.width, height: target.height };
  const tracked = await trackWrites(page);

  // There is no mode to enter (D074): the toolbar holds camera controls
  // only, and the gesture itself is the intent.
  await expect(page.getByRole("button", { name: /place pin|navigate/i })).toHaveCount(0);

  // A press that moves past the placement slop pans the camera and creates
  // nothing.
  let aim = await placeablePoint(page, doc);
  const beforePan = await readCamera(page);
  await page.mouse.move(aim.screen.x, aim.screen.y);
  await page.mouse.down();
  await page.mouse.move(aim.screen.x + 80, aim.screen.y + 50, { steps: 6 });
  await page.mouse.up();
  const afterPan = await readCamera(page);
  expect(Math.hypot(afterPan.x - beforePan.x, afterPan.y - beforePan.y)).toBeGreaterThan(40);
  expect(afterPan.zoom).toBeCloseTo(beforePan.zoom, 6);
  await expect(page.locator(DRAFT)).toHaveCount(0);
  await expect(page.getByTestId("pin-composer")).toHaveCount(0);

  // 1x: one click creates exactly one draft whose rendered tip
  // inverse-transforms to the clicked natural pixel, and the composer opens
  // beside it with the comment focused. The seeded plane may already hold
  // persisted pins at the default pane center (the pins spec writes there),
  // and a click on a saved pin is selection, not placement — so pan a
  // pin-free aim into view first.
  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  await panUntilNaturalVisible(page, await findClearAim(page, target.captureId, doc));
  aim = await placeablePoint(page, doc);
  await page.mouse.click(aim.screen.x, aim.screen.y);
  await expect(page.locator(DRAFT)).toHaveCount(1);
  let measured = await badgeTipNatural(page);
  expect(Math.abs(measured.x - aim.natural.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(measured.y - aim.natural.y)).toBeLessThanOrEqual(1);
  const composer = page.getByTestId("pin-composer");
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel("Comment")).toBeFocused();
  // Screen-fixed and on screen: the popover box lies inside the window and
  // outside the transformed plane.
  const composerBox = await composer.boundingBox();
  const viewport = page.viewportSize()!;
  expect(composerBox!.x).toBeGreaterThanOrEqual(0);
  expect(composerBox!.y).toBeGreaterThanOrEqual(0);
  expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(viewport.width);
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(viewport.height);
  expect(await composer.evaluate((el) => el.closest(".react-flow") === null)).toBe(true);
  // The side panel keeps its own job: it never shows the draft.
  await expect(page.getByTestId("capture-panel")).toContainText("Nothing selected.");

  // A second click moves the same draft; it never stacks. The composer
  // follows the badge.
  const pane = await visiblePane(page);
  const secondScreen = { x: pane.left + pane.width / 3, y: pane.top + pane.height / 3 };
  const camera1x = await readCamera(page);
  const secondNatural = toNatural(
    { x: secondScreen.x - pane.left, y: secondScreen.y - pane.top },
    camera1x,
  );
  await page.mouse.click(secondScreen.x, secondScreen.y);
  await expect(page.locator(DRAFT)).toHaveCount(1);
  measured = await badgeTipNatural(page);
  expect(Math.abs(measured.x - secondNatural.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(measured.y - secondNatural.y)).toBeLessThanOrEqual(1);
  const movedBox = await composer.boundingBox();
  expect(movedBox).not.toEqual(composerBox);

  // Escape in the composer cancels the transient draft. (The composer sits
  // to the right of the badge and would otherwise cover the pane center the
  // wheel zoom below focuses on.)
  await page.keyboard.press("Escape");
  await expect(page.locator(DRAFT)).toHaveCount(0);
  await expect(composer).toHaveCount(0);

  // 8x: same contract at the deepest zoom.
  await zoomToMax(page);
  expect((await readCamera(page)).zoom).toBeGreaterThan(CANVAS_MAX_ZOOM / 2);
  aim = await placeablePoint(page, doc);
  await page.mouse.click(aim.screen.x, aim.screen.y);
  await expect(page.locator(DRAFT)).toHaveCount(1);
  measured = await badgeTipNatural(page);
  expect(Math.abs(measured.x - aim.natural.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(measured.y - aim.natural.y)).toBeLessThanOrEqual(1);
  await expect(composer).toBeVisible();

  // Escape cancels the transient draft; nothing was ever written.
  await page.keyboard.press("Escape");
  await expect(page.locator(DRAFT)).toHaveCount(0);
  await expect(composer).toHaveCount(0);
  await expect(page.getByTestId("capture-panel")).toContainText("Nothing selected.");
  await expectNoWrites(page, tracked);
  expect(consoleErrors).toEqual([]);
});

test("draft dragging preserves grab offset and clamps inclusively at the frame, at 8x", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(180_000);

  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  const target = await openDesktopPlane(page);
  const doc = { width: target.width, height: target.height };
  const tracked = await trackWrites(page);

  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  // Pan a pin-free aim to the pane center before zooming deep: the focal
  // zoom then keeps the placement target clear of any persisted pins.
  await panUntilNaturalVisible(page, await findClearAim(page, target.captureId, doc));
  await zoomToMax(page);
  const camera = await readCamera(page);
  expect(camera.zoom).toBeGreaterThan(CANVAS_MAX_ZOOM / 2);

  const aim = await placeablePoint(page, doc);
  await page.mouse.click(aim.screen.x, aim.screen.y);
  await expect(page.locator(DRAFT)).toHaveCount(1);

  // Grab the node off-center: the press point is NOT the tip, so any
  // pointer-down jump would show immediately. Grab points come from the node
  // wrapper's box (the hit area) — at clamped edges the badge extends past
  // the box, so badge-relative grabs can miss the node.
  const nodeBox1 = await page.locator(DRAFT).boundingBox();
  if (!nodeBox1) throw new Error("no draft pin node rendered");
  const grab = { x: nodeBox1.x + nodeBox1.width * 0.25, y: nodeBox1.y + nodeBox1.height * 0.3 };
  const tipBefore = await badgeTipNatural(page);

  // A short drag moves the tip by exactly the pointer delta (grab offset
  // preserved; one natural pixel of tolerance at 8x is 8 screen px, and the
  // pure transform is far tighter than that). Many small steps: d3-drag
  // anchors the gesture at the first move event, so a coarse first step
  // would be swallowed as tracking lag.
  const step = { x: 60, y: 45 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + step.x, grab.y + step.y, { steps: 24 });
  await page.waitForTimeout(120);
  const tipMid = await badgeTipNatural(page);
  const liveZoom = (await readCamera(page)).zoom;
  expect(Math.abs(tipMid.x - (tipBefore.x + step.x / liveZoom))).toBeLessThanOrEqual(1);
  expect(Math.abs(tipMid.y - (tipBefore.y + step.y / liveZoom))).toBeLessThanOrEqual(1);

  // A long drag past the bottom-right corner clamps the tip inclusively to
  // the document bounds — never outside, never lost. Small per-step waits:
  // a pointermove immediately followed by pointerup can be coalesced away,
  // and d3-drag never applies a final position on pointerup.
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(grab.x + step.x + (40_000 * i) / 6, grab.y + step.y + (400_000 * i) / 6);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await waitCameraSettled(page);
  await expect(page.locator(DRAFT)).toHaveCount(1);
  const clamped = await badgeTipNatural(page);
  expect(Math.abs(clamped.x - doc.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(clamped.y - doc.height)).toBeLessThanOrEqual(1);

  // The node box still honors the shared minimum screen hit target at 8x.
  const clampedBox = await page.locator(DRAFT).boundingBox();
  expect(clampedBox!.width).toBeGreaterThanOrEqual(24 - 0.5);

  // Top-left clamp too. The clamped badge sits at the far corner, off pane —
  // and pointer-down outside the browser viewport hits nothing — so pan the
  // camera (a press that moves) until the badge is back in view first. The
  // press starts in the top-left quarter of the pane: the draft's composer
  // is clamped into the frame's bottom-right corner while the badge is off
  // pane, and a press on it would not pan.
  for (let i = 0; i < 12; i += 1) {
    const pane = await visiblePane(page);
    const current = await readCamera(page);
    const cornerScreen = toScreen({ x: doc.width, y: doc.height }, current);
    const delta = {
      x: pane.width / 2 - cornerScreen.x,
      y: pane.height / 2 - cornerScreen.y,
    };
    if (Math.hypot(delta.x, delta.y) < 40) break;
    const press = { x: pane.left + pane.width / 4, y: pane.top + pane.height / 4 };
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(press.x + delta.x, press.y + delta.y, { steps: 4 });
    await page.mouse.up();
  }
  const badge2 = await page.locator(DRAFT).boundingBox();
  if (!badge2) throw new Error("draft pin node not visible after panning to the corner");
  await page.mouse.move(badge2.x + badge2.width / 2, badge2.y + badge2.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(badge2.x - (40_000 * i) / 6, badge2.y - (400_000 * i) / 6);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await waitCameraSettled(page);
  const clampedTopLeft = await badgeTipNatural(page);
  expect(Math.abs(clampedTopLeft.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(clampedTopLeft.y)).toBeLessThanOrEqual(1);

  // Reload stability: the transient draft is gone and no write ever left.
  await page.reload();
  await clickPlane(page, target);
  await expect(page.getByRole("img", { name: `Screenshot of ${target.pageUrl}` })).toBeVisible();
  await expect(page.locator(DRAFT)).toHaveCount(0);
  await expectNoWrites(page, tracked);
  expect(consoleErrors).toEqual([]);
});

test("planes keep separate cameras and never leak drafts", async ({ page }) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await stubDispatchQuota(page);
  await signIn(page);
  const desktop = await findReadyTarget(page, "desktop");
  const mobile = await findReadyTarget(page, "mobile");
  test.skip(!desktop || !mobile, "need a ready desktop and a ready mobile capture");
  const tracked = await trackWrites(page);

  // Desktop: natural-size camera plus a draft, placed at a pin-free aim so
  // a persisted pin badge can never swallow the tap.
  await openPlane(page, desktop!);
  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  await panUntilNaturalVisible(
    page,
    await findClearAim(page, desktop!.captureId, { width: desktop!.width, height: desktop!.height }),
  );
  const aim = await placeablePoint(page, { width: desktop!.width, height: desktop!.height });
  await page.mouse.click(aim.screen.x, aim.screen.y);
  await expect(page.locator(DRAFT)).toHaveCount(1);
  await expect(page.getByTestId("pin-composer")).toBeVisible();

  // Mobile (first visit): entire-capture camera, no draft or composer
  // leaked across.
  await openPlane(page, mobile!);
  await expect(page.locator(DRAFT)).toHaveCount(0);
  await expect(page.getByTestId("pin-composer")).toHaveCount(0);
  await expect(page.getByTestId("capture-panel")).toContainText("Nothing selected.");
  await expect(page.getByRole("button", { name: "Entire page" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const pane = await visiblePane(page);
  await waitForZoom(page, expectedContainZoom(pane, { width: mobile!.width, height: mobile!.height }));

  // Back to Desktop: its own camera is restored (natural size), and the
  // old draft did not follow it.
  await openPlane(page, desktop!);
  await waitForZoom(page, 1);
  await expect(page.getByRole("button", { name: "Natural size" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(DRAFT)).toHaveCount(0);
  await expect(page.getByTestId("capture-panel")).toContainText("Nothing selected.");

  // A zoom-BUTTON gesture is also a camera takeover: the exact zoomed
  // camera must survive a plane switch, not fall back to the named mode's
  // re-applied camera (caught by manual verification: programmatic zoom
  // carries no source event, so resize-follow silently stayed on).
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  const buttonZoomed = await readCamera(page);
  expect(buttonZoomed.zoom).toBeGreaterThan(1);
  await openPlane(page, mobile!);
  const mobilePane = await visiblePane(page);
  await waitForZoom(
    page,
    expectedContainZoom(mobilePane, { width: mobile!.width, height: mobile!.height }),
  );
  await openPlane(page, desktop!);
  await waitForZoom(page, buttonZoomed.zoom);
  const restored = await readCamera(page);
  expect(Math.abs(restored.x - buttonZoomed.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(restored.y - buttonZoomed.y)).toBeLessThanOrEqual(1);

  await expectNoWrites(page, tracked);
  expect(consoleErrors).toEqual([]);
});

// Touch gestures need a touch-capable context: d3-zoom (React Flow's
// pan/pinch engine) ignores touch input entirely unless the browser reports
// touch support (`navigator.maxTouchPoints > 0`), which headless Chromium
// only does with hasTouch enabled.
test.describe("touch input", () => {
  test.use({ hasTouch: true });

test("touch: one-finger pan, focal pinch, tap placement, and grab-offset drag", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(180_000);

  const consoleErrors = trackConsoleErrors(page);

  const target = await openDesktopPlane(page);
  const doc = { width: target.width, height: target.height };
  const tracked = await trackWrites(page);
  const session = await page.context().newCDPSession(page);

  // One-finger touch drag pans in navigation mode and creates nothing.
  let pane = await visiblePane(page);
  const center = { x: pane.left + pane.width / 2, y: pane.top + pane.height / 2 };
  const before = await readCamera(page);
  await touch(session, "touchStart", [{ x: center.x, y: center.y, id: 1 }]);
  for (let i = 1; i <= 6; i += 1) {
    await touch(session, "touchMove", [{ x: center.x + i * 25, y: center.y + i * 15, id: 1 }]);
    await page.waitForTimeout(20);
  }
  await touch(session, "touchEnd", []);
  await page.waitForTimeout(150);
  const panned = await readCamera(page);
  expect(Math.hypot(panned.x - before.x, panned.y - before.y)).toBeGreaterThan(50);
  expect(panned.zoom).toBeCloseTo(before.zoom, 6);
  await expect(page.locator(DRAFT)).toHaveCount(0);

  // Two-finger pinch spreads around a fixed centroid: the natural pixel
  // under the centroid stays there within the contract tolerance.
  const pinchCenter = { x: center.x, y: center.y };
  for (const radius of [40, 70, 110, 160]) {
    const camera = await readCamera(page);
    const focalNatural = toNatural(
      { x: pinchCenter.x - pane.left, y: pinchCenter.y - pane.top },
      camera,
    );
    const points: TouchPoint[] = [
      { x: pinchCenter.x - radius, y: pinchCenter.y, id: 1 },
      { x: pinchCenter.x + radius, y: pinchCenter.y, id: 2 },
    ];
    await touch(session, radius === 40 ? "touchStart" : "touchMove", points);
    await page.waitForTimeout(60);
    const after = await readCamera(page);
    const focalScreen = toScreen(focalNatural, after);
    const tolerance = Math.max(2, after.zoom);
    expect(
      Math.abs(focalScreen.x - (pinchCenter.x - pane.left)),
      `pinch focal x at zoom ${after.zoom}`,
    ).toBeLessThanOrEqual(tolerance);
    expect(
      Math.abs(focalScreen.y - (pinchCenter.y - pane.top)),
      `pinch focal y at zoom ${after.zoom}`,
    ).toBeLessThanOrEqual(tolerance);
  }
  await touch(session, "touchEnd", []);
  const zoomed = await readCamera(page);
  expect(zoomed.zoom).toBeGreaterThan(before.zoom * 1.5);
  await expect(page.locator(DRAFT)).toHaveCount(0);

  // A second pinch, narrowing this time, still creates no mark: a gesture
  // that moves is never a placement.
  pane = await visiblePane(page);
  const mid = { x: pane.left + pane.width / 2, y: pane.top + pane.height / 2 };
  await touch(session, "touchStart", [
    { x: mid.x - 120, y: mid.y, id: 1 },
    { x: mid.x + 120, y: mid.y, id: 2 },
  ]);
  await touch(session, "touchMove", [
    { x: mid.x - 50, y: mid.y, id: 1 },
    { x: mid.x + 50, y: mid.y, id: 2 },
  ]);
  await touch(session, "touchEnd", []);
  await page.waitForTimeout(150);
  await expect(page.locator(DRAFT)).toHaveCount(0);

  // One calibrated tap creates exactly one draft at the tapped natural
  // pixel. Reset to the contain view first so the tap target is a
  // deterministic on-document point regardless of where the pinch settled —
  // and pick a pin-free aim, since a tap on a saved pin is selection.
  await page.getByRole("button", { name: "Entire page" }).click();
  await waitForZoom(page, expectedContainZoom(await visiblePane(page), doc));
  pane = await visiblePane(page);
  const tapCamera = await readCamera(page);
  const tapNatural = await findClearAim(page, target.captureId, doc);
  const tapAimScreen = toScreen(tapNatural, tapCamera);
  const tapMid = { x: pane.left + tapAimScreen.x, y: pane.top + tapAimScreen.y };
  expect(tapNatural.x).toBeGreaterThanOrEqual(0);
  expect(tapNatural.x).toBeLessThanOrEqual(doc.width);
  expect(tapNatural.y).toBeGreaterThanOrEqual(0);
  expect(tapNatural.y).toBeLessThanOrEqual(doc.height);
  await touch(session, "touchStart", [{ x: tapMid.x, y: tapMid.y, id: 1 }]);
  await page.waitForTimeout(40);
  await touch(session, "touchEnd", []);
  await expect(page.locator(DRAFT)).toHaveCount(1);
  await expect(page.getByTestId("pin-composer")).toBeVisible();
  const tappedTip = await badgeTipNatural(page);
  expect(Math.abs(tappedTip.x - tapNatural.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(tappedTip.y - tapNatural.y)).toBeLessThanOrEqual(1);

  // Touch-drag the draft off-center: grab offset preserved (the tip tracks
  // the finger delta 1:1), then a fling past the corner clamps.
  const nodeBox = await page.locator(DRAFT).boundingBox();
  if (!nodeBox) throw new Error("no draft pin node");
  const grab = { x: nodeBox.x + nodeBox.width * 0.7, y: nodeBox.y + nodeBox.height * 0.25 };
  const tipBefore = await badgeTipNatural(page);
  const zoom = (await readCamera(page)).zoom;
  // The compositor frame-aligns and coalesces synthetic touchmove events, so
  // the test cannot rely on every dispatched move being delivered. Instead
  // it records the moves the page actually received and asserts the tip
  // tracked them 1:1 from the gesture anchor: the touchstart point itself,
  // since drags anchor at pointer-down (D062, nodeDragThreshold=0).
  await page.evaluate(() => {
    (window as unknown as { __touchTrail?: [number, number][] }).__touchTrail = [];
    window.addEventListener(
      "touchmove",
      (event) => {
        const t = (event as TouchEvent).touches[0];
        if (t) {
          (window as unknown as { __touchTrail: [number, number][] }).__touchTrail.push([
            t.clientX,
            t.clientY,
          ]);
        }
      },
      { capture: true },
    );
  });
  await touch(session, "touchStart", [{ x: grab.x, y: grab.y, id: 1 }]);
  await page.waitForTimeout(60);
  const d = { x: 48, y: 30 };
  for (let i = 1; i <= 10; i += 1) {
    await touch(session, "touchMove", [
      { x: grab.x + (d.x * i) / 10, y: grab.y + (d.y * i) / 10, id: 1 },
    ]);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(150);
  const trail = await page.evaluate(
    () => (window as unknown as { __touchTrail: [number, number][] }).__touchTrail,
  );
  expect(trail.length).toBeGreaterThanOrEqual(2);
  const tipMid = await badgeTipNatural(page);
  const deliveredDelta = {
    x: (trail[trail.length - 1]![0] - grab.x) / zoom,
    y: (trail[trail.length - 1]![1] - grab.y) / zoom,
  };
  expect(Math.abs(tipMid.x - (tipBefore.x + deliveredDelta.x))).toBeLessThanOrEqual(1);
  expect(Math.abs(tipMid.y - (tipBefore.y + deliveredDelta.y))).toBeLessThanOrEqual(1);
  // The fling is a short series, not one move: a lone synthetic touchmove
  // can be frame-coalesced away, and every step here clamps identically.
  for (let i = 1; i <= 4; i += 1) {
    await touch(session, "touchMove", [
      { x: grab.x + 10_000 * i, y: grab.y + 100_000 * i, id: 1 },
    ]);
    await page.waitForTimeout(60);
  }
  await touch(session, "touchEnd", []);
  await waitCameraSettled(page);
  const clamped = await badgeTipNatural(page);
  expect(Math.abs(clamped.x - doc.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(clamped.y - doc.height)).toBeLessThanOrEqual(1);

  // All of it was local: zero writes, zero history entries, zero errors.
  await expectNoWrites(page, tracked);
  expect(consoleErrors).toEqual([]);
});
});
