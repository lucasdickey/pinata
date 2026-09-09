// The Browserless Function API body: one execution produces one stabilized
// layout, and the screenshot, the manifest, and the geometry all come from
// that same state (VAL-CAPTURE-003, VAL-CAPTURE-004, VAL-CAPTURE-005).
//
// Three rules shape this file:
//
//  1. It is *source text*, executed in the provider's sandbox. Nothing the
//     caller supplies is interpolated into it — the target URL, variant,
//     limits, and nonce all arrive as `context` data at call time. The only
//     build-time interpolations are the request guard and the published
//     motion warning codes.
//  2. Capture is a spectator. The only page-directed actions are emulation,
//     navigation, bounded waiting, scrolling, capture-only style and
//     animation stabilization, read-only measurement, and the screenshot.
//     There is no click, type, tap, hover, focus, submit, or in-page
//     navigation anywhere below, and `capture-function-source.test.ts` greps
//     the emitted text to keep it that way.
//  3. Stabilization must be reproducible, not merely still. Animations are
//     disabled rather than frozen mid-frame, Web Animations are rewound to
//     zero, and an animated image is covered by the frame `createImageBitmap`
//     decodes. What cannot be made reproducible — video frames,
//     script-painted canvases, scroll-positioned sticky layers — is reported
//     as a bounded warning from the published motion matrix instead of being
//     silently claimed as frozen.
//
// Each `page.evaluate` argument is serialized and re-parsed inside the page,
// so those functions may not reference anything from the surrounding module:
// every helper and constant they need is repeated inside them on purpose.

import { SUPPORTED_MOTION } from "../../boundaries";
import { buildRequestGuardSource } from "./guard";
import { MANIFEST_INSPECT_SOURCE } from "./manifest-source";

/** Envelope version returned in `data.schemaVersion`. */
export const CAPTURE_RESULT_SCHEMA_VERSION = 1;

/** Bounded failure codes the function itself may return. */
export const CAPTURE_FUNCTION_FAILURE_CODES = [
  "navigation-timeout",
  "total-timeout",
  "document-too-tall",
  "too-many-pixels",
  "browserless-provider",
] as const;

export type CaptureFunctionFailureCode = (typeof CAPTURE_FUNCTION_FAILURE_CODES)[number];

/** Warning code for one published motion case, e.g. `motion-paused:video`. */
export function motionWarning(motionCase: string): string {
  const entry = SUPPORTED_MOTION.find((m) => m.case === motionCase);
  if (!entry) throw new Error(`Unknown motion case: ${motionCase}`);
  return `motion-${entry.policy}:${entry.case}`;
}

const WARN_VIDEO = motionWarning("video");
const WARN_CANVAS = motionWarning("canvas-js");
const WARN_STICKY = motionWarning("sticky-parallax");
const WARN_ANIMATED_IMAGE = motionWarning("animated-image");

/**
 * The ESM function body Browserless executes. It is a pure constant: every
 * per-capture value travels in `context`.
 */
export function buildCaptureFunctionSource(): string {
  return `${buildRequestGuardSource()}\n${CAPTURE_BODY}`;
}

const CAPTURE_BODY = String.raw`
export default async ({ page, context }) => {
  const startedAt = Date.now();
  const warnings = [];
  const addWarning = (code) => {
    if (warnings.length < 16 && warnings.indexOf(code) === -1) warnings.push(code);
  };
  const overBudget = () => Date.now() - startedAt > context.limits.totalTimeoutMs;
  const done = (data) => ({ data: data, type: "application/json" });
  const failure = (code) =>
    done({
      schemaVersion: ${CAPTURE_RESULT_SCHEMA_VERSION},
      ok: false,
      code: code,
      layoutNonce: context.layoutNonce,
      warnings: warnings,
      blocked: __pinataBlocked.slice(0, 32)
    });

  await __pinataInstallGuard(page);

  await page.setViewport({
    width: context.viewport.width,
    height: context.viewport.height,
    deviceScaleFactor: context.viewport.deviceScaleFactor,
    isMobile: context.viewport.isMobile,
    hasTouch: context.viewport.hasTouch
  });
  if (context.userAgent) await page.setUserAgent(context.userAgent);
  try {
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  } catch (error) {
    // An older provider image may not expose the feature; the capture-only
    // stylesheet below stabilizes motion explicitly either way.
  }

  try {
    await page.goto(context.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: context.limits.navigationTimeoutMs
    });
  } catch (error) {
    return failure("navigation-timeout");
  }
  try {
    await page.waitForNetworkIdle({ idleTime: 500, timeout: context.limits.networkIdleTimeoutMs });
  } catch (error) {
    // A page that never goes idle (polling, ads, telemetry) is still
    // capturable; the lazy scroll below gives it more settling time.
  }
  if (overBudget()) return failure("total-timeout");

  const scrollPass = await page.evaluate(PINATA_SCROLL_PASS, context.limits);
  if (scrollPass.height > context.limits.maxDocumentHeightPx) return failure("document-too-tall");
  if (scrollPass.height * scrollPass.width > context.limits.maxDocumentPixels) {
    return failure("too-many-pixels");
  }
  if (overBudget()) return failure("total-timeout");

  try {
    await page.evaluate(PINATA_SETTLE);
    const before = await page.evaluate(PINATA_ANCHORS, context.limits);
    const stabilization = await page.evaluate(PINATA_STABILIZE, context);
    const after = await page.evaluate(PINATA_ANCHORS, context.limits);
    for (const code of stabilization.warnings) addWarning(code);

    let maxAnchorShiftPx = 0;
    const anchorsMeasured = Math.min(before.length, after.length);
    for (let i = 0; i < anchorsMeasured; i += 1) {
      maxAnchorShiftPx = Math.max(
        maxAnchorShiftPx,
        Math.abs(before[i].x - after[i].x),
        Math.abs(before[i].y - after[i].y),
        Math.abs(before[i].w - after[i].w),
        Math.abs(before[i].h - after[i].h)
      );
    }

    const inspection = await page.evaluate(PINATA_INSPECT, context);
    if (inspection.document.height > context.limits.maxDocumentHeightPx) {
      return failure("document-too-tall");
    }
    if (inspection.document.height * inspection.document.width > context.limits.maxDocumentPixels) {
      return failure("too-many-pixels");
    }
    if (inspection.manifest.truncated) addWarning("manifest-truncated");
    if (overBudget()) return failure("total-timeout");

    const shot = await page.screenshot({
      fullPage: true,
      type: context.imageType,
      encoding: "base64"
    });
    const base64 = typeof shot === "string" ? shot : Buffer.from(shot).toString("base64");

    return done({
      schemaVersion: ${CAPTURE_RESULT_SCHEMA_VERSION},
      ok: true,
      variant: context.variant,
      layoutNonce: context.layoutNonce,
      requestedUrl: context.targetUrl,
      finalUrl: page.url(),
      viewport: inspection.viewport,
      document: {
        width: inspection.document.width,
        height: inspection.document.height,
        title: inspection.document.title,
        scrollX: inspection.document.scrollX,
        scrollY: inspection.document.scrollY,
        scrollSteps: scrollPass.steps
      },
      stabilization: {
        animationsPaused: stabilization.animationsPaused,
        videosPaused: stabilization.videosPaused,
        videos: stabilization.videos,
        animatedImagesFrozen: stabilization.animatedImagesFrozen,
        canvasCount: stabilization.canvasCount,
        stickyCount: stabilization.stickyCount,
        anchorsMeasured: anchorsMeasured,
        maxAnchorShiftPx: Math.round(maxAnchorShiftPx * 100) / 100
      },
      manifest: inspection.manifest,
      image: { contentType: context.imageContentType, base64: base64 },
      warnings: warnings,
      blocked: __pinataBlocked.slice(0, 32)
    });
  } catch (error) {
    return failure("browserless-provider");
  }
};

/** Walk the page in bounded steps so lazy content loads, then return to top. */
const PINATA_SCROLL_PASS = async (limits) => {
  const docHeight = () => {
    const body = document.body;
    const root = document.documentElement;
    return Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      root.scrollHeight,
      root.offsetHeight
    );
  };
  let steps = 0;
  let y = 0;
  while (steps < limits.lazyScrollMaxSteps) {
    const height = docHeight();
    if (height > limits.maxDocumentHeightPx) break;
    y = Math.min(y + limits.lazyScrollStepPx, height);
    window.scrollTo(0, y);
    steps += 1;
    await new Promise((resolve) => setTimeout(resolve, limits.lazyScrollStepDelayMs));
    if (window.scrollY + window.innerHeight >= docHeight() - 1) break;
  }
  window.scrollTo(0, 0);
  const body = document.body;
  const root = document.documentElement;
  return {
    steps: steps,
    height: docHeight(),
    width: Math.max(body ? body.scrollWidth : 0, root.scrollWidth, window.innerWidth)
  };
};

/** Return to the top and wait for fonts plus two frames. */
const PINATA_SETTLE = async () => {
  window.scrollTo(0, 0);
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch (error) {
      /* fonts that never resolve must not fail the capture */
    }
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.scrollTo(0, 0);
};

/** Document-space rectangles of a deterministic sample of layout anchors. */
const PINATA_ANCHORS = (limits) => {
  const nodes = document.querySelectorAll(
    "h1,h2,h3,h4,p,li,section,article,header,footer,main,nav,table,img,a,button,input"
  );
  const out = [];
  for (let i = 0; i < nodes.length && out.length < limits.anchorSampleMax; i += 1) {
    const rect = nodes[i].getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    out.push({
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      w: rect.width,
      h: rect.height
    });
  }
  return out;
};

/** Apply the published motion matrix; report what was frozen and what was not. */
const PINATA_STABILIZE = async (context) => {
  const warnings = [];
  const warn = (code) => {
    if (warnings.indexOf(code) === -1) warnings.push(code);
  };

  const style = document.createElement("style");
  style.setAttribute("data-pinata-capture", "stabilize");
  // Disabling rather than pausing is what makes the result reproducible: a
  // paused animation freezes on whatever frame the clock happened to reach.
  style.textContent =
    "*,*::before,*::after{animation:none !important;transition:none !important;" +
    "caret-color:transparent !important;scroll-behavior:auto !important}";
  (document.head || document.documentElement).appendChild(style);

  let animationsPaused = 0;
  if (document.getAnimations) {
    const animations = document.getAnimations();
    for (let i = 0; i < animations.length; i += 1) {
      try {
        animations[i].pause();
        animations[i].currentTime = 0;
        animationsPaused += 1;
      } catch (error) {
        /* an animation that refuses to rewind is still covered by the CSS */
      }
    }
  }

  const videos = document.querySelectorAll("video");
  let videosPaused = 0;
  for (let i = 0; i < videos.length; i += 1) {
    try {
      videos[i].autoplay = false;
      videos[i].pause();
      if (videos[i].paused) videosPaused += 1;
    } catch (error) {
      /* an unpausable video is reported through the counts below */
    }
  }
  if (videos.length > 0) warn("${WARN_VIDEO}");

  const canvasCount = document.querySelectorAll("canvas").length;
  if (canvasCount > 0) warn("${WARN_CANVAS}");

  let stickyCount = 0;
  const all = document.querySelectorAll("*");
  for (let i = 0; i < all.length && i < context.limits.stickyScanMax; i += 1) {
    const position = getComputedStyle(all[i]).position;
    if (position === "sticky" || position === "fixed") stickyCount += 1;
  }
  if (stickyCount > 0) warn("${WARN_STICKY}");

  const overlay = document.createElement("div");
  overlay.setAttribute("data-pinata-capture", "overlay");
  overlay.style.cssText =
    "position:absolute;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;" +
    "overflow:visible;pointer-events:none;z-index:2147483646";
  (document.body || document.documentElement).appendChild(overlay);

  const isAnimated = (bytes) => {
    const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (head === "GIF8") {
      let frames = 0;
      for (let i = 0; i + 2 < bytes.length; i += 1) {
        if (bytes[i] === 0x00 && bytes[i + 1] === 0x21 && bytes[i + 2] === 0xf9) frames += 1;
        if (frames > 1) return true;
      }
      return false;
    }
    let text = "";
    for (let i = 0; i < bytes.length && i < 4096; i += 1) text += String.fromCharCode(bytes[i]);
    if (head === "\x89PNG") return text.indexOf("acTL") !== -1;
    if (head === "RIFF") return text.indexOf("ANIM") !== -1 || text.indexOf("ANMF") !== -1;
    return false;
  };

  const animatable = /\.(gif|apng|webp)(\?|#|$)/i;
  const images = document.images;
  let animatedImagesFrozen = 0;
  let inspected = 0;
  for (let i = 0; i < images.length && inspected < context.limits.animatedImageScanMax; i += 1) {
    const img = images[i];
    const src = img.currentSrc || img.src || "";
    if (!src) continue;
    const dataAnimated =
      src.indexOf("data:image/gif") === 0 ||
      src.indexOf("data:image/webp") === 0 ||
      src.indexOf("data:image/apng") === 0;
    if (!animatable.test(src) && !dataAnimated) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    inspected += 1;
    try {
      const response = await fetch(src, { cache: "force-cache" });
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > context.limits.animatedImageMaxBytes) {
        warn("${WARN_ANIMATED_IMAGE}");
        continue;
      }
      if (!isAnimated(new Uint8Array(buffer))) continue;
      // createImageBitmap decodes the format's default frame, so this is the
      // first frame rather than whichever frame happened to be showing.
      const bitmap = await createImageBitmap(new Blob([buffer]));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(rect.width));
      canvas.height = Math.max(1, Math.round(rect.height));
      canvas.style.cssText =
        "position:absolute;margin:0;padding:0;border:0;left:" +
        (rect.left + window.scrollX) + "px;top:" + (rect.top + window.scrollY) +
        "px;width:" + rect.width + "px;height:" + rect.height + "px";
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      overlay.appendChild(canvas);
      animatedImagesFrozen += 1;
    } catch (error) {
      // Opaque cross-origin bytes cannot be re-decoded; say so rather than
      // claiming the image was frozen.
      warn("${WARN_ANIMATED_IMAGE}");
    }
  }

  const nonce = document.createElement("div");
  nonce.setAttribute("data-pinata-capture", "nonce");
  nonce.textContent = context.layoutNonce;
  nonce.style.cssText =
    "position:absolute;left:0;top:0;margin:0;padding:2px 4px;border:0;" +
    "font:12px/16px monospace;color:#111111;background:#ffffff;white-space:nowrap;" +
    "pointer-events:none;z-index:2147483647";
  overlay.appendChild(nonce);

  window.scrollTo(0, 0);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  return {
    warnings: warnings,
    animationsPaused: animationsPaused,
    videos: videos.length,
    videosPaused: videosPaused,
    animatedImagesFrozen: animatedImagesFrozen,
    canvasCount: canvasCount,
    stickyCount: stickyCount
  };
};

/** Read the stabilized layout: geometry, device observations, and manifest. */
const PINATA_INSPECT = ${MANIFEST_INSPECT_SOURCE};
`;
