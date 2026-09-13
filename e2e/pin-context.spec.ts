// End-to-end contract for nearby-DOM context selection and the candidate
// preview highlight (VAL-PIN-004, VAL-PIN-006, VAL-CANVAS-004): on the seeded
// Chickpea pricing plane a draft surfaces a bounded, deterministic candidate
// list that Lucas browses with pointer, keyboard, or touch, with a temporary
// highlight that tracks the hovered/focused candidate's persisted manifest
// rectangle within one natural pixel at 1x and 8x and never persists or
// writes anything. The seeded store's manifests come from real Browserless
// captures of Chickpea, so this exercises the dense-pricing case end to end.
//
// Runs against the seeded local store like pins.spec.ts. These tests place
// DRAFTS ONLY and cancel every one: the ranking/preview contract is a read
// surface, and skipping writes keeps the shared store untouched (the
// choice-persistence half of VAL-PIN-004 is pin-lifecycle.spec.ts's job).
// Since D074 the composer opens beside the draft with the top candidate
// pre-selected as a chip; the ranked radio list sits behind "Change".

import { expect, test, type Page } from "@playwright/test";
import { NEARBY_CANDIDATES_MAX } from "../src/lib/boundaries";
import {
  findClearAim,
  findReadyTarget,
  openPlane,
  paneRect,
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

const PREVIEW_NODE = ".react-flow__node-contextPreview";
const PREVIEW_FACE = ".react-flow__node-contextPreview .context-preview";
// The No-element label shares the panel-candidate class; candidates carry
// the capture-local element id, No element does not.
const CANDIDATE_ROW = ".panel-candidate[data-element-id]";

interface ContextItem {
  id: string;
  kind: string;
  tag: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

/** The server's ranked candidates for an exact natural point, read back
    over the same authorized route the panel uses. */
async function fetchContext(
  page: Page,
  captureId: string,
  point: { x: number; y: number },
): Promise<ContextItem[]> {
  return page.evaluate(
    async ({ id, x, y }) => {
      const response = await fetch(
        `/api/captures/${encodeURIComponent(id)}/context?x=${x}&y=${y}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`context read failed: ${response.status}`);
      const payload = (await response.json()) as { candidates: ContextItem[] };
      return payload.candidates;
    },
    { id: captureId, x: point.x, y: point.y },
  );
}

/**
 * Click a clear natural point to drop a draft (no mode to enter first,
 * D074) and wait for the composer's quiescent marker. Never saves; callers
 * cancel when done.
 */
async function placeDraft(
  page: Page,
  target: ReadyTarget,
  band?: { from: number; to: number },
): Promise<{ x: number; y: number }> {
  const aim = await findClearAim(page, target.captureId, {
    width: target.width,
    height: target.height,
  }, band);
  const [pane, camera] = await Promise.all([visiblePane(page), readCamera(page)]);
  const local = toScreen(aim, camera);
  await page.mouse.click(pane.left + local.x, pane.top + local.y);
  await expect(page.locator(".react-flow__node-draftPin")).toHaveCount(1);
  await expect(page.getByTestId("pin-composer")).toBeVisible();
  // Never touch the choice controls before the quiescent marker settles:
  // the async candidates render can detach a radio mid-click under load.
  await expect(page.getByTestId("draft-context")).toHaveAttribute(
    "data-candidates-state",
    /ready|failed/,
  );
  return aim;
}

/**
 * Open the ranked list behind the pre-selected chip. The composer shows
 * one chip by default; Change expands the radios, No element last.
 */
async function expandCandidates(page: Page): Promise<void> {
  const change = page.getByRole("button", { name: "Change" });
  if ((await change.getAttribute("aria-expanded")) !== "true") await change.click();
  await expect(page.getByTestId("draft-context").getByRole("radio").first()).toBeVisible();
}

/** The composer's candidate rows, in rendered (ranked) order. */
function candidateRows(page: Page) {
  return page.getByTestId("draft-context").locator(CANDIDATE_ROW);
}

async function cancelDraft(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("pin-composer")).toHaveCount(0);
}

test("the pricing plane offers a bounded deterministic candidate list with an explicit last No element (VAL-PIN-004)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(120_000);
  const consoleErrors = trackConsoleErrors(page);
  await stubDispatchQuota(page);
  await signIn(page);

  const target = await findReadyTarget(page, "desktop", "https://chickpea.co/pricing");
  test.skip(!target, "no ready seeded pricing desktop capture in the local store");
  await openPlane(page, target!);

  const aim = await placeDraft(page, target!);
  // Chickpea's seeded captures carry manifests; a draft on a dense pricing
  // region must settle ready with at least one real candidate.
  await expect(page.getByTestId("draft-context")).toHaveAttribute(
    "data-candidates-state",
    "ready",
  );

  // The top-ranked candidate is pre-selected as the chip (D074), and it is
  // the server's own first result for the same point.
  const serverOrder = (await fetchContext(page, target!.captureId, aim)).map(
    (item) => item.id,
  );
  await expect(page.getByTestId("draft-choice")).toHaveAttribute(
    "data-element-id",
    serverOrder[0]!,
  );

  await expandCandidates(page);
  const rows = candidateRows(page);
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(NEARBY_CANDIDATES_MAX);
  await expect(rows.first().getByRole("radio")).toBeChecked();

  // Every candidate carries a non-empty inert label and a distinct
  // capture-local element id; the server's ranked order for the same point
  // matches the rendered order exactly (deterministic ranking, VAL-PIN-004).
  const renderedIds = await rows.evaluateAll((labels) =>
    labels.map((label) => label.getAttribute("data-element-id")),
  );
  expect(new Set(renderedIds).size).toBe(count);
  for (let i = 0; i < count; i += 1) {
    await expect(rows.nth(i)).not.toHaveText(/^\s*$/);
  }
  expect(renderedIds).toEqual(serverOrder);

  // No element is always the final, explicit choice (VAL-PIN-004).
  const radios = page.getByTestId("draft-context").getByRole("radio");
  await expect(radios).toHaveCount(count + 1);
  await expect(radios.nth(count)).toHaveAccessibleName("No element");

  // Selection is explicit and exclusive: No element, then a candidate
  // again, and the chip follows the choice.
  await radios.nth(count).check();
  await expect(rows.first().getByRole("radio")).not.toBeChecked();
  await expect(page.getByTestId("draft-choice")).toHaveText("No element");
  await rows.first().getByRole("radio").check();
  await expect(radios.nth(count)).not.toBeChecked();
  await expect(page.getByTestId("draft-choice")).toHaveAttribute(
    "data-element-id",
    serverOrder[0]!,
  );
  // The one-click override outside the list does the same as its radio.
  await page.getByRole("button", { name: "No element" }).click();
  await expect(radios.nth(count)).toBeChecked();

  await cancelDraft(page);
  expect(consoleErrors).toEqual([]);
});

test("the candidate highlight tracks the persisted manifest rect within one natural pixel at 1x and 8x and never persists (VAL-PIN-004)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(180_000);
  const consoleErrors = trackConsoleErrors(page);
  await stubDispatchQuota(page);
  await signIn(page);

  const target = await findReadyTarget(page, "desktop", "https://chickpea.co/pricing");
  test.skip(!target, "no ready seeded pricing desktop capture in the local store");
  await openPlane(page, target!);

  // Preview never writes: count annotation-mutating requests from this
  // browser from here on (sibling specs share the plane, so server-side
  // counts legitimately move; this page's request log is the honest proof).
  const annotationWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.method() !== "HEAD" &&
      request.url().includes("/annotations")
    ) {
      annotationWrites.push(`${request.method()} ${request.url()}`);
    }
  });

  const aim = await placeDraft(page, target!);
  await expect(page.getByTestId("draft-context")).toHaveAttribute(
    "data-candidates-state",
    "ready",
  );
  await expandCandidates(page);
  const rows = candidateRows(page);
  expect(await rows.count()).toBeGreaterThan(0);

  // The previewed candidate's exact persisted rectangle, from the server's
  // ranked snapshot — never from anything the client computes.
  const firstId = await rows.first().getAttribute("data-element-id");
  const item = (await fetchContext(page, target!.captureId, aim)).find(
    (candidate) => candidate.id === firstId,
  );
  expect(item, `server candidate ${firstId}`).toBeDefined();

  /** The rendered highlight's screen rect, relative to the pane. */
  const measurePreview = async () => {
    const pane = await paneRect(page);
    return page.evaluate(
      ({ left, top, selector }) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: rect.left - left,
          y: rect.top - top,
          width: rect.width,
          height: rect.height,
        };
      },
      { left: pane.left, top: pane.top, selector: PREVIEW_FACE },
    );
  };
  const expectAligned = async (camera: { x: number; y: number; zoom: number }) => {
    const measured = await measurePreview();
    expect(measured, "preview rendered").not.toBeNull();
    const rect = item!.rect;
    // Node positions live under the viewport's own translate: pane-relative
    // screen = camera translate + natural * zoom. One natural pixel of
    // slack, converted to screen px, plus sub-pixel rasterization — the
    // highlight IS the measurement surface.
    const zoom = camera.zoom;
    const slack = zoom + 1;
    expect(Math.abs(measured!.x - (camera.x + rect.x * zoom)), "left edge").toBeLessThanOrEqual(
      slack,
    );
    expect(Math.abs(measured!.y - (camera.y + rect.y * zoom)), "top edge").toBeLessThanOrEqual(
      slack,
    );
    expect(Math.abs(measured!.width - rect.width * zoom), "width").toBeLessThanOrEqual(slack);
    expect(Math.abs(measured!.height - rect.height * zoom), "height").toBeLessThanOrEqual(
      slack,
    );
  };

  // --- 1x ---------------------------------------------------------------
  await page.getByRole("button", { name: "Natural size" }).click();
  await waitForZoom(page, 1);
  await rows.first().hover();
  await expect(page.locator(PREVIEW_NODE)).toHaveCount(1);
  await expectAligned(await readCamera(page));
  // Moving the pointer off the row ends the preview; nothing lingers.
  const pane = await visiblePane(page);
  await page.mouse.move(pane.left + 8, pane.top + 8);
  await expect(page.locator(PREVIEW_NODE)).toHaveCount(0);

  // --- 8x ---------------------------------------------------------------
  for (let i = 0; i < 24; i += 1) {
    const zoom = (await readCamera(page)).zoom;
    if (zoom >= 7.9) break;
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(350);
  }
  await waitForZoom(page, 8);
  await rows.first().hover();
  await expect(page.locator(PREVIEW_NODE)).toHaveCount(1);
  await expectAligned(await readCamera(page));
  await page.mouse.move(pane.left + 8, pane.top + 8);
  await expect(page.locator(PREVIEW_NODE)).toHaveCount(0);

  // Keyboard parity: focusing the radio previews, blurring clears. (Tab
  // inside a radio group moves to the next candidate, whose own focus
  // preview legitimately replaces this one — blur is the "focus left the
  // list" signal.)
  await rows.first().getByRole("radio").focus();
  await expect(page.locator(PREVIEW_NODE)).toHaveCount(1);
  await rows.first().getByRole("radio").evaluate((el) => (el as HTMLElement).blur());
  await expect(page.locator(PREVIEW_NODE)).toHaveCount(0);

  // Preview never writes: this browser issued zero annotation mutations
  // across hover, zoom, focus, and cancel.
  await cancelDraft(page);
  expect(annotationWrites).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("the mobile pricing plane offers its own bounded candidate list (VAL-PIN-006)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(120_000);
  const consoleErrors = trackConsoleErrors(page);
  await stubDispatchQuota(page);
  await signIn(page);

  const target = await findReadyTarget(page, "mobile", "https://chickpea.co/pricing");
  test.skip(!target, "no ready seeded pricing mobile capture in the local store");
  await openPlane(page, target!);

  // Aim near the top of the mobile layout: the visible header must be
  // selectable while the closed menu's contents stay out of the list
  // (the controlled fixture proves closed-menu exclusion byte-exactly in
  // manifest-scan.spec.ts; here the mobile case just has to work).
  await placeDraft(page, target!, { from: 0.01, to: 0.06 });
  await expect(page.getByTestId("draft-context")).toHaveAttribute(
    "data-candidates-state",
    "ready",
  );
  await expect(page.getByTestId("draft-choice")).toHaveAttribute("data-element-id", /.+/);
  await expandCandidates(page);
  const rows = candidateRows(page);
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(NEARBY_CANDIDATES_MAX);
  await expect(rows.first().getByRole("radio")).toBeChecked();

  await cancelDraft(page);
  expect(consoleErrors).toEqual([]);
});

test("a drawn box asks for candidates by overlap and pre-selects the server's first result (D079)", async ({
  page,
}) => {
  test.skip(!gate.ready, gate.reason);
  test.setTimeout(120_000);
  const consoleErrors = trackConsoleErrors(page);
  await stubDispatchQuota(page);
  await signIn(page);

  const target = await findReadyTarget(page, "desktop", "https://chickpea.co/pricing");
  test.skip(!target, "no ready seeded pricing desktop capture in the local store");
  await openPlane(page, target!);

  const annotationWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.method() !== "HEAD" &&
      request.url().includes("/annotations")
    ) {
      annotationWrites.push(`${request.method()} ${request.url()}`);
    }
  });

  // Shift-drag a box on the pricing plane; the client's own context request
  // names the box, so the same URL is what the server is asked to re-rank.
  const aim = await findClearAim(page, target!.captureId, {
    width: target!.width,
    height: target!.height,
  });
  const [pane, camera] = await Promise.all([visiblePane(page), readCamera(page)]);
  const local = toScreen(aim, camera);
  const from = { x: pane.left + local.x, y: pane.top + local.y };
  const contextRequest = page.waitForRequest(
    (request) => /\/context\?x=[^&]+&y=[^&]+&width=[^&]+&height=/.test(request.url()),
  );
  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 25, { steps: 6 });
  await page.mouse.move(from.x + 80, from.y + 50, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.locator(".react-flow__node-draftRectangle")).toHaveCount(1);
  const requested = new URL((await contextRequest).url());
  await expect(page.getByTestId("draft-context")).toHaveAttribute(
    "data-candidates-state",
    "ready",
  );

  const serverOrder = (
    await page.evaluate(async (query) => {
      const response = await fetch(`/api/captures/${query.captureId}/context?${query.search}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`context read failed: ${response.status}`);
      return ((await response.json()) as { candidates: { id: string }[] }).candidates;
    }, { captureId: encodeURIComponent(target!.captureId), search: requested.searchParams.toString() })
  ).map((item) => item.id);
  expect(serverOrder.length).toBeGreaterThan(0);
  expect(serverOrder.length).toBeLessThanOrEqual(NEARBY_CANDIDATES_MAX);
  // The largest-overlap element is the pre-selected chip.
  await expect(page.getByTestId("draft-choice")).toHaveAttribute(
    "data-element-id",
    serverOrder[0]!,
  );
  await expandCandidates(page);
  const rows = candidateRows(page);
  const renderedIds = await rows.evaluateAll((labels) =>
    labels.map((label) => label.getAttribute("data-element-id")),
  );
  expect(renderedIds).toEqual(serverOrder);
  await expect(page.getByText("Nearby elements, most overlap first")).toBeVisible();

  await cancelDraft(page);
  await expect(page.locator(".react-flow__node-draftRectangle")).toHaveCount(0);
  expect(annotationWrites).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
