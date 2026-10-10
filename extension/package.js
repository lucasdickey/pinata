// The capture file (D131): what "Download" saves and what Pinata's upload
// form reads — format `pinata-capture`, version 1, one entry per device with
// its screenshot (base64) and the page's element list. It is the same data
// "Send to Pinata" uploads, so either path ends in the same capture.

import { CAPTURE_PACKAGE_FORMAT, CAPTURE_PACKAGE_VERSION } from "./shared.generated.js";

/** The page address a capture is filed under: no fragment, no empty query. */
export function pageAddress(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    // An empty query reads back as "" but stays in the href as a bare "?".
    return parsed.search === "" && parsed.href.endsWith("?") ? parsed.href.slice(0, -1) : parsed.href;
  } catch {
    return url;
  }
}

/**
 * The identity Pinata gives an address, for matching it against a project's
 * pages before sending: the server's own rule decides in the end.
 */
export function normalizedAddress(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.endsWith(".") ? parsed.hostname.slice(0, -1) : parsed.hostname;
    const port = parsed.port ? `:${parsed.port}` : "";
    const path = parsed.pathname || "/";
    return `${parsed.protocol}//${host}${port}${path}${parsed.search}`;
  } catch {
    return null;
  }
}

/** Build the capture file for one capture of one page. */
export function buildPackage({ url, title, capturedAt, shots, extensionVersion }) {
  return {
    format: CAPTURE_PACKAGE_FORMAT,
    version: CAPTURE_PACKAGE_VERSION,
    source: { url, title: title || "" },
    capturedAt: new Date(capturedAt).toISOString(),
    tool: { name: "Pinata Chrome extension", version: extensionVersion },
    variants: shots.map((shot) => ({
      variant: shot.variant,
      viewport: shot.viewport,
      document: shot.document,
      manifest: shot.manifest,
      image: shot.image,
    })),
  };
}

/** `pinata-<host>-<yyyy-mm-dd>-<hhmm>.pinata.json`, safe on every filesystem. */
export function packageFilename(url, capturedAt) {
  let host = "page";
  try {
    host = new URL(url).hostname || "page";
  } catch {
    host = "page";
  }
  const safeHost = host.replace(/[^a-z0-9.-]+/gi, "-").replace(/^[.-]+|[.-]+$/g, "") || "page";
  const at = new Date(capturedAt);
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `pinata-${safeHost}-${stamp}.pinata.json`;
}
