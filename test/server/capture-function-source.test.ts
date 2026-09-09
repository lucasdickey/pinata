// The Browserless function body is source text sent to a remote sandbox, so
// the things that must never be in it are as important as the things that
// must (VAL-CAPTURE-003, VAL-CAPTURE-004).
//
// These tests read the emitted text. They are the anti-drift mechanism for
// "capture never interacts with the target", "no caller data is compiled into
// executed code", and "no browser protection is disabled" — all of which are
// easy to break with one convenient line.

import { describe, expect, test } from "vitest";
import {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  SUPPORTED_MOTION,
  TOTAL_CAPTURE_TIMEOUT_MS,
} from "../../src/lib/boundaries";
import { DEVICE_PROFILES } from "../../src/lib/server/captures/devices";
import {
  buildCaptureFunctionSource,
  motionWarning,
} from "../../src/lib/server/captures/function-source";

const source = buildCaptureFunctionSource();

describe("function shape", () => {
  test("is the documented ESM default-export function", () => {
    expect(source).toContain("export default async ({ page, context }) =>");
    expect(source).toContain('type: "application/json"');
  });

  test("is a constant: no per-capture value is compiled into the code", () => {
    expect(buildCaptureFunctionSource()).toBe(source);
    for (const value of ["https://", "Bearer", "token", "BROWSERLESS"]) {
      expect(source, value).not.toContain(value);
    }
  });

  test("reads every per-capture value from context instead of a literal", () => {
    for (const key of [
      "context.targetUrl",
      "context.variant",
      "context.layoutNonce",
      "context.viewport.width",
      "context.userAgent",
      "context.imageType",
      "context.limits.navigationTimeoutMs",
      "context.limits.maxDocumentHeightPx",
      // The in-page passes receive the same object as their argument.
      "limits.lazyScrollStepPx",
      "limits.manifestMaxBytes",
    ]) {
      expect(source, key).toContain(key);
    }
  });

  test("carries no policy literal that belongs to the catalog", () => {
    for (const value of [
      DESKTOP_VIEWPORT.width,
      DESKTOP_VIEWPORT.height,
      MOBILE_VIEWPORT.width,
      MOBILE_VIEWPORT.height,
      TOTAL_CAPTURE_TIMEOUT_MS,
    ]) {
      expect(source, String(value)).not.toContain(String(value));
    }
  });

  test("installs the request guard before it navigates", () => {
    expect(source).toContain("__pinataGuard");
    expect(source.indexOf("__pinataInstallGuard(page)")).toBeGreaterThan(-1);
    expect(source.indexOf("__pinataInstallGuard(page)")).toBeLessThan(
      source.indexOf("page.goto("),
    );
  });
});

describe("capture never interacts with the target", () => {
  test.each([
    "page.click(",
    "page.type(",
    "page.tap(",
    "page.hover(",
    "page.focus(",
    "page.select(",
    "page.keyboard",
    "page.mouse",
    "page.touchscreen",
    ".dispatchEvent(",
    ".requestSubmit(",
    "window.open(",
    "location.assign(",
    "location.replace(",
    "location.href =",
    "form.submit(",
  ])("never calls %s", (forbidden) => {
    expect(source).not.toContain(forbidden);
  });

  test("its only navigation is the single admitted goto", () => {
    expect(source.match(/page\.goto\(/g)).toHaveLength(1);
    expect(source).toContain("waitUntil: \"domcontentloaded\"");
  });

  test("its only scrolling is window.scrollTo, and it ends at the top", () => {
    expect(source).toContain("window.scrollTo(0, y)");
    expect(source).toContain("window.scrollTo(0, 0)");
    expect(source.lastIndexOf("window.scrollTo(0, 0)")).toBeGreaterThan(
      source.indexOf("window.scrollTo(0, y)"),
    );
  });
});

describe("no browser protection is weakened", () => {
  test.each([
    "disable-web-security",
    "ignoreHTTPSErrors",
    "no-sandbox",
    "setBypassCSP",
    "setJavaScriptEnabled",
    "allow-running-insecure-content",
  ])("never uses %s", (forbidden) => {
    expect(source).not.toContain(forbidden);
  });
});

describe("stabilization follows the published motion matrix", () => {
  test("frozen means disabled, so two captures agree", () => {
    expect(source).toContain("animation:none !important");
    expect(source).toContain("transition:none !important");
  });

  test("carets are hidden without moving the field", () => {
    expect(source).toContain("caret-color:transparent !important");
  });

  test("web animations are paused and rewound to zero", () => {
    expect(source).toContain("document.getAnimations()");
    expect(source).toContain("].pause()");
    expect(source).toContain("].currentTime = 0");
  });

  test("videos are paused and animated images decode their default frame", () => {
    expect(source).toContain("videos[i].pause()");
    expect(source).toContain("createImageBitmap(");
  });

  test("every emitted warning code comes from the published matrix", () => {
    const published = new Set(SUPPORTED_MOTION.map((m) => `motion-${m.policy}:${m.case}`));
    const emitted = source.match(/motion-[a-z-]+:[a-z-]+/g) ?? [];
    expect(emitted.length).toBeGreaterThan(0);
    for (const code of emitted) expect(published, code).toContain(code);
  });

  test("unsupported and as-rendered cases warn rather than claim a freeze", () => {
    expect(source).toContain(motionWarning("canvas-js"));
    expect(source).toContain(motionWarning("sticky-parallax"));
    expect(motionWarning("canvas-js")).toBe("motion-unsupported-warn:canvas-js");
    expect(motionWarning("sticky-parallax")).toBe("motion-as-rendered:sticky-parallax");
    expect(() => motionWarning("not-a-case")).toThrow(/Unknown motion case/);
  });
});

describe("device profiles", () => {
  test("desktop and mobile are the contract devices at DPR 1", () => {
    expect(DEVICE_PROFILES.desktop.viewport).toEqual({
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });
    expect(DEVICE_PROFILES.mobile.viewport).toEqual({
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
  });

  test("only mobile overrides the user agent, and it claims a real mobile browser", () => {
    expect(DEVICE_PROFILES.desktop.userAgent).toBeNull();
    expect(DEVICE_PROFILES.mobile.userAgent).toMatch(/iPhone/);
    expect(DEVICE_PROFILES.mobile.userAgent).toMatch(/Mobile\/\w+ Safari/);
  });
});
