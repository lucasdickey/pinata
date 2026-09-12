// End-to-end contract for the pin comment and mutation lifecycle
// (VAL-PIN-002, VAL-PIN-003, VAL-PIN-008, VAL-PIN-009): a draft's nearby
// element decision is pre-selected once the candidates read settles (the
// top-ranked candidate, or No element) and can be overridden with one
// click (D074); only the capture-local element id crosses the wire and the
// server-derived snapshot comes back immutable through move and edit; a
// drag commits one
// revisioned move; edit and delete carry the pin's revision; a stale write
// conflicts and the UI settles on the authoritative revision instead of
// overwriting it; a session that lost authority cannot move anything; and
// every state survives reload with numbers, snapshots, and threads intact.
// The last test runs the same lifecycle for a rectangle (D079): drawn by a
// Shift-drag, saved from the same composer, resized and moved in one
// revisioned write each, and deleted.
//
// Runs against the seeded local store like pins.spec.ts and skips when the
// seeded pricing plane is absent. Tests write real pins to the seeded
// Chickpea PRICING desktop capture (this spec's exclusive plane — pin
// numbering is per capture and pin-writing specs run in parallel workers)
// in the bottom band (see findClearAim) and clean up after themselves via
// the revisioned DELETE route, so repeated runs stay far below
// MAX_ANNOTATIONS_PER_CAPTURE.

import { expect, test, type Page } from "@playwright/test";
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
const RECTANGLE_NODE = ".react-flow__node-rectangle";
const DRAFT_RECTANGLE_NODE = ".react-flow__node-draftRectangle";

interface ElementSnapshot {
  id: string;
  kind: string;
  tag: string;
  text: string;
  [key: string]: unknown;
}

interface PinRecord {
  id: string;
  captureId: string;
  kind?: "pin" | "rectangle";
  number: number;
  tip: { x: number; y: number };
  /** A rectangle's box (D079); absent on pins. */
  rect?: { x: number; y: number; width: number; height: number };
  body: string;
  elementSnapshot: ElementSnapshot | null;
  revision: number;
  createdAt: number;
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

/**
 * A mutation from "another session": same browser, same credentials, but
 * issued straight against the route with an explicit revision. This is how
 * the specs stage a concurrent writer without a second browser.
 */
async function mutatePin(
  page: Page,
  captureId: string,
  pinId: string,
  method: "PATCH" | "DELETE",
  body: Record<string, unknown>,
): Promise<{ status: number; annotation?: PinRecord }> {
  return page.evaluate(
    async ({ id, pin, verb, payload }) => {
      const csrf =
        document.cookie
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("pinata_csrf="))
          ?.slice("pinata_csrf=".length) ?? "";
      const response = await fetch(
        `/api/captures/${encodeURIComponent(id)}/annotations/${encodeURIComponent(pin)}`,
        {
          method: verb,
          headers: { "content-type": "application/json", "x-pinata-csrf": csrf },
          body: JSON.stringify(payload),
        },
      );
      const parsed = (await response.json()) as { annotation?: PinRecord };
      return { status: response.status, annotation: parsed.annotation };
    },
    { id: captureId, pin: pinId, verb: method, payload: body },
  );
}

/** Wait until the workspace has finished loading this plane's pins. */
async function waitPinsLoaded(page: Page): Promise<void> {
  await expect(page.getByTestId("capture-panel")).toContainText(
    /No pins yet\.|(Pin|Box) \d+ · “/,
  );
}

/**
 * Wait for the composer's quiescent marker before touching the choice
 * controls: the async candidates render can detach a control mid-click
 * under load (the 2026-09-10 full-gate flake), so specs never click while
 * it reads loading. Once settled, the decision is already pre-selected.
 */
async function waitContextSettled(page: Page): Promise<void> {
  await expect(page.getByTestId("draft-context")).toHaveAttribute(
    "data-candidates-state",
    /ready|failed/,
  );
}

/** Override the pre-selected candidate with the explicit No element. */
async function chooseNoElement(page: Page): Promise<void> {
  await page.getByRole("button", { name: "No element" }).click();
  await expect(page.getByTestId("draft-choice")).toHaveText("No element");
}

/**
 * Wait for the pin this test just created and return it. Ids — not
 * numbers — identify it: numbering is monotonic across tombstones, so a
 * retired number makes "live max + 1" unreliable.
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

function pinBadge(page: Page, number: number) {
  return page.locator(`${PIN_BADGE}[data-pin-number="${number}"]`);
}
function pinNode(page: Page, number: number) {
  return page.locator(PIN_NODE, { has: pinBadge(page, number) });
}

/**
 * The saved pin's on-screen box, scrolled into view first. The branded
 * landing (D066) makes the editor home taller than the test viewport, and
 * Playwright's label interactions scroll the draft panel into view — which
 * can push the canvas above the fold, where raw mouse coordinates miss.
 */
async function pinNodeBox(page: Page, number: number) {
  const node = pinNode(page, number);
  await node.scrollIntoViewIfNeeded();
  const box = await node.boundingBox();
  if (!box) throw new Error("saved pin node not rendered");
  return box;
}

/**
 * Click a natural point to drop one draft (no mode to enter first, D074).
 * The pane is re-anchored right before the click so it lands exactly on the
 * intended pixel, and the composer must open beside the draft.
 */
async function placeDraft(page: Page, natural: { x: number; y: number }): Promise<void> {
  const [pane, camera] = await Promise.all([visiblePane(page), readCamera(page)]);
  const local = toScreen(natural, camera);
  if (local.x < 0 || local.y < 0 || local.x > pane.width || local.y > pane.height) {
    throw new Error(`placement point is off-pane: ${JSON.stringify({ local, natural })}`);
  }
  await page.mouse.click(pane.left + local.x, pane.top + local.y);
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(1);
  await expect(page.getByTestId("pin-composer")).toBeVisible();
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
  // This spec WRITES pins, and pin-writing specs run in parallel workers
  // against the shared store: it claims the seeded pricing plane (per-page
  // numbering makes the planes independent) while pins.spec owns home.
  const target = await findReadyTarget(page, "desktop", "https://chickpea.co/pricing");
  test.skip(!target, "no ready seeded pricing desktop capture in the local store");
  await openPlane(page, target!);
  await waitPinsLoaded(page);
  return target!;
}

/** Aim a fresh bottom-band point into view at 1x and return it. */
async function aimBottomBand(page: Page, target: ReadyTarget): Promise<{ x: number; y: number }> {
  const doc = { width: target.width, height: target.height };
  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  const aim = await findClearAim(page, target.captureId, doc, { from: 0.88, to: 0.97 });
  await panUntilNaturalVisible(page, aim);
  return aim;
}

test("the context decision is pre-selected and explicit on the wire; the server-derived snapshot survives reload (VAL-PIN-003, VAL-PIN-008)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(240_000);

  const consoleErrors = trackConsoleErrors(page);
  const target = await openDesktopPlane(page);
  const before = await listPins(page, target.captureId);
  const aim = await aimBottomBand(page, target);

  await placeDraft(page, aim);
  // The composer opens beside the draft with the comment focused.
  await expect(page.getByLabel("Comment")).toBeFocused();
  await page.getByLabel("Comment").fill("e2e: lifecycle decision and snapshot");

  // Once the nearby-candidate read settles the decision is already made:
  // the first ranked candidate when the manifest offers one near the aim,
  // otherwise the explicit No element. Save needs nothing more (D074).
  await waitContextSettled(page);
  const saveButton = page.getByRole("button", { name: "Save pin" });
  await expect(saveButton).toBeEnabled();
  const preselected = await page.getByTestId("draft-choice").getAttribute("data-element-id");

  // Capture the create request body: only the capture-local id crosses the
  // wire — never a client-authored metadata object.
  const createRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/annotations"),
  );
  await saveButton.click();
  const posted = JSON.parse((await createRequest).postData()!) as Record<string, unknown>;
  expect(Object.keys(posted).sort()).toEqual(["body", "elementId", "idempotencyKey", "tip"]);
  if (preselected !== null) {
    expect(posted.elementId).toBe(preselected);
  } else {
    expect(posted.elementId).toBeNull();
  }

  // The request firing is not the commit: poll the authoritative list until
  // the create lands.
  const created = await awaitNewPin(page, target.captureId, before);
  expect(created.body).toBe("e2e: lifecycle decision and snapshot");
  if (posted.elementId === null) {
    expect(created.elementSnapshot).toBeNull();
  } else {
    // The snapshot is server-derived from the persisted manifest: its id
    // matches the decision, and the rect/path/text it carries could only
    // have come from the capture itself.
    expect(created.elementSnapshot?.id).toBe(posted.elementId);
    expect(created.elementSnapshot?.kind.length).toBeGreaterThan(0);
  }
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(0);

  // Reload: number, tip, body, and the immutable snapshot come back
  // byte-identical — the binding is to the capture, not the session.
  const beforeReload = await listPins(page, target.captureId);
  await page.reload();
  await clickPlane(page, target);
  await expect(
    page.getByRole("img", { name: `Screenshot of ${target.pageUrl}` }),
  ).toBeVisible();
  await waitPinsLoaded(page);
  const afterReload = await listPins(page, target.captureId);
  expect(afterReload).toEqual(beforeReload);

  // Clean up: tombstone the pin so repeated runs stay tidy.
  const fresh = afterReload.find((pin) => pin.id === created.id)!;
  const cleanup = await mutatePin(page, target.captureId, fresh.id, "DELETE", {
    expectedRevision: fresh.revision,
  });
  expect(cleanup.status).toBe(200);
  expect(consoleErrors).toEqual([]);
});

test("move, edit, and delete are revisioned mutations; the number is retired and the snapshot untouched (VAL-PIN-002, VAL-PIN-008, VAL-PIN-009)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(240_000);

  const consoleErrors = trackConsoleErrors(page);
  const target = await openDesktopPlane(page);
  const before = await listPins(page, target.captureId);
  const writes = trackAnnotationWrites(page);
  const aim = await aimBottomBand(page, target);

  await placeDraft(page, aim);
  await page.getByLabel("Comment").fill("e2e: lifecycle move-edit-delete");
  await waitContextSettled(page);
  await chooseNoElement(page);
  // The keyboard path: Enter in the comment saves (D074).
  await page.getByLabel("Comment").press("Enter");
  const saved = await awaitNewPin(page, target.captureId, before);
  const number = saved.number;
  const snapshotAtCreate = saved.elementSnapshot;

  // Drag: exactly one revisioned PATCH, grab offset preserved.
  const nodeBox = await pinNodeBox(page, number);
  const grab = { x: nodeBox.x + nodeBox.width * 0.25, y: nodeBox.y + nodeBox.height * 0.3 };
  const step = { x: 50, y: 36 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + step.x, grab.y + step.y, { steps: 16 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await listPins(page, target.captureId)).find((pin) => pin.number === number)?.revision,
      { timeout: 10_000 },
    )
    .toBe(saved.revision + 1);
  const zoom = (await readCamera(page)).zoom;
  const moved = (await listPins(page, target.captureId)).find((pin) => pin.number === number)!;
  expect(Math.abs(moved.tip.x - (saved.tip.x + step.x / zoom))).toBeLessThanOrEqual(1 + 1 / zoom);
  expect(Math.abs(moved.tip.y - (saved.tip.y + step.y / zoom))).toBeLessThanOrEqual(1 + 1 / zoom);
  // The move touched position only: number, body, and snapshot are intact.
  expect(moved.number).toBe(number);
  expect(moved.body).toBe(saved.body);
  expect(moved.elementSnapshot).toEqual(snapshotAtCreate);

  // Edit the comment through the panel: one PATCH, revision bumps again,
  // snapshot stays byte-identical.
  await page.getByRole("button", { name: new RegExp(`Pin ${number} —`) }).click();
  await page.getByRole("button", { name: "Edit comment" }).click();
  await page.getByLabel("Edit comment").fill("e2e: lifecycle move-edit-delete (edited)");
  await page.getByRole("button", { name: "Save edit" }).click();
  await expect
    .poll(
      async () =>
        (await listPins(page, target.captureId)).find((pin) => pin.number === number)?.revision,
      { timeout: 10_000 },
    )
    .toBe(moved.revision + 1);
  const edited = (await listPins(page, target.captureId)).find((pin) => pin.number === number)!;
  expect(edited.body).toBe("e2e: lifecycle move-edit-delete (edited)");
  expect(edited.tip).toEqual(moved.tip);
  expect(edited.elementSnapshot).toEqual(snapshotAtCreate);
  await expect(page.getByTestId("panel-pin")).toContainText("(edited)");

  // Delete is a two-step revisioned write; the pin leaves the plane.
  await page.getByRole("button", { name: "Delete pin" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect
    .poll(
      async () => (await listPins(page, target.captureId)).some((pin) => pin.number === number),
      { timeout: 10_000 },
    )
    .toBe(false);
  await expect(pinBadge(page, number)).toHaveCount(0);

  // Reload: still gone, no ghost.
  await page.reload();
  await clickPlane(page, target);
  await expect(
    page.getByRole("img", { name: `Screenshot of ${target.pageUrl}` }),
  ).toBeVisible();
  await waitPinsLoaded(page);
  expect((await listPins(page, target.captureId)).some((pin) => pin.number === number)).toBe(false);

  // The retired number is never reused: the next pin takes number + 1.
  const beforeProbe = await listPins(page, target.captureId);
  const aim2 = await aimBottomBand(page, target);
  await placeDraft(page, aim2);
  await page.getByLabel("Comment").fill("e2e: lifecycle number-retirement probe");
  await waitContextSettled(page);
  await chooseNoElement(page);
  await page.getByRole("button", { name: "Save pin" }).click();
  const probe = await awaitNewPin(page, target.captureId, beforeProbe);
  expect(probe.number).toBe(number + 1);
  expect((await listPins(page, target.captureId)).some((pin) => pin.number === number)).toBe(
    false,
  );
  const cleanup = await mutatePin(page, target.captureId, probe.id, "DELETE", {
    expectedRevision: probe.revision,
  });
  expect(cleanup.status).toBe(200);

  // One create, one move, one edit, one delete, one probe create, one probe
  // delete — and nothing else ever wrote.
  expect(writes.filter((w) => w.startsWith("POST "))).toHaveLength(2);
  expect(writes.filter((w) => w.startsWith("PATCH "))).toHaveLength(2);
  expect(writes.filter((w) => w.startsWith("DELETE "))).toHaveLength(2);
  expect(writes).toHaveLength(6);
  expect(consoleErrors).toEqual([]);
});

test("a stale write conflicts and the UI settles on the authoritative revision (VAL-PIN-009)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(240_000);

  const consoleErrors = trackConsoleErrors(page);
  const target = await openDesktopPlane(page);
  const before = await listPins(page, target.captureId);
  const aim = await aimBottomBand(page, target);

  await placeDraft(page, aim);
  await page.getByLabel("Comment").fill("e2e: stale conflict victim");
  await waitContextSettled(page);
  await chooseNoElement(page);
  await page.getByRole("button", { name: "Save pin" }).click();
  const saved = await awaitNewPin(page, target.captureId, before);
  const number = saved.number;

  // Another session wins the race: same pin, current revision, new body.
  const otherWrite = await mutatePin(page, target.captureId, saved.id, "PATCH", {
    expectedRevision: saved.revision,
    body: "e2e: another session wrote first",
  });
  expect(otherWrite.status).toBe(200);
  expect(otherWrite.annotation?.revision).toBe(saved.revision + 1);

  // This UI still holds the stale revision: its edit conflicts, the editor
  // closes, and the panel shows the authoritative body instead of ours.
  await page.getByRole("button", { name: new RegExp(`Pin ${number} —`) }).click();
  await page.getByRole("button", { name: "Edit comment" }).click();
  await page.getByLabel("Edit comment").fill("e2e: the losing edit");
  await page.getByRole("button", { name: "Save edit" }).click();
  await expect(page.getByTestId("panel-pin").getByRole("alert")).toContainText(
    /changed in another session/i,
  );
  await expect(page.getByLabel("Edit comment")).toHaveCount(0);
  await expect(page.getByTestId("panel-pin")).toContainText("another session wrote first");
  const authoritative = (await listPins(page, target.captureId)).find(
    (pin) => pin.number === number,
  )!;
  expect(authoritative.body).toBe("e2e: another session wrote first");
  expect(authoritative.revision).toBe(saved.revision + 1);

  // A stale MOVE conflicts the same way: another session moves first, this
  // UI's drag is rejected, and the badge snaps back to the winner's tip.
  const otherMove = await mutatePin(page, target.captureId, saved.id, "PATCH", {
    expectedRevision: authoritative.revision,
    tip: { x: authoritative.tip.x - 120, y: authoritative.tip.y - 90 },
  });
  expect(otherMove.status).toBe(200);
  const winnerTip = otherMove.annotation!.tip;

  const nodeBox = await pinNodeBox(page, number);
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + 90, nodeBox.y + 70, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".capture-error[role=alert]")).toContainText(
    /changed in another session/i,
  );

  // One authoritative record: the winner's tip and revision, no duplicate,
  // and the loser's drag left no trace.
  const settled = (await listPins(page, target.captureId)).filter(
    (pin) => pin.number === number,
  );
  expect(settled).toHaveLength(1);
  expect(settled[0]!.tip).toEqual(winnerTip);
  expect(settled[0]!.revision).toBe(authoritative.revision + 1);
  await expect(page.locator(PIN_NODE, { has: pinBadge(page, number) })).toHaveCount(1);

  // Clean up with the now-current revision.
  const cleanup = await mutatePin(page, target.captureId, saved.id, "DELETE", {
    expectedRevision: settled[0]!.revision,
  });
  expect(cleanup.status).toBe(200);
  // The staged 409s are the subject under test; Chromium logs each non-2xx
  // fetch as a resource console error. No application error is allowed.
  expect(consoleErrors.filter((entry) => !entry.startsWith("Failed to load resource"))).toEqual(
    [],
  );
});

test("a session that lost authority cannot move the pin and the record is untouched (VAL-PIN-009)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(240_000);

  const target = await openDesktopPlane(page);
  const before = await listPins(page, target.captureId);
  const aim = await aimBottomBand(page, target);

  await placeDraft(page, aim);
  await page.getByLabel("Comment").fill("e2e: lost-authority probe");
  await waitContextSettled(page);
  await chooseNoElement(page);
  await page.getByRole("button", { name: "Save pin" }).click();
  const saved = await awaitNewPin(page, target.captureId, before);
  const number = saved.number;

  // Revoke this browser's authority: the session and CSRF cookies are gone,
  // so the drag's PATCH is rejected at the boundary before any write.
  const cookies = await page.context().cookies();
  await page.context().clearCookies();

  const nodeBox = await pinNodeBox(page, number);
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + 80, nodeBox.y + 60, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".capture-error[role=alert]")).toContainText(/could not be saved/i);

  // Restore authority and read the record: not one natural pixel moved.
  await page.context().addCookies(cookies);
  const untouched = (await listPins(page, target.captureId)).find(
    (pin) => pin.number === number,
  )!;
  expect(untouched.tip).toEqual(saved.tip);
  expect(untouched.revision).toBe(saved.revision);

  // A direct write with a stale revision is likewise rejected, and the
  // error is generic — it never leaks whether the pin exists.
  const stale = await mutatePin(page, target.captureId, saved.id, "PATCH", {
    expectedRevision: saved.revision + 99,
    body: "e2e: stale direct write",
  });
  expect(stale.status).toBe(409);
  const afterStale = (await listPins(page, target.captureId)).find(
    (pin) => pin.number === number,
  )!;
  expect(afterStale.revision).toBe(saved.revision);

  // Clean up, then verify the tombstone rejects a further write.
  const cleanup = await mutatePin(page, target.captureId, saved.id, "DELETE", {
    expectedRevision: saved.revision,
  });
  expect(cleanup.status).toBe(200);
  const afterDelete = await mutatePin(page, target.captureId, saved.id, "PATCH", {
    expectedRevision: saved.revision,
    body: "e2e: write after delete",
  });
  expect(afterDelete.status).toBe(404);
});

/** The saved box's node wrapper, by its badge number. */
function rectangleNode(page: Page, number: number) {
  return page.locator(RECTANGLE_NODE, {
    has: page.locator(`[data-testid="rectangle-badge"][data-mark-number="${number}"]`),
  });
}

/** Press, travel in two steps, release — with or without Shift held. */
async function dragPointer(
  page: Page,
  from: { x: number; y: number },
  delta: { x: number; y: number },
  shift = false,
): Promise<void> {
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x / 2, from.y + delta.y / 2, { steps: 8 });
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}

test("a box is drawn by Shift-drag, saved from the same composer, resized and moved in one write each, and deleted (D079)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(240_000);

  const consoleErrors = trackConsoleErrors(page);
  const target = await openDesktopPlane(page);
  const before = await listPins(page, target.captureId);
  const writes = trackAnnotationWrites(page);
  const aim = await aimBottomBand(page, target);

  // Shift-drag 120 by 80 screen px from the aim: at 1x, a 120 by 80 natural
  // box whose top-left corner is the aim. Plain drags on this plane pan.
  const [pane, camera] = await Promise.all([visiblePane(page), readCamera(page)]);
  const zoom = camera.zoom;
  const local = toScreen(aim, camera);
  const from = { x: pane.left + local.x, y: pane.top + local.y };
  const size = { x: 120, y: 80 };
  await dragPointer(page, from, size, true);
  await expect(page.locator(DRAFT_RECTANGLE_NODE)).toHaveCount(1);
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(0);
  // The camera did not move: the drag drew instead of panning.
  const after = await readCamera(page);
  expect(Math.abs(after.x - camera.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - camera.y)).toBeLessThanOrEqual(1);

  // The same composer, labelled for a box, anchored beside the box's
  // top-right corner and inside the canvas frame.
  const composer = page.getByTestId("pin-composer");
  await expect(composer).toBeVisible();
  await expect(composer).toHaveAttribute("data-draft-kind", "rectangle");
  await expect(page.getByRole("dialog", { name: "New box" })).toBeVisible();
  const composerBox = (await composer.boundingBox())!;
  const frameBox = (await page.locator(".capture-canvas").boundingBox())!;
  expect(composerBox.x).toBeGreaterThanOrEqual(frameBox.x - 1);
  expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);
  const corner = { x: from.x + size.x, y: from.y };
  const side = await composer.getAttribute("data-side");
  if (side === "right") expect(composerBox.x).toBeGreaterThanOrEqual(corner.x - 1);
  else expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(corner.x + 1);

  await page.getByLabel("Comment").fill("e2e: box lifecycle");
  await waitContextSettled(page);
  await chooseNoElement(page);
  await page.getByLabel("Comment").press("Enter");
  const saved = await awaitNewPin(page, target.captureId, before);
  const number = saved.number;
  expect(saved.kind).toBe("rectangle");
  expect(saved.rect, "a rectangle persists its box").toBeDefined();
  const savedRect = saved.rect!;
  expect(Math.abs(savedRect.x - aim.x)).toBeLessThanOrEqual(1 + 1 / zoom);
  expect(Math.abs(savedRect.y - aim.y)).toBeLessThanOrEqual(1 + 1 / zoom);
  expect(Math.abs(savedRect.width - size.x / zoom)).toBeLessThanOrEqual(1 + 1 / zoom);
  expect(Math.abs(savedRect.height - size.y / zoom)).toBeLessThanOrEqual(1 + 1 / zoom);
  await expect(page.locator(DRAFT_RECTANGLE_NODE)).toHaveCount(0);
  await expect(rectangleNode(page, number)).toHaveCount(1);
  // The rendered box inverse-transforms to the persisted geometry.
  await visiblePane(page);
  const paneNow = await visiblePane(page);
  const cameraNow = await readCamera(page);
  const nodeBox = (await rectangleNode(page, number).boundingBox())!;
  const renderedTopLeft = toNatural(
    { x: nodeBox.x - paneNow.left, y: nodeBox.y - paneNow.top },
    cameraNow,
  );
  expect(Math.abs(renderedTopLeft.x - savedRect.x)).toBeLessThanOrEqual(1 + 1 / cameraNow.zoom);
  expect(Math.abs(renderedTopLeft.y - savedRect.y)).toBeLessThanOrEqual(1 + 1 / cameraNow.zoom);
  expect(Math.abs(nodeBox.width / cameraNow.zoom - savedRect.width)).toBeLessThanOrEqual(
    1 + 1 / cameraNow.zoom,
  );

  // Resize by the south-east handle: exactly one revisioned PATCH, the
  // corner untouched, the size grown by the pointer's travel.
  const handle = rectangleNode(page, number).locator(
    '[data-testid="rectangle-handle"][data-handle="se"]',
  );
  const handleBox = (await handle.boundingBox())!;
  const grow = { x: 30, y: 20 };
  await dragPointer(
    page,
    { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 },
    grow,
  );
  await expect
    .poll(
      async () =>
        (await listPins(page, target.captureId)).find((pin) => pin.number === number)?.revision,
      { timeout: 10_000 },
    )
    .toBe(saved.revision + 1);
  const resized = (await listPins(page, target.captureId)).find((pin) => pin.number === number)!;
  expect(resized.rect!.x).toBe(savedRect.x);
  expect(resized.rect!.y).toBe(savedRect.y);
  expect(Math.abs(resized.rect!.width - (savedRect.width + grow.x / zoom))).toBeLessThanOrEqual(
    1 + 1 / zoom,
  );
  expect(Math.abs(resized.rect!.height - (savedRect.height + grow.y / zoom))).toBeLessThanOrEqual(
    1 + 1 / zoom,
  );
  expect(writes.filter((w) => w.startsWith("PATCH "))).toHaveLength(1);

  // Move by the badge: one more PATCH, the size untouched.
  await visiblePane(page);
  const badge = rectangleNode(page, number).locator('[data-testid="rectangle-badge"]');
  const badgeBox = (await badge.boundingBox())!;
  const step = { x: 25, y: 15 };
  await dragPointer(
    page,
    { x: badgeBox.x + badgeBox.width / 2, y: badgeBox.y + badgeBox.height * 0.4 },
    step,
  );
  await expect
    .poll(
      async () =>
        (await listPins(page, target.captureId)).find((pin) => pin.number === number)?.revision,
      { timeout: 10_000 },
    )
    .toBe(saved.revision + 2);
  const moved = (await listPins(page, target.captureId)).find((pin) => pin.number === number)!;
  expect(Math.abs(moved.rect!.x - (resized.rect!.x + step.x / zoom))).toBeLessThanOrEqual(1 + 1 / zoom);
  expect(Math.abs(moved.rect!.y - (resized.rect!.y + step.y / zoom))).toBeLessThanOrEqual(1 + 1 / zoom);
  expect(moved.rect!.width).toBe(resized.rect!.width);
  expect(moved.rect!.height).toBe(resized.rect!.height);
  expect(moved.body).toBe(saved.body);
  expect(moved.elementSnapshot).toEqual(saved.elementSnapshot);

  // The panel names the box by its comment (D078) and keeps the bounds
  // behind Details; delete is the same two-step revisioned write.
  await page.getByRole("button", { name: new RegExp(`^Box ${number} · “`) }).click();
  await expect(page.getByTestId("panel-mark-name")).toContainText(`Box ${number} · “`);
  const details = page.getByTestId("panel-details");
  await expect(details).not.toHaveAttribute("open", /.*/);
  await details.locator("summary").click();
  await expect(page.getByTestId("panel-position")).toHaveAttribute("data-kind", "rectangle");
  await expect(page.getByTestId("panel-position")).toContainText("×");
  await page.getByRole("button", { name: "Delete box" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect
    .poll(
      async () => (await listPins(page, target.captureId)).some((pin) => pin.number === number),
      { timeout: 10_000 },
    )
    .toBe(false);
  await expect(rectangleNode(page, number)).toHaveCount(0);

  // One create, one resize, one move, one delete — nothing else ever wrote.
  expect(writes.filter((w) => w.startsWith("POST "))).toHaveLength(1);
  expect(writes.filter((w) => w.startsWith("PATCH "))).toHaveLength(2);
  expect(writes.filter((w) => w.startsWith("DELETE "))).toHaveLength(1);
  expect(writes).toHaveLength(4);
  expect(consoleErrors).toEqual([]);
});
