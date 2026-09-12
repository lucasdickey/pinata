// End-to-end contract for persisted numbered pins (VAL-CANVAS-001,
// VAL-CANVAS-009, VAL-PIN-001): one click on the screenshot (no mode to
// enter first, D074) plus a comment and Save creates exactly one
// server-persisted pin whose rendered tip inverse-transforms to the
// clicked natural pixel at 1x and 8x; numbers
// are monotonic per capture and cancelled drafts consume none; camera-only
// work writes nothing; a pin drag commits exactly one revisioned move with
// the grab offset preserved and inclusive frame clamps; and everything
// survives reload and plane switches without remapping.
//
// Runs against the seeded local store like canvas-interactions.spec.ts and
// skips when no ready capture exists. These tests write real pins to the
// seeded Chickpea desktop capture by design: the bottom-right corner pin is
// the fixture landmark the canvas-shell handoff asked for (the deep-zoom
// corner is plain footer background, so a numbered pin there makes future
// regression screenshots informative). The fixture pin is reused across
// runs by its body prefix; the other tests add at most three pins per run,
// far below MAX_ANNOTATIONS_PER_CAPTURE.

import { expect, test, type Page } from "@playwright/test";
import { CANVAS_MAX_ZOOM } from "../src/lib/canvas/camera";
import {
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
} from "./canvas-session";
import { localEnvGate } from "./local-env";
import { stubDispatchQuota } from "./stub-dispatch";

const gate = localEnvGate(["EDITOR_PASSWORD", "SESSION_SECRET"]);

test.describe.configure({ mode: "serial" });

const PIN_NODE = ".react-flow__node-pin";
const PIN_BADGE = '[data-testid="pin-badge"]';
const FIXTURE_BODY_PREFIX = "e2e: corner fixture";

interface PinRecord {
  id: string;
  kind?: "pin" | "rectangle";
  number: number;
  tip: { x: number; y: number };
  /** A rectangle's box (D079); absent on pins. */
  rect?: { x: number; y: number; width: number; height: number };
  body: string;
  revision: number;
}

/** This capture's live pins, read straight from the annotations route. */
async function listPins(page: Page, captureId: string): Promise<PinRecord[]> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/captures/${encodeURIComponent(id)}/annotations`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`annotations list failed: ${response.status}`);
    const payload = (await response.json()) as { annotations: PinRecord[] };
    return payload.annotations.sort((a, b) => a.number - b.number);
  }, captureId);
}

/** Delete one mark straight through the revisioned route (test cleanup). */
async function deleteMark(page: Page, captureId: string, mark: PinRecord): Promise<void> {
  await page.evaluate(
    async ({ id, annotationId, revision }) => {
      const csrf =
        document.cookie
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("pinata_csrf="))
          ?.slice("pinata_csrf=".length) ?? "";
      const response = await fetch(
        `/api/captures/${encodeURIComponent(id)}/annotations/${encodeURIComponent(annotationId)}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json", "x-pinata-csrf": csrf },
          body: JSON.stringify({ expectedRevision: revision }),
        },
      );
      if (!response.ok) throw new Error(`cleanup delete failed: ${response.status}`);
    },
    { id: captureId, annotationId: mark.id, revision: mark.revision },
  );
}

/**
 * Wait for the pin a test just created and return it. Ids — not numbers —
 * identify it: numbering is monotonic across tombstones (deleted numbers
 * stay retired), so "live max + 1" is unreliable once deletes exist.
 */
async function awaitNewPin(
  page: Page,
  captureId: string,
  before: PinRecord[],
): Promise<PinRecord> {
  const beforeIds = new Set(before.map((pin) => pin.id));
  let found: PinRecord | undefined;
  await expect
    .poll(async () => {
      found = (await listPins(page, captureId)).find((pin) => !beforeIds.has(pin.id));
      return found !== undefined;
    })
    .toBe(true);
  return found!;
}

/** Wait until the workspace has finished loading this plane's pins. */
async function waitPinsLoaded(page: Page): Promise<void> {
  // The panel renders nothing pins-related until the fetch resolves, then
  // either the empty note or numbered list entries (pins or boxes). A load
  // failure renders a different note, so this wait fails loudly instead of
  // passing early.
  await expect(page.getByTestId("capture-panel")).toContainText(
    /No pins yet\.|(Pin|Box) \d+ — at \(/,
  );
}

/** The badge for a saved pin number, and its draggable node wrapper. */
function pinBadge(page: Page, number: number) {
  return page.locator(`${PIN_BADGE}[data-pin-number="${number}"]`);
}
function pinNode(page: Page, number: number) {
  return page.locator(PIN_NODE, { has: pinBadge(page, number) });
}

/** A rendered pin badge's tip in screenshot-natural coordinates. */
async function pinTipNatural(
  page: Page,
  number: number,
): Promise<{ x: number; y: number; zoom: number }> {
  // Re-anchor BEFORE measuring: visiblePane scrolls the pane into view, and
  // a bounding box captured before that scroll would be stale by exactly
  // the scroll delta (viewport-relative coordinates).
  const pane = await visiblePane(page);
  const [box, camera] = await Promise.all([pinBadge(page, number).boundingBox(), readCamera(page)]);
  if (!box) throw new Error(`pin ${number} badge not rendered`);
  const tip = toNatural(
    { x: box.x + box.width / 2 - pane.left, y: box.y + box.height - pane.top },
    camera,
  );
  return { ...tip, zoom: camera.zoom };
}

/**
 * Render-tolerance: at zoom z one screen pixel spans 1/z natural pixels, so
 * a sub-screen-pixel measurement error grows as the camera zooms out. The
 * strict ≤1-natural-pixel contract is asserted at 1x and 8x only.
 */
async function expectRenderedTip(
  page: Page,
  number: number,
  expected: { x: number; y: number },
  strict: boolean,
): Promise<void> {
  const measured = await pinTipNatural(page, number);
  const slack = strict ? 0 : 1 / measured.zoom;
  expect(Math.abs(measured.x - expected.x), `pin ${number} tip x`).toBeLessThanOrEqual(1 + slack);
  expect(Math.abs(measured.y - expected.y), `pin ${number} tip y`).toBeLessThanOrEqual(1 + slack);
}

/** Wheel to the deepest zoom, focused on the pane center. */
async function zoomToMax(page: Page): Promise<void> {
  let camera = await readCamera(page);
  const pane = await visiblePane(page);
  for (let i = 0; i < 200 && camera.zoom < CANVAS_MAX_ZOOM; i += 1) {
    await page.mouse.move(pane.left + pane.width / 2, pane.top + pane.height / 2);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(25);
    camera = await readCamera(page);
  }
}

/**
 * Click a natural point to drop one draft and save it with a comment. The
 * screen point is computed right after re-anchoring the pane so it lands
 * exactly on the intended pixel.
 */
async function placeAndSave(
  page: Page,
  natural: { x: number; y: number },
  doc: { width: number; height: number },
  body: string,
  expectedPinCount: number,
): Promise<void> {
  const [pane, camera] = await Promise.all([visiblePane(page), readCamera(page)]);
  const local = toScreen(natural, camera);
  expect(local.x, "placement x maps on-document").toBeGreaterThanOrEqual(0);
  expect(local.y, "placement y maps on-document").toBeGreaterThanOrEqual(0);
  expect(natural.x).toBeGreaterThanOrEqual(0);
  expect(natural.y).toBeGreaterThanOrEqual(0);
  expect(natural.x).toBeLessThanOrEqual(doc.width);
  expect(natural.y).toBeLessThanOrEqual(doc.height);
  if (local.x < 0 || local.y < 0 || local.x > pane.width || local.y > pane.height) {
    throw new Error(`placement point is off-pane: ${JSON.stringify({ local, natural })}`);
  }
  await page.mouse.click(pane.left + local.x, pane.top + local.y);
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(1);
  await expect(page.getByTestId("pin-composer")).toBeVisible();
  // Wait for the composer's quiescent marker before touching any control
  // inside it: the async candidates render once detached a control
  // mid-click under full-gate CPU contention. The generous timeout covers
  // a slow candidates round trip under full-gate load, not a behavior
  // change.
  await expect(page.getByTestId("draft-context")).toHaveAttribute(
    "data-candidates-state",
    /ready|failed/,
    { timeout: 15_000 },
  );
  await page.getByLabel("Comment").fill(body);
  // The top-ranked nearby element is pre-selected (D074); these specs
  // annotate background, so No element is the honest choice.
  await page.getByRole("button", { name: "No element" }).click();
  await page.getByRole("button", { name: "Save pin" }).click();
  await expect(page.locator(PIN_NODE)).toHaveCount(expectedPinCount);
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(0);
}

/** Count annotation-mutating requests from this point on. */
function trackAnnotationWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.method() !== "HEAD" &&
      request.url().includes("/annotations")
    ) {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });
  return writes;
}

async function openDesktopPlane(page: Page): Promise<ReadyTarget> {
  await stubDispatchQuota(page);
  await signIn(page);
  const target = await findReadyTarget(page, "desktop");
  test.skip(!target, "no ready desktop capture in the local store");
  await openPlane(page, target!);
  await waitPinsLoaded(page);
  return target!;
}

test("a saved corner pin holds its natural pixel across reload and plane switches (VAL-CANVAS-001)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(240_000);

  const consoleErrors = trackConsoleErrors(page);
  const target = await openDesktopPlane(page);
  const doc = { width: target.width, height: target.height };

  // The page documents itself (VAL-CANVAS-009, D074): one line under the
  // canvas names the three verbs, and there is no mode toggle to find.
  const hint = page.locator(".workspace-hint");
  await expect(hint).toContainText("drop a pin");
  await expect(hint).toContainText("drag a pin to move it");
  await expect(hint).toContainText("read or reply");
  await expect(page.getByRole("button", { name: /place pin|navigate/i })).toHaveCount(0);

  const before = await listPins(page, target.captureId);
  const writes = trackAnnotationWrites(page);

  // Near the bottom-right corner: plain footer background, so the numbered
  // landmark reads clearly in regression screenshots.
  const corner = { x: doc.width - 40, y: doc.height - 60 };
  const existing = before.find((pin) => pin.body.startsWith(FIXTURE_BODY_PREFIX));

  let fixtureNumber: number;
  if (existing) {
    fixtureNumber = existing.number;
  } else {
    await page.getByRole("button", { name: "Natural size" }).click();
    await waitForZoom(page, 1);
    await panUntilNaturalVisible(page, corner);
    await placeAndSave(
      page,
      corner,
      doc,
      `${FIXTURE_BODY_PREFIX} — bottom-right landmark of ${target.pageUrl}`,
      before.length + 1,
    );
    // Exactly one create, and the strict 1x tip contract.
    expect(writes.filter((w) => w.startsWith("POST "))).toHaveLength(1);
    const fixture = await awaitNewPin(page, target.captureId, before);
    fixtureNumber = fixture.number;
    expect(Math.abs(fixture.tip.x - corner.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(fixture.tip.y - corner.y)).toBeLessThanOrEqual(1);
    await expectRenderedTip(page, fixtureNumber, corner, true);
    // The panel lists the pin and opens its comment.
    await page.getByRole("button", { name: new RegExp(`Pin ${fixtureNumber} —`) }).click();
    await expect(page.getByTestId("panel-pin")).toContainText(FIXTURE_BODY_PREFIX);
  }

  // Reload: the server record is byte-identical and the badge renders it.
  const beforeReload = await listPins(page, target.captureId);
  await page.reload();
  await clickPlane(page, target);
  await expect(
    page.getByRole("img", { name: `Screenshot of ${target.pageUrl}` }),
  ).toBeVisible();
  await waitPinsLoaded(page);
  const afterReload = await listPins(page, target.captureId);
  expect(afterReload).toEqual(beforeReload);
  await expect(pinBadge(page, fixtureNumber)).toBeVisible();
  const persisted = afterReload.find((pin) => pin.number === fixtureNumber)!;
  await expectRenderedTip(page, fixtureNumber, persisted.tip, false);

  // Plane isolation: the mobile plane renders exactly its own list.
  const mobile = await findReadyTarget(page, "mobile");
  if (mobile) {
    await openPlane(page, mobile);
    await waitPinsLoaded(page);
    const mobilePins = await listPins(page, mobile.captureId);
    await expect(page.locator(PIN_NODE)).toHaveCount(mobilePins.length);
    if (mobilePins.length === 0) {
      await expect(page.getByTestId("capture-panel")).toContainText("No pins yet.");
    }
    // And back: the desktop plane's pins return unmutated and unremapped.
    await openPlane(page, target);
    await waitPinsLoaded(page);
    await expect(page.locator(PIN_NODE)).toHaveCount(afterReload.length);
    await expectRenderedTip(page, fixtureNumber, persisted.tip, false);
  }

  // Nothing but the (possible) single fixture create ever wrote.
  expect(writes.filter((w) => w.startsWith("POST "))).toHaveLength(existing ? 0 : 1);
  expect(writes.filter((w) => !w.startsWith("POST "))).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("pins placed at 8x hold the tip contract and numbering is monotonic (VAL-PIN-001)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(240_000);

  const consoleErrors = trackConsoleErrors(page);
  const target = await openDesktopPlane(page);
  const doc = { width: target.width, height: target.height };
  const before = await listPins(page, target.captureId);
  const maxBefore = before.reduce((max, pin) => Math.max(max, pin.number), 0);
  const writes = trackAnnotationWrites(page);

  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  // Earlier runs of this spec leave pins near the default pane center by
  // design; this spec writes into the bottom band (see findClearAim) so its
  // pins never collide with the gesture specs' middle-band aims, and pan a
  // pin-free aim into view so the placement tap can never land on an
  // existing badge (a tap on a saved pin is selection).
  await panUntilNaturalVisible(
    page,
    await findClearAim(page, target.captureId, doc, { from: 0.88, to: 0.97 }),
  );
  await zoomToMax(page);
  const camera = await readCamera(page);
  expect(camera.zoom).toBeGreaterThan(CANVAS_MAX_ZOOM / 2);

  // First pin at 8x: a fresh number clearing every live number (numbering
  // is monotonic across tombstones; the exact all-rows max+1 assignment is
  // asserted in the route tests), tip within one natural px.
  const pane1 = await visiblePane(page);
  const camera1 = await readCamera(page);
  const aim1 = toNatural({ x: pane1.width / 2, y: pane1.height / 2 }, camera1);
  await placeAndSave(page, aim1, doc, "e2e: numbering A (8x placement)", before.length + 1);
  const first = await awaitNewPin(page, target.captureId, before);
  expect(first.number, "first pin clears every live number").toBeGreaterThan(maxBefore);
  expect(Math.abs(first.tip.x - aim1.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(first.tip.y - aim1.y)).toBeLessThanOrEqual(1);
  await expectRenderedTip(page, first.number, aim1, true);

  // A cancelled draft consumes no number and writes nothing. The tap must
  // land on the document but not on the pin just saved (pane center), so
  // use an off-center point verified to map on-document.
  const writesBeforeCancel = writes.length;
  const paneC = await visiblePane(page);
  const camC = await readCamera(page);
  const cancelNatural = toNatural({ x: paneC.width / 3, y: paneC.height / 3 }, camC);
  expect(cancelNatural.x, "cancel tap on-document x").toBeGreaterThanOrEqual(0);
  expect(cancelNatural.y, "cancel tap on-document y").toBeGreaterThanOrEqual(0);
  expect(cancelNatural.x, "cancel tap on-document x").toBeLessThanOrEqual(doc.width);
  expect(cancelNatural.y, "cancel tap on-document y").toBeLessThanOrEqual(doc.height);
  await page.mouse.click(paneC.left + paneC.width / 3, paneC.top + paneC.height / 3);
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(1);
  await expect(page.getByTestId("pin-composer")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(0);
  await expect(page.getByTestId("pin-composer")).toHaveCount(0);
  await expect(page.getByTestId("capture-panel")).toContainText("Nothing selected.");
  expect(writes).toHaveLength(writesBeforeCancel);

  // The next save gets the very next number — the cancelled draft left no gap.
  const pane2 = await visiblePane(page);
  const camera2 = await readCamera(page);
  const aim2 = toNatural({ x: (pane2.width * 2) / 3, y: (pane2.height * 2) / 3 }, camera2);
  await placeAndSave(page, aim2, doc, "e2e: numbering B (after a cancelled draft)", before.length + 2);
  const second = await awaitNewPin(page, target.captureId, [...before, first]);
  expect(second.number, "cancelled draft consumed no number").toBe(first.number + 1);
  const after = await listPins(page, target.captureId);
  expect(after.map((pin) => pin.number)).toEqual(
    [...before.map((pin) => pin.number), first.number, second.number].sort((a, b) => a - b),
  );
  await expectRenderedTip(page, second.number, aim2, true);

  // Camera-only work — pan, wheel zoom, mode buttons, zoom buttons — never
  // writes (VAL-CANVAS-006). Pins are draggable in the only state there is,
  // so the pan press must start on clear background: pin A sits at the pane
  // center and pin B at two thirds, so press at (one third, two thirds).
  const writesBeforeCamera = writes.length;
  const paneCam = await visiblePane(page);
  await page.mouse.move(paneCam.left + paneCam.width / 3, paneCam.top + (paneCam.height * 2) / 3);
  await page.mouse.down();
  await page.mouse.move(paneCam.left + paneCam.width / 6, paneCam.top + paneCam.height / 3, {
    steps: 6,
  });
  await page.mouse.up();
  await page.mouse.wheel(0, 480);
  await page.getByRole("button", { name: "Entire page" }).click();
  await page.getByRole("button", { name: "Fit width" }).click();
  await page.getByRole("button", { name: "Natural size" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.waitForTimeout(300);
  expect(writes).toHaveLength(writesBeforeCamera);

  // Exactly two creates happened in this whole test.
  expect(writes.filter((w) => w.startsWith("POST "))).toHaveLength(2);
  expect(consoleErrors).toEqual([]);
});

test("dragging a saved pin commits exactly one move with grab offset and clamps (VAL-PIN-001)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(240_000);

  const consoleErrors = trackConsoleErrors(page);
  const target = await openDesktopPlane(page);
  const doc = { width: target.width, height: target.height };
  const before = await listPins(page, target.captureId);
  const writes = trackAnnotationWrites(page);

  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  await panUntilNaturalVisible(
    page,
    await findClearAim(page, target.captureId, doc, { from: 0.88, to: 0.97 }),
  );
  const pane = await visiblePane(page);
  const camera = await readCamera(page);
  const aim = toNatural({ x: pane.width / 2, y: pane.height / 2 }, camera);
  await placeAndSave(page, aim, doc, "e2e: drag commit (grab offset and clamps)", before.length + 1);
  const saved = await awaitNewPin(page, target.captureId, before);
  const number = saved.number;
  expect(Math.abs(saved.tip.x - aim.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(saved.tip.y - aim.y)).toBeLessThanOrEqual(1);

  // Grab the node off-center and drag: one PATCH at drag end, tip moved by
  // exactly the pointer delta (grab offset preserved), revision bumped.
  // Re-anchor first: clicking Save scrolled the panel (and its candidate
  // list) into view, which pushes the canvas up — a bounding box measured
  // without scrolling the pane back would be off-window, and the drag would
  // hit nothing.
  await visiblePane(page);
  const nodeBox = await pinNode(page, number).boundingBox();
  if (!nodeBox) throw new Error("saved pin node not rendered");
  const grab = { x: nodeBox.x + nodeBox.width * 0.25, y: nodeBox.y + nodeBox.height * 0.3 };
  const step = { x: 60, y: 45 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + step.x, grab.y + step.y, { steps: 24 });
  await page.mouse.up();
  await expect
    .poll(async () => writes.filter((w) => w.startsWith("PATCH ")).length, {
      timeout: 10_000,
    })
    .toBe(1);
  const zoom = (await readCamera(page)).zoom;
  const movedTip = { x: aim.x + step.x / zoom, y: aim.y + step.y / zoom };
  // The request firing is not the commit: poll the authoritative list until
  // the revisioned write lands.
  await expect
    .poll(
      async () =>
        (await listPins(page, target.captureId)).find((pin) => pin.number === number)?.revision,
      { timeout: 10_000 },
    )
    .toBe(saved.revision + 1);
  const moved = (await listPins(page, target.captureId)).find((pin) => pin.number === number)!;
  // Drag tolerance: one natural pixel of transform math plus one screen
  // pixel of pointer granularity (1/zoom natural px at the live zoom).
  expect(Math.abs(moved.tip.x - movedTip.x)).toBeLessThanOrEqual(1 + 1 / zoom);
  expect(Math.abs(moved.tip.y - movedTip.y)).toBeLessThanOrEqual(1 + 1 / zoom);

  // A long drag past the top-left corner clamps inclusively to (0, 0) and
  // commits exactly one more write — never an out-of-bounds tip.
  await visiblePane(page);
  const nodeBox2 = await pinNode(page, number).boundingBox();
  if (!nodeBox2) throw new Error("saved pin node not rendered after move");
  await page.mouse.move(nodeBox2.x + nodeBox2.width / 2, nodeBox2.y + nodeBox2.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(
      nodeBox2.x + nodeBox2.width / 2 - (40_000 * i) / 6,
      nodeBox2.y + nodeBox2.height / 2 - (400_000 * i) / 6,
    );
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await expect
    .poll(async () => writes.filter((w) => w.startsWith("PATCH ")).length, {
      timeout: 10_000,
    })
    .toBe(2);
  await expect
    .poll(
      async () =>
        (await listPins(page, target.captureId)).find((pin) => pin.number === number)?.revision,
      { timeout: 10_000 },
    )
    .toBe(saved.revision + 2);
  const clamped = (await listPins(page, target.captureId)).find((pin) => pin.number === number)!;
  expect(Math.abs(clamped.tip.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(clamped.tip.y)).toBeLessThanOrEqual(1);

  // Reload stability: the clamped tip is exactly what the server kept.
  await page.reload();
  await clickPlane(page, target);
  await expect(
    page.getByRole("img", { name: `Screenshot of ${target.pageUrl}` }),
  ).toBeVisible();
  await waitPinsLoaded(page);
  const reloaded = (await listPins(page, target.captureId)).find((pin) => pin.number === number)!;
  expect(reloaded.tip).toEqual(clamped.tip);
  expect(reloaded.revision).toBe(clamped.revision);
  await expect(pinBadge(page, number)).toBeVisible();
  await expectRenderedTip(page, number, clamped.tip, false);

  // One create, two moves — nothing else ever wrote.
  expect(writes.filter((w) => w.startsWith("POST "))).toHaveLength(1);
  expect(writes).toHaveLength(3);
  expect(consoleErrors).toEqual([]);
});

test("the Draw a box toggle arms one drag; the box shares the pin numbering and holds its natural pixels (D079)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(240_000);

  const consoleErrors = trackConsoleErrors(page);
  const target = await openDesktopPlane(page);
  const doc = { width: target.width, height: target.height };
  const before = await listPins(page, target.captureId);
  const writes = trackAnnotationWrites(page);

  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  await panUntilNaturalVisible(
    page,
    await findClearAim(page, target.captureId, doc, { from: 0.88, to: 0.97 }),
  );
  const pane = await visiblePane(page);
  const camera = await readCamera(page);
  const zoom = camera.zoom;
  // Draw from just above and left of the pane center, away from the pin
  // badges the other tests leave in this band.
  const from = { x: pane.left + pane.width / 2 - 70, y: pane.top + pane.height / 2 - 50 };
  const aim = toNatural({ x: from.x - pane.left, y: from.y - pane.top }, camera);

  // The toggle arms exactly the next drag: a plain drag then draws instead
  // of panning, and the toggle releases itself.
  const toggle = page.getByRole("button", { name: "Draw a box" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y + 30, { steps: 6 });
  await page.mouse.move(from.x + 100, from.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__node-draftRectangle")).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const afterDraw = await readCamera(page);
  expect(Math.abs(afterDraw.x - camera.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterDraw.y - camera.y)).toBeLessThanOrEqual(1);

  await expect(page.getByTestId("pin-composer")).toBeVisible();
  await expect(page.getByTestId("draft-context")).toHaveAttribute(
    "data-candidates-state",
    /ready|failed/,
    { timeout: 15_000 },
  );
  await page.getByLabel("Comment").fill("e2e: toggle box (shared numbering)");
  await page.getByRole("button", { name: "No element" }).click();
  await page.getByRole("button", { name: "Save box" }).click();
  await expect(page.locator(".react-flow__node-draftRectangle")).toHaveCount(0);
  const box = await awaitNewPin(page, target.captureId, before);
  expect(box.kind).toBe("rectangle");
  expect(box.rect).toBeDefined();
  expect(Math.abs(box.rect!.x - aim.x)).toBeLessThanOrEqual(1 + 1 / zoom);
  expect(Math.abs(box.rect!.y - aim.y)).toBeLessThanOrEqual(1 + 1 / zoom);
  expect(Math.abs(box.rect!.width - 100 / zoom)).toBeLessThanOrEqual(1 + 1 / zoom);
  expect(Math.abs(box.rect!.height - 60 / zoom)).toBeLessThanOrEqual(1 + 1 / zoom);
  // One sequence for both kinds: the box took the next number after every
  // pin and box the capture has ever had, and the next pin takes box + 1.
  const highestBefore = Math.max(0, ...before.map((pin) => pin.number));
  expect(box.number).toBeGreaterThan(highestBefore);
  await expect(page.locator(".react-flow__node-rectangle")).toHaveCount(
    before.filter((pin) => pin.kind === "rectangle").length + 1,
  );

  // A plain drag pans again now that the toggle released.
  const beforePan = await readCamera(page);
  await page.mouse.move(pane.left + pane.width / 2 + 120, pane.top + pane.height / 2 + 120);
  await page.mouse.down();
  await page.mouse.move(pane.left + pane.width / 2 + 60, pane.top + pane.height / 2 + 80, { steps: 6 });
  await page.mouse.up();
  const afterPan = await readCamera(page);
  expect(Math.hypot(afterPan.x - beforePan.x, afterPan.y - beforePan.y)).toBeGreaterThan(20);
  await expect(page.locator(".react-flow__node-draftRectangle")).toHaveCount(0);

  const withBox = await listPins(page, target.captureId);
  const pinAim = await findClearAim(page, target.captureId, doc, { from: 0.88, to: 0.97 });
  await panUntilNaturalVisible(page, pinAim);
  const pinNodesBefore = await page.locator(PIN_NODE).count();
  await placeAndSave(page, pinAim, doc, "e2e: pin after box (shared numbering)", pinNodesBefore + 1);
  const pin = await awaitNewPin(page, target.captureId, withBox);
  expect(pin.kind).toBe("pin");
  expect(pin.number).toBe(box.number + 1);

  // Reload: the box comes back at exactly the persisted geometry.
  await page.reload();
  await clickPlane(page, target);
  await expect(page.getByRole("img", { name: `Screenshot of ${target.pageUrl}` })).toBeVisible();
  await waitPinsLoaded(page);
  const reloaded = (await listPins(page, target.captureId)).find((mark) => mark.id === box.id)!;
  expect(reloaded.rect).toEqual(box.rect);
  await expect(
    page.locator(`[data-testid="rectangle-badge"][data-mark-number="${box.number}"]`),
  ).toBeVisible();

  // Cleanup: the probe pin and the box leave; their numbers stay retired.
  await deleteMark(page, target.captureId, pin);
  await deleteMark(page, target.captureId, reloaded);

  // One box create, one pin create, two cleanup deletes — nothing else wrote.
  expect(writes.filter((w) => w.startsWith("POST "))).toHaveLength(2);
  expect(writes.filter((w) => w.startsWith("PATCH "))).toHaveLength(0);
  expect(consoleErrors).toEqual([]);
});
