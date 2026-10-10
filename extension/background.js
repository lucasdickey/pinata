// The extension's service worker (D131, D132): it runs a capture so that
// closing the popup does not stop it, then either sends each device to
// Pinata or saves the capture file. Progress lives in chrome.storage.session
// (the popup reads it when it opens) and on the toolbar badge.
//
// If sending fails after the capture worked, the capture is saved as a file
// instead, so nothing that was captured is lost: the file uploads from
// Pinata's own "Upload a capture".

import { importShot } from "./api.js";
import { CaptureError, captureTab } from "./capture.js";
import { buildPackage, packageFilename } from "./package.js";
import { readSettings, writeSettings } from "./settings.js";

const VARIANT_LABEL = { desktop: "Desktop", mobile: "Mobile" };

let running = false;

async function setStatus(status) {
  await chrome.storage.session.set({ status: { ...status, at: Date.now() } });
  chrome.runtime.sendMessage({ type: "status", status }).catch(() => undefined);
}

function badge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => undefined);
  if (color) chrome.action.setBadgeBackgroundColor({ color }).catch(() => undefined);
}

function clearBadgeSoon() {
  setTimeout(() => badge(""), 6000);
}

// ---- saving a file ------------------------------------------------------------
// A service worker has no URL.createObjectURL, and a data: URL longer than
// Chrome's 2 MB URL limit cannot be downloaded, so the file's bytes go to an
// offscreen document that makes the blob URL the download reads.

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Save a capture file the extension made.",
  });
}

async function saveFile(pkg, filename) {
  await ensureOffscreen();
  const json = JSON.stringify(pkg);
  const { url } = await chrome.runtime.sendMessage({ type: "offscreen-blob", json });
  try {
    await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
  } finally {
    // The download has the bytes once it starts; release the blob a little later.
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: "offscreen-revoke", url }).catch(() => undefined);
    }, 60_000);
  }
}

// ---- sending ------------------------------------------------------------------

function imageBlob(image) {
  const binary = atob(image.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: image.contentType });
}

/**
 * Send each device in turn. The first names the project (or asks for a new
 * one); the rest name the page the first one landed on.
 */
async function sendShots({ target, url, capturedAt, shots }) {
  let next = target;
  let last = null;
  for (const shot of shots) {
    await setStatus({ state: "working", message: `Sending ${VARIANT_LABEL[shot.variant]}…` });
    last = await importShot(
      {
        idempotencyKey: crypto.randomUUID(),
        target: next,
        url,
        variant: shot.variant,
        capturedAt,
        document: shot.document,
        manifest: shot.manifest,
      },
      imageBlob(shot.image),
    );
    next = { project: last.project.publicId, page: last.page.id };
  }
  return last;
}

// ---- one job ------------------------------------------------------------------

async function run(job) {
  const capturedAt = Date.now();
  badge("…", "#c9381a");
  await setStatus({ state: "working", message: "Capturing…" });
  let shots;
  try {
    shots = await captureTab(job.tabId, job.variants, ({ step, variant }) => {
      const device = VARIANT_LABEL[variant];
      const words = {
        layout: `Laying out ${device}…`,
        scroll: `Loading the whole ${device} page…`,
        elements: `Reading ${device} elements…`,
        screenshot: `Taking the ${device} screenshot…`,
      };
      void setStatus({ state: "working", message: words[step] ?? "Capturing…" });
    });
  } catch (error) {
    badge("!", "#b3261e");
    clearBadgeSoon();
    await setStatus({
      state: "error",
      message:
        error instanceof CaptureError ? error.message : "The capture didn't work. Try again.",
    });
    return;
  }

  const title = shots[0]?.title || job.title || "";
  const pkg = buildPackage({
    url: job.url,
    title,
    capturedAt,
    shots,
    extensionVersion: chrome.runtime.getManifest().version,
  });
  const filename = packageFilename(job.url, capturedAt);

  if (job.action === "download") {
    try {
      await saveFile(pkg, filename);
    } catch {
      badge("!", "#b3261e");
      clearBadgeSoon();
      await setStatus({ state: "error", message: "The capture file could not be saved." });
      return;
    }
    badge("✓", "#2f7d4f");
    clearBadgeSoon();
    await setStatus({
      state: "done",
      message: `Saved ${filename}. Upload it in Pinata with “Upload a capture”.`,
    });
    return;
  }

  try {
    const result = await sendShots({ target: job.target, url: job.url, capturedAt, shots });
    const settings = await readSettings();
    const host = new URL(job.url).host;
    await writeSettings({
      lastProjectByHost: { ...settings.lastProjectByHost, [host]: result.project.publicId },
    });
    badge("✓", "#2f7d4f");
    clearBadgeSoon();
    const devices = shots.map((shot) => VARIANT_LABEL[shot.variant]).join(" and ");
    await setStatus({
      state: "done",
      message: `Sent ${devices} to ${result.project.title}.`,
      link: new URL(
        `/pins?project=${encodeURIComponent(result.project.publicId)}`,
        settings.server,
      ).href,
    });
  } catch (error) {
    // The capture worked; keep it.
    let saved = false;
    try {
      await saveFile(pkg, filename);
      saved = true;
    } catch {
      saved = false;
    }
    badge("!", "#b3261e");
    clearBadgeSoon();
    const reason = error && error.message ? error.message : "Pinata didn't take the capture.";
    await setStatus({
      state: "error",
      message: saved
        ? `${reason} The capture was saved as ${filename}; upload it in Pinata instead.`
        : reason,
      ...(error && error.status === 401 ? { signedOut: true } : {}),
    });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "capture") return false;
  if (running) {
    sendResponse({ started: false, reason: "A capture is already running." });
    return false;
  }
  running = true;
  sendResponse({ started: true });
  run(message.job).finally(() => {
    running = false;
  });
  return false;
});
