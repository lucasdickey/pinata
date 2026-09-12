// Shared helpers for the canvas e2e specs (VAL-CANVAS-001/002/003/006/008):
// editor sign-in, ready-capture discovery against the local durable store,
// live camera reads from the supported viewport element, and the pure
// flow/screen transforms the measurements invert. Everything is read-only.

import { expect, type Locator, type Page } from "@playwright/test";
import { CANVAS_MAX_ZOOM, CANVAS_PADDING_PX } from "../src/lib/canvas/camera";
import { requireLocalEnvValue } from "./local-env";

/** Sign in from the public landing and land on the workspace at /pins (D069). */
export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Password").fill(requireLocalEnvValue("EDITOR_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as Lucas (editor).")).toBeVisible();
}

export interface ReadyTarget {
  pageUrl: string;
  variant: "desktop" | "mobile";
  captureId: string;
  width: number;
  height: number;
  /** Owning project title, used to scope tree clicks when two projects share page URLs. */
  projectTitle?: string;
}

/**
 * A deterministic ready capture with persisted natural dimensions: always
 * the device's server-default capture (exactly the plane the workspace
 * opens when the device button is clicked), never an arbitrary ready
 * attempt. The seeded Chickpea pages are preferred so specs stay stable
 * while sibling specs create captures concurrently in the shared local
 * store; without a seeded match the first default ready capture wins.
 *
 * `preferUrl` pins the choice to one exact page: specs that WRITE pins run
 * in parallel workers against the shared store, and per-page planes have
 * independent numbering, so each writing spec claims its own seeded page
 * (pins.spec owns the home page, pin-lifecycle.spec owns /pricing) instead
 * of racing one sequence.
 */
export async function findReadyTarget(
  page: Page,
  variant?: "desktop" | "mobile",
  preferUrl?: string,
  preferTitle?: string,
): Promise<ReadyTarget | null> {
  return page.evaluate(async ({ wanted, url, title }) => {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      projects: {
        title: string;
        createdAt: number;
        pages: {
          normalizedUrl: string;
          devices: {
            variant: string;
            selectedCaptureId: string | null;
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
    const candidates: {
      pageUrl: string;
      variant: "desktop" | "mobile";
      captureId: string;
      width: number;
      height: number;
      seeded: boolean;
      projectTitle: string;
      projectCreatedAt: number;
    }[] = [];
    for (const project of payload.projects) {
      if (title && project.title !== title) continue;
      for (const p of project.pages) {
        for (const device of p.devices) {
          if (wanted && device.variant !== wanted) continue;
          const selected = device.attempts.find((a) => a.id === device.selectedCaptureId);
          const ready =
            selected && selected.state === "ready" && selected.documentWidth
              ? selected
              : device.attempts.find(
                  (a) => a.state === "ready" && a.documentWidth && a.documentHeight,
                );
          if (ready && ready.documentWidth && ready.documentHeight) {
            candidates.push({
              pageUrl: p.normalizedUrl,
              variant: device.variant as "desktop" | "mobile",
              captureId: ready.id,
              width: ready.documentWidth,
              height: ready.documentHeight,
              seeded: /^https:\/\/chickpea\.co\//.test(p.normalizedUrl),
              projectTitle: project.title,
              projectCreatedAt: project.createdAt,
            });
          }
        }
      }
    }
    // The project list arrives newest-first, and the production Chickpea
    // demo project (first-production-deployment) deliberately stays in the
    // shared store — so "the seeded pages" must mean the OLDEST matching
    // project, the local seed, not whichever Chickpea project is newest.
    // Non-seeded URL matches keep newest-first so a spec's own run-scoped
    // project wins over any leaked twin.
    const oldestSeeded = (list: typeof candidates) =>
      list.reduce<(typeof candidates)[number] | null>(
        (best, c) => (best === null || c.projectCreatedAt < best.projectCreatedAt ? c : best),
        null,
      );
    const urlMatches = url ? candidates.filter((c) => c.pageUrl === url) : [];
    const chosen = url
      ? (oldestSeeded(urlMatches.filter((c) => c.seeded)) ?? urlMatches[0] ?? null)
      : (oldestSeeded(candidates.filter((c) => c.seeded)) ?? candidates[0] ?? null);
    if (!chosen) return null;
    return {
      pageUrl: chosen.pageUrl,
      variant: chosen.variant,
      captureId: chosen.captureId,
      width: chosen.width,
      height: chosen.height,
      projectTitle: chosen.projectTitle,
    };
  }, { wanted: variant, url: preferUrl, title: preferTitle });
}

/**
 * The device button name for a plane. Since D077 the device is chosen by the
 * toggle above the canvas, whose buttons keep the names the rail entries
 * used to have.
 */
export function deviceButtonName(target: ReadyTarget): string {
  return `${target.variant === "desktop" ? "Desktop" : "Mobile"} capture of ${target.pageUrl}`;
}

/**
 * The owning project's entry in the rail. Two projects can hold the same
 * page URL (the local Chickpea seed and the production demo project), so
 * when the owning project title is known the page button is only unique
 * inside that project's tree entry.
 */
function projectEntry(page: Page, target: ReadyTarget): Locator {
  const rail = page.getByRole("navigation", { name: "Projects and pages" });
  return target.projectTitle
    ? rail
        .locator("details.tree-project")
        .filter({ has: page.getByRole("heading", { name: target.projectTitle, exact: true }) })
    : rail;
}

/** The page's button in the rail (D077); it opens the page on its usable device. */
export function pageButton(page: Page, target: ReadyTarget): Locator {
  return projectEntry(page, target).getByRole("button", { name: target.pageUrl, exact: true });
}

/**
 * The device toggle button for a plane (D077). It exists only while the
 * plane's page is open in the canvas view; revealPlane gets it there.
 */
export function planeButton(page: Page, target: ReadyTarget): Locator {
  return page
    .getByRole("group", { name: "Device" })
    .getByRole("button", { name: deviceButtonName(target), exact: true });
}

/** True when the canvas view is showing this plane's page, in its project. */
async function pageIsOpen(page: Page, target: ReadyTarget): Promise<boolean> {
  if (!(await planeButton(page, target).isVisible())) return false;
  if (!target.projectTitle) return true;
  const title = page.getByTestId("project-title");
  return (await title.count()) > 0 && (await title.first().innerText()).trim() === target.projectTitle;
}

/**
 * Get a plane's device toggle on screen: expand whatever the rail has
 * collapsed around its page (D070), then open the page from the rail (D077).
 * Only the project the detail area shows starts open, so any spec that
 * reaches for a plane in another project has to open that project first —
 * exactly as a reader would.
 */
export async function revealPlane(page: Page, target: ReadyTarget): Promise<void> {
  if (await pageIsOpen(page, target)) return;
  const rail = page.locator("details.tree-root").first();
  if ((await rail.count()) > 0 && !(await rail.evaluate((el: HTMLDetailsElement) => el.open))) {
    await rail.locator("> summary").click();
  }
  const entry = pageButton(page, target);
  if (!(await entry.isVisible())) {
    const owner = target.projectTitle
      ? projectEntry(page, target)
      : page.locator("details.tree-project").filter({ has: entry });
    const summary = owner.locator("> summary").first();
    if ((await summary.count()) > 0) await summary.click();
  }
  await entry.click();
  await expect(planeButton(page, target)).toBeVisible();
}

/** Reveal the plane's page, then choose its device from the toggle. */
export async function clickPlane(page: Page, target: ReadyTarget): Promise<void> {
  await revealPlane(page, target);
  await planeButton(page, target).click();
}

/** Select a plane and wait for its screenshot to decode at natural size. */
export async function openPlane(page: Page, target: ReadyTarget): Promise<void> {
  await clickPlane(page, target);
  await expect(page.getByRole("img", { name: `Screenshot of ${target.pageUrl}` })).toBeVisible();
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>(".capture-frame-image");
    return img !== null && img.complete && img.naturalWidth > 0;
  });
}

/**
 * Console/page error collector with one principled excuse: the dispatch
 * driver drives every pending row the shared store shows — including work
 * sibling specs create concurrently — and a quota/conflict/catalog answer
 * from the dispatch route (real or stubbed) is an expected, handled outcome
 * that Chromium still logs as a resource error. Anything else is a defect.
 */
export function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const url = message.location()?.url ?? "";
    if (/\/api\/captures\/[^/]+\/dispatch$/.test(url)) return;
    errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** The live React Flow transform, read from the viewport element style. */
export async function readCamera(page: Page): Promise<Viewport> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".react-flow__viewport");
    const match = el?.style.transform.match(
      /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/,
    );
    if (!match) throw new Error("no React Flow viewport transform found");
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  });
}

export interface PaneRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The canvas pane's own bounding rect (the camera's reference frame). */
export async function paneRect(page: Page): Promise<PaneRect> {
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
export async function visiblePane(page: Page): Promise<PaneRect> {
  await page.evaluate(() => {
    document.querySelector(".capture-canvas")?.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(100);
  return paneRect(page);
}

/** Screen coordinates of a screenshot-natural point under a camera. */
export function toScreen(
  point: { x: number; y: number },
  camera: Viewport,
): { x: number; y: number } {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}

/** The natural pixel under a pane-local screen point. */
export function toNatural(
  point: { x: number; y: number },
  camera: Viewport,
): { x: number; y: number } {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}

/** Wait until the live camera settles at an expected zoom (mode changes are
    applied by an effect after mount/click, never synchronously). */
export async function waitForZoom(page: Page, expected: number): Promise<void> {
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
export function expectedContainZoom(
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
export async function expectEntireCaptureVisible(
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

/**
 * Pan (a press that moves well past the placement slop) until a natural
 * point sits within 40 screen px of the pane center, then return its fresh
 * screen point. Specs that share a seeded plane with the pins spec use this
 * to bring a pin-free target into view before placing drafts. The press
 * lands at the pane center, so callers must not have a pin or an open
 * composer sitting there.
 */
export async function panUntilNaturalVisible(
  page: Page,
  natural: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  for (let i = 0; i < 12; i += 1) {
    const pane = await visiblePane(page);
    const camera = await readCamera(page);
    const screen = toScreen(natural, camera);
    const delta = { x: pane.width / 2 - screen.x, y: pane.height / 2 - screen.y };
    if (Math.hypot(delta.x, delta.y) < 40) {
      return { x: pane.left + screen.x, y: pane.top + screen.y };
    }
    await page.mouse.move(pane.left + pane.width / 2, pane.top + pane.height / 2);
    await page.mouse.down();
    await page.mouse.move(pane.left + pane.width / 2 + delta.x, pane.top + pane.height / 2 + delta.y, {
      steps: 4,
    });
    await page.mouse.up();
  }
  throw new Error(`never panned ${JSON.stringify(natural)} into view`);
}

export interface PinTipRecord {
  tip: { x: number; y: number };
}

/** This capture's persisted pin tips, read from the annotations route. */
export async function listPinTips(page: Page, captureId: string): Promise<PinTipRecord[]> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/captures/${encodeURIComponent(id)}/annotations`, {
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { annotations?: PinTipRecord[] };
    return Array.isArray(payload.annotations) ? payload.annotations : [];
  }, captureId);
}

const CLEAR_MARGIN_NATURAL_PX = 48;

/**
 * A deterministic on-document natural point at least 48 natural px from
 * every persisted pin on this capture — the aim placement/draft gestures
 * use so they can never land on an existing pin badge. Candidates sweep a
 * lattice inside one horizontal band of the document: gesture specs use the
 * middle band (the default), while the pins spec writes into the bottom
 * band, so the two never contend for a spot even running concurrently
 * against the shared local store. (At overview zoom a badge's hit box spans
 * hundreds of natural px, which is why separation is structural — by band —
 * rather than by margin alone.)
 */
export async function findClearAim(
  page: Page,
  captureId: string,
  doc: { width: number; height: number },
  band: { from: number; to: number } = { from: 0.25, to: 0.75 },
): Promise<{ x: number; y: number }> {
  const pins = await listPinTips(page, captureId);
  const rowCount = Math.max(
    1,
    Math.floor(((band.to - band.from) * doc.height) / CLEAR_MARGIN_NATURAL_PX),
  );
  for (let row = 0; row < rowCount; row += 1) {
    const y = doc.height * (band.from + ((band.to - band.from) * (row + 0.5)) / rowCount);
    for (let col = 0; col < 22; col += 1) {
      const candidate = { x: doc.width * (0.06 + 0.04 * col), y };
      const clear = pins.every(
        (pin) =>
          Math.hypot(pin.tip.x - candidate.x, pin.tip.y - candidate.y) >= CLEAR_MARGIN_NATURAL_PX,
      );
      if (clear) return candidate;
    }
  }
  throw new Error("no pin-free aim candidate remained on the document");
}
