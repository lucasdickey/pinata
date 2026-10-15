// Capture a seed's HTML page the way the Chrome extension does (D131): the
// device's viewport at scale 1, the provider's own element pass
// (extension/shared.generated.js), and a screenshot of the whole document.
// The page is served from the seed folder to this browser alone, under the
// address the seed gives it, and every other request is refused, so nothing
// leaves the machine. The result is one variant of a `.pinata.json` capture
// file: what POST /api/imports takes.

import { readFile } from "node:fs/promises";
import {
  CAPTURE_LIMITS,
  DEVICE_PROFILES,
  MAX_DOCUMENT_HEIGHT_PX,
  UPLOAD_IMAGE_MAX_BYTES,
  INSPECT_SOURCE,
} from "../../extension/shared.generated.js";

/**
 * @param {import("@playwright/test").Browser} browser
 * @param {{ file: string, url: string, variant: "desktop" | "mobile" }} options
 * @returns {Promise<{ variant: string, document: { width: number, height: number },
 *   title: string, manifest: object, image: { contentType: string, bytes: Buffer } }>}
 */
export async function captureSite(browser, { file, url, variant }) {
  const profile = DEVICE_PROFILES[variant];
  if (!profile) throw new Error(`Unknown device: ${variant}`);
  const html = await readFile(file, "utf8");
  const { viewport } = profile;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    ...(profile.userAgent ? { userAgent: profile.userAgent } : {}),
    reducedMotion: "reduce",
  });
  try {
    await context.route("**/*", (route) =>
      route.request().url() === url
        ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html })
        : route.abort(),
    );
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const inspection = await page.evaluate(
      `(${INSPECT_SOURCE})(${JSON.stringify({ limits: CAPTURE_LIMITS, layoutNonce: "" })})`,
    );
    const width = Math.round(inspection.document.width);
    const height = Math.round(inspection.document.height);
    if (height > MAX_DOCUMENT_HEIGHT_PX) throw new Error(`${url} is too tall to capture.`);
    const bytes = await page.screenshot({
      type: "png",
      fullPage: true,
      clip: { x: 0, y: 0, width, height },
      scale: "css",
    });
    if (bytes.byteLength > UPLOAD_IMAGE_MAX_BYTES) throw new Error(`${url} is too large to import.`);
    return {
      variant,
      document: { width, height },
      title: inspection.document.title || "",
      manifest: inspection.manifest,
      image: { contentType: "image/png", bytes },
    };
  } finally {
    await context.close();
  }
}
