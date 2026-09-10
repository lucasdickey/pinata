// Shared helpers for the canvas e2e specs (VAL-CANVAS-001/002/003/006/008):
// editor sign-in, ready-capture discovery against the local durable store,
// live camera reads from the supported viewport element, and the pure
// flow/screen transforms the measurements invert. Everything is read-only.

import { expect, type Page } from "@playwright/test";
import { CANVAS_MAX_ZOOM, CANVAS_PADDING_PX } from "../src/lib/canvas/camera";
import { requireLocalEnvValue } from "./local-env";

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
}

/**
 * A deterministic ready capture with persisted natural dimensions: always
 * the device's server-default capture (exactly the plane the workspace
 * opens when the device button is clicked), never an arbitrary ready
 * attempt. The seeded Chickpea pages are preferred so specs stay stable
 * while sibling specs create captures concurrently in the shared local
 * store; without a seeded match the first default ready capture wins.
 */
export async function findReadyTarget(
  page: Page,
  variant?: "desktop" | "mobile",
): Promise<ReadyTarget | null> {
  return page.evaluate(async (wanted) => {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      projects: {
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
    }[] = [];
    for (const project of payload.projects) {
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
            });
          }
        }
      }
    }
    const chosen = candidates.find((c) => c.seeded) ?? candidates[0] ?? null;
    if (!chosen) return null;
    return {
      pageUrl: chosen.pageUrl,
      variant: chosen.variant,
      captureId: chosen.captureId,
      width: chosen.width,
      height: chosen.height,
    };
  }, variant);
}

/** The navigation button name for a plane in the workspace tree. */
export function deviceButtonName(target: ReadyTarget): string {
  return `${target.variant === "desktop" ? "Desktop" : "Mobile"} capture of ${target.pageUrl}`;
}

/** Select a plane and wait for its screenshot to decode at natural size. */
export async function openPlane(page: Page, target: ReadyTarget): Promise<void> {
  await page.getByRole("button", { name: deviceButtonName(target), exact: true }).click();
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
