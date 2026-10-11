// The capture engine (D131): one tab, through the Chrome DevTools Protocol,
// the way the capture provider drives its own browser.
//
// For each device it emulates that device's viewport at DPR 1, lets the page
// settle, walks it once so lazy content loads, disables animation and
// transition, runs the provider's own element pass (INSPECT_SOURCE, shared
// verbatim), and takes one full-page screenshot of exactly the document the
// element pass measured. The screenshot is WebP, its quality lowered until it
// fits one upload. Then it puts the tab back: the style it added comes out,
// the emulation ends, and the page scrolls to where it was.
//
// It is a spectator, like the provider: no click, no typing, no navigation.
// The page is the editor's own, signed in; nothing in it is read beyond the
// element pass's bounded, sanitized fields and the pixels.

import {
  CAPTURE_LIMITS,
  DEVICE_PROFILES,
  INSPECT_SOURCE,
  MAX_DOCUMENT_HEIGHT_PX,
  MAX_DOCUMENT_PIXELS,
  UPLOAD_IMAGE_MAX_BYTES,
} from "./shared.generated.js";

const PROTOCOL_VERSION = "1.3";

/** WebP qualities tried in turn until a screenshot fits one upload. */
const QUALITIES = [90, 82, 74, 66, 58, 50, 40];

/** WebP cannot encode a side longer than this; taller pages fall back to PNG. */
const WEBP_MAX_SIDE = 16383;

/** Settling time after a viewport change, for resize-driven re-renders. */
const RESIZE_SETTLE_MS = 450;

/** A capture failure with a code the popup can explain. */
export class CaptureError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Wait for fonts and two frames, at the top of the page. */
const SETTLE = `(async () => {
  window.scrollTo(0, 0);
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (error) {}
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.scrollTo(0, 0);
  return true;
})()`;

/** Walk the page in bounded steps so lazy content loads, then return to the top. */
const SCROLL_PASS = `(async (limits) => {
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
  return { steps: steps, height: docHeight() };
})`;

/** Disable motion for the screenshot, the way the provider does. */
const STABILIZE_ON = `(() => {
  if (document.querySelector('style[data-pinata-capture="extension"]')) return true;
  const style = document.createElement("style");
  style.setAttribute("data-pinata-capture", "extension");
  style.textContent =
    "*,*::before,*::after{animation:none !important;transition:none !important;" +
    "caret-color:transparent !important;scroll-behavior:auto !important}";
  (document.head || document.documentElement).appendChild(style);
  return true;
})()`;

/** Take the capture style back out. */
const STABILIZE_OFF = `(() => {
  const style = document.querySelector('style[data-pinata-capture="extension"]');
  if (style) style.remove();
  return true;
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bytes a base64 string decodes to, without decoding it. */
export function base64Bytes(base64) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Whether Chrome lets an extension attach to this address at all. */
export function capturableUrl(url) {
  if (typeof url !== "string") return false;
  return /^(https?|file):/i.test(url) && !/^https:\/\/chrome(webstore)?\.google\.com\//i.test(url);
}

/**
 * Capture one tab on the given devices, Desktop first. Resolves to one shot
 * per device; rejects with a CaptureError. `onProgress` hears each step.
 */
export async function captureTab(tabId, variants, onProgress = () => {}) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, PROTOCOL_VERSION);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    throw new CaptureError(
      /already attached/i.test(message) ? "busy" : "attach",
      /already attached/i.test(message)
        ? "Another tool is controlling this tab. Close it and try again."
        : "Chrome won't let an extension capture this tab.",
    );
  }

  let detached = false;
  const onDetach = (source) => {
    if (source.tabId === tabId) detached = true;
  };
  chrome.debugger.onDetach.addListener(onDetach);

  const send = async (method, params = {}) => {
    if (detached) throw new CaptureError("cancelled", "The capture was cancelled.");
    try {
      return await chrome.debugger.sendCommand(target, method, params);
    } catch (error) {
      if (detached) throw new CaptureError("cancelled", "The capture was cancelled.");
      throw error;
    }
  };
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new CaptureError("page", "The page stopped Pinata from reading it.");
    }
    return result.result ? result.result.value : undefined;
  };
  const optional = async (method, params) => {
    try {
      await send(method, params);
    } catch (error) {
      if (error instanceof CaptureError) throw error;
      // An experimental command this Chrome does not have; the capture is
      // still correct without it.
    }
  };

  let original = null;
  try {
    original = await evaluate("({ x: window.scrollX, y: window.scrollY })");
    await optional("Page.bringToFront", {});
    await optional("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await optional("Emulation.setScrollbarsHidden", { hidden: true });

    const shots = [];
    for (const variant of variants) {
      const profile = DEVICE_PROFILES[variant];
      if (!profile) throw new CaptureError("variant", "Unknown device.");
      const { viewport } = profile;
      onProgress({ step: "layout", variant });
      await send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor,
        mobile: viewport.isMobile,
        screenWidth: viewport.width,
        screenHeight: viewport.height,
      });
      await optional("Emulation.setTouchEmulationEnabled", {
        enabled: viewport.hasTouch,
        maxTouchPoints: viewport.hasTouch ? 5 : 1,
      });
      if (profile.userAgent) {
        await optional("Emulation.setUserAgentOverride", { userAgent: profile.userAgent });
      }
      await sleep(RESIZE_SETTLE_MS);
      await evaluate(SETTLE);

      onProgress({ step: "scroll", variant });
      const pass = await evaluate(`${SCROLL_PASS}(${JSON.stringify(CAPTURE_LIMITS)})`);
      if (pass && pass.height > MAX_DOCUMENT_HEIGHT_PX) {
        throw new CaptureError("too-tall", "This page is too tall for one capture.");
      }

      await evaluate(STABILIZE_ON);
      await evaluate(SETTLE);
      onProgress({ step: "elements", variant });
      const inspection = await evaluate(
        `(${INSPECT_SOURCE})(${JSON.stringify({ limits: CAPTURE_LIMITS, layoutNonce: "" })})`,
      );
      if (!inspection || !inspection.document || !inspection.manifest) {
        throw new CaptureError("page", "Pinata could not read this page's layout.");
      }
      const width = Math.round(inspection.document.width);
      const height = Math.round(inspection.document.height);
      if (height > MAX_DOCUMENT_HEIGHT_PX) {
        throw new CaptureError("too-tall", "This page is too tall for one capture.");
      }
      if (width * height > MAX_DOCUMENT_PIXELS) {
        throw new CaptureError("too-big", "This page is too large for one capture.");
      }

      onProgress({ step: "screenshot", variant });
      const clip = { x: 0, y: 0, width, height, scale: 1 };
      const formats =
        width <= WEBP_MAX_SIDE && height <= WEBP_MAX_SIDE
          ? QUALITIES.map((quality) => ({ format: "webp", quality }))
          : [{ format: "png" }];
      let image = null;
      for (const { format, quality } of formats) {
        const shot = await send("Page.captureScreenshot", {
          format,
          ...(quality ? { quality } : {}),
          clip,
          captureBeyondViewport: true,
          fromSurface: true,
        });
        if (base64Bytes(shot.data) <= UPLOAD_IMAGE_MAX_BYTES) {
          image = { contentType: `image/${format}`, base64: shot.data };
          break;
        }
      }
      await evaluate(STABILIZE_OFF);
      if (!image) {
        throw new CaptureError("too-large", "This page's screenshot is too large to upload.");
      }
      shots.push({
        variant,
        viewport: { width: viewport.width, height: viewport.height },
        document: { width, height },
        title: inspection.document.title || "",
        manifest: inspection.manifest,
        image,
      });
    }
    return shots;
  } finally {
    // Put the tab back as it was, best effort: the style out, the emulation
    // off, the scroll position restored, and the debugger gone.
    if (!detached) {
      try {
        await chrome.debugger.sendCommand(target, "Runtime.evaluate", { expression: STABILIZE_OFF });
        await chrome.debugger.sendCommand(target, "Emulation.clearDeviceMetricsOverride", {});
        if (original) {
          await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
            expression: `window.scrollTo(${Number(original.x) || 0}, ${Number(original.y) || 0})`,
          });
        }
      } catch (error) {
        // The tab may be gone; there is nothing left to restore.
      }
      try {
        await chrome.debugger.detach(target);
      } catch (error) {
        // Already detached.
      }
    }
    chrome.debugger.onDetach.removeListener(onDetach);
  }
}
