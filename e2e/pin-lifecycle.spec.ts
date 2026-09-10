// End-to-end contract for the pin comment and mutation lifecycle
// (VAL-PIN-002, VAL-PIN-003, VAL-PIN-008, VAL-PIN-009): a draft cannot save
// until Lucas explicitly chooses a nearby element or No element; only the
// capture-local element id crosses the wire and the server-derived snapshot
// comes back immutable through move and edit; a drag commits one
// revisioned move; edit and delete carry the pin's revision; a stale write
// conflicts and the UI settles on the authoritative revision instead of
// overwriting it; a session that lost authority cannot move anything; and
// every state survives reload with numbers, snapshots, and threads intact.
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
  deviceButtonName,
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
import { stubDispatchQuota } from "./stub-dispatch";

const gate = localEnvGate(["EDITOR_PASSWORD", "SESSION_SECRET"]);

test.describe.configure({ mode: "serial" });

const PIN_NODE = ".react-flow__node-pin";
const PIN_BADGE = '[data-testid="pin-badge"]';

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
  number: number;
  tip: { x: number; y: number };
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
  await expect(page.getByTestId("capture-panel")).toContainText(/No pins yet\.|Pin \d+ — at \(/);
}

/**
 * Wait for the context panel's quiescent marker before touching any radio:
 * the async candidates render can detach a radio mid-click under load (the
 * 2026-09-10 full-gate flake), so specs never click while it reads loading.
 */
async function waitContextSettled(page: Page): Promise<void> {
  await expect(page.getByTestId("draft-context")).toHaveAttribute(
    "data-candidates-state",
    /ready|failed/,
  );
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
 * Place one draft at a natural point. The pane is re-anchored after
 * entering pin mode so the click lands exactly on the intended pixel.
 */
async function placeDraft(page: Page, natural: { x: number; y: number }): Promise<void> {
  const pinButton = page.getByRole("button", { name: "Place pin" });
  if ((await pinButton.getAttribute("aria-pressed")) !== "true") await pinButton.click();
  const [pane, camera] = await Promise.all([visiblePane(page), readCamera(page)]);
  const local = toScreen(natural, camera);
  if (local.x < 0 || local.y < 0 || local.x > pane.width || local.y > pane.height) {
    throw new Error(`placement point is off-pane: ${JSON.stringify({ local, natural })}`);
  }
  await page.mouse.click(pane.left + local.x, pane.top + local.y);
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(1);
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

test("saving requires an explicit context decision; the server-derived snapshot survives reload (VAL-PIN-003, VAL-PIN-008)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(240_000);

  const consoleErrors = trackConsoleErrors(page);
  const target = await openDesktopPlane(page);
  const before = await listPins(page, target.captureId);
  const aim = await aimBottomBand(page, target);

  await placeDraft(page, aim);
  await page.getByLabel("Comment").fill("e2e: lifecycle decision and snapshot");

  // Undecided drafts cannot save — the requirement is visible, not hidden.
  const saveButton = page.getByRole("button", { name: "Save pin" });
  await expect(saveButton).toBeDisabled();
  await expect(page.getByTestId("draft-context")).toContainText(
    /choose a nearby element or no element/i,
  );

  // Wait out the nearby-candidate read, then decide deliberately: the
  // first ranked candidate when the manifest offers one near the aim,
  // otherwise the explicit No element. Both are real decisions.
  await waitContextSettled(page);
  const candidateRows = page.locator('[data-testid="draft-context"] .panel-candidate');
  const candidateCount = await candidateRows.count();
  if (candidateCount > 1) {
    await candidateRows.first().locator("input").check();
  } else {
    await page.getByRole("radio", { name: "No element" }).check();
  }
  await expect(saveButton).toBeEnabled();

  // Capture the create request body: only the capture-local id crosses the
  // wire — never a client-authored metadata object.
  const createRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/annotations"),
  );
  await saveButton.click();
  const posted = JSON.parse((await createRequest).postData()!) as Record<string, unknown>;
  expect(Object.keys(posted).sort()).toEqual(["body", "elementId", "idempotencyKey", "tip"]);
  if (candidateCount > 1) {
    expect(typeof posted.elementId).toBe("string");
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
  await page.getByRole("button", { name: deviceButtonName(target), exact: true }).click();
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
  await page.getByRole("radio", { name: "No element" }).check();
  await page.getByRole("button", { name: "Save pin" }).click();
  const saved = await awaitNewPin(page, target.captureId, before);
  const number = saved.number;
  const snapshotAtCreate = saved.elementSnapshot;

  // Drag: exactly one revisioned PATCH, grab offset preserved.
  const nodeBox = await pinNode(page, number).boundingBox();
  if (!nodeBox) throw new Error("saved pin node not rendered");
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
  await page.getByRole("button", { name: deviceButtonName(target), exact: true }).click();
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
  await page.getByRole("radio", { name: "No element" }).check();
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
  await page.getByRole("radio", { name: "No element" }).check();
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

  const nodeBox = await pinNode(page, number).boundingBox();
  if (!nodeBox) throw new Error("saved pin node not rendered");
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
  await page.getByRole("radio", { name: "No element" }).check();
  await page.getByRole("button", { name: "Save pin" }).click();
  const saved = await awaitNewPin(page, target.captureId, before);
  const number = saved.number;

  // Revoke this browser's authority: the session and CSRF cookies are gone,
  // so the drag's PATCH is rejected at the boundary before any write.
  const cookies = await page.context().cookies();
  await page.context().clearCookies();

  const nodeBox = await pinNode(page, number).boundingBox();
  if (!nodeBox) throw new Error("saved pin node not rendered");
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
