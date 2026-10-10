// The Chrome extension's pure pieces (D131, D132), checked against the
// server's own rules: the capture file it writes is one the upload form
// reads, the page identity it matches with is the server's, and the small
// helpers behave at their edges. The DevTools-protocol capture itself is
// exercised end to end in a real Chromium, not here.

import { describe, expect, test } from "vitest";
import { base64Bytes, capturableUrl } from "../extension/capture.js";
import {
  buildPackage,
  normalizedAddress,
  packageFilename,
  pageAddress,
} from "../extension/package.js";
import { serverOrigin, signedIn } from "../extension/settings.js";
import { parseCapturePackage } from "../src/lib/capture-upload";
import { normalizeUploadUrl } from "../src/lib/url/normalize";

const shot = (variant: "desktop" | "mobile") => ({
  variant,
  viewport: variant === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
  document: { width: variant === "desktop" ? 1440 : 390, height: 2000 },
  title: "Settings",
  manifest: { schemaVersion: 1, truncated: false, elements: [] },
  image: { contentType: "image/webp", base64: "UklGRg==" },
});

describe("the capture file", () => {
  test("what the extension writes is what the upload form reads", () => {
    const pkg = buildPackage({
      url: "https://app.example.com/settings?tab=billing",
      title: "Settings",
      capturedAt: Date.UTC(2026, 9, 10, 12, 0, 0),
      shots: [shot("desktop"), shot("mobile")],
      extensionVersion: "0.1.0",
    });
    const parsed = parseCapturePackage(JSON.stringify(pkg));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.source).toEqual({
      url: "https://app.example.com/settings?tab=billing",
      title: "Settings",
    });
    expect(parsed.value.capturedAt).toBe("2026-10-10T12:00:00.000Z");
    expect(parsed.value.variants.map((entry) => entry.variant)).toEqual(["desktop", "mobile"]);
  });

  test("its file name is safe and says what it is", () => {
    const at = new Date(2026, 9, 10, 9, 5).getTime();
    expect(packageFilename("https://app.example.com/x", at)).toBe(
      "pinata-app.example.com-2026-10-10-0905.pinata.json",
    );
    expect(packageFilename("http://[::1]:3000/", at)).toBe("pinata-1-2026-10-10-0905.pinata.json");
    expect(packageFilename("not a url", at)).toBe("pinata-page-2026-10-10-0905.pinata.json");
  });
});

describe("page addresses", () => {
  test("the address a capture is filed under drops the fragment and an empty query", () => {
    expect(pageAddress("https://app.example.com/a?x=1#top")).toBe("https://app.example.com/a?x=1");
    expect(pageAddress("https://app.example.com/a?")).toBe("https://app.example.com/a");
  });

  test("the extension's page identity is the server's for every address it can send", () => {
    for (const url of [
      "https://app.example.com/settings?tab=billing#plans",
      "https://App.Example.com./Settings",
      "https://example.com",
      "http://localhost:3000/dashboard",
      "http://127.0.0.1:3100/pins/new",
      "https://staging.example.com:8443/a?",
      "http://[::1]:8080/x",
    ]) {
      const server = normalizeUploadUrl(url);
      expect(server.ok, url).toBe(true);
      if (server.ok) expect(normalizedAddress(url), url).toBe(server.url);
    }
    expect(normalizedAddress("chrome://extensions")).toBeNull();
  });
});

describe("helpers", () => {
  test("base64 byte counts match the decoded length", () => {
    for (const bytes of [0, 1, 2, 3, 4, 5, 1000]) {
      const encoded = Buffer.alloc(bytes, 7).toString("base64");
      expect(base64Bytes(encoded), String(bytes)).toBe(bytes);
    }
  });

  test("Chrome's own pages and the Web Store are not capturable", () => {
    expect(capturableUrl("https://app.example.com/")).toBe(true);
    expect(capturableUrl("http://localhost:3000/")).toBe(true);
    expect(capturableUrl("chrome://settings")).toBe(false);
    expect(capturableUrl("https://chromewebstore.google.com/detail/x")).toBe(false);
    expect(capturableUrl(undefined)).toBe(false);
  });

  test("a Pinata address is an http(s) origin; a token is good until it expires", () => {
    expect(serverOrigin(" https://yourpinata.dev/pins ")).toBe("https://yourpinata.dev");
    expect(serverOrigin("ftp://example.com")).toBeNull();
    expect(serverOrigin("nope")).toBeNull();
    const now = Date.UTC(2026, 9, 10);
    expect(signedIn({ token: null, expiresAt: null }, now)).toBe(false);
    expect(signedIn({ token: "x1.a.b", expiresAt: new Date(now + 1000).toISOString() }, now)).toBe(true);
    expect(signedIn({ token: "x1.a.b", expiresAt: new Date(now - 1000).toISOString() }, now)).toBe(false);
  });
});
