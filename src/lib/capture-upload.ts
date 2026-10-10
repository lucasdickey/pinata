// Uploading captures from the editor's page (D131): reading a capture file
// the Chrome extension saved, preparing a plain image, and sending one
// device at a time to POST /api/imports. Client-safe: no server module is
// imported here, and nothing in a file is trusted — the server re-checks
// every byte and every element. These checks only catch the mistakes worth
// explaining before the upload starts.

import {
  CAPTURE_PACKAGE_FORMAT,
  CAPTURE_PACKAGE_VERSION,
  DESKTOP_VIEWPORT,
  MAX_DOCUMENT_HEIGHT_PX,
  MAX_DOCUMENT_PIXELS,
  MOBILE_VIEWPORT,
  UPLOAD_IMAGE_MAX_BYTES,
} from "./boundaries";
import { EDITOR_CSRF_HEADER } from "./auth-constants";
import { readCsrfProof } from "./csrf";

export type UploadVariant = "desktop" | "mobile";

/** One device in a capture file: its screenshot and its element list. */
export interface CapturePackageVariant {
  variant: UploadVariant;
  document: { width: number; height: number };
  /** The element list; checked strictly by the server, not here. */
  manifest: unknown;
  image: { contentType: string; base64: string };
}

/** A capture file as the extension saves it (format `pinata-capture`, v1). */
export interface CapturePackage {
  format: typeof CAPTURE_PACKAGE_FORMAT;
  version: typeof CAPTURE_PACKAGE_VERSION;
  source: { url: string; title?: string };
  /** ISO 8601. */
  capturedAt: string;
  variants: CapturePackageVariant[];
}

export type PackageParseResult =
  | { ok: true; value: CapturePackage }
  | { ok: false; reason: "not-json" | "not-a-capture" | "version" | "empty" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDimension = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

function parseVariant(value: unknown): CapturePackageVariant | null {
  if (!isRecord(value)) return null;
  const { variant, document, manifest, image } = value;
  if (variant !== "desktop" && variant !== "mobile") return null;
  if (!isRecord(document) || !isDimension(document.width) || !isDimension(document.height)) {
    return null;
  }
  if (!isRecord(image) || typeof image.contentType !== "string" || typeof image.base64 !== "string") {
    return null;
  }
  return {
    variant,
    document: { width: document.width, height: document.height },
    manifest: manifest ?? null,
    image: { contentType: image.contentType, base64: image.base64 },
  };
}

/** Read a capture file's text. One entry per device; the first of each wins. */
export function parseCapturePackage(text: string): PackageParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!isRecord(value) || value.format !== CAPTURE_PACKAGE_FORMAT) {
    return { ok: false, reason: "not-a-capture" };
  }
  if (value.version !== CAPTURE_PACKAGE_VERSION) return { ok: false, reason: "version" };
  const source = value.source;
  if (!isRecord(source) || typeof source.url !== "string") {
    return { ok: false, reason: "not-a-capture" };
  }
  if (!Array.isArray(value.variants)) return { ok: false, reason: "not-a-capture" };
  const variants: CapturePackageVariant[] = [];
  for (const entry of value.variants) {
    const parsed = parseVariant(entry);
    if (!parsed) return { ok: false, reason: "not-a-capture" };
    if (!variants.some((existing) => existing.variant === parsed.variant)) variants.push(parsed);
  }
  if (variants.length === 0) return { ok: false, reason: "empty" };
  // Desktop first, like everywhere else in Pinata.
  variants.sort((a, b) => (a.variant === b.variant ? 0 : a.variant === "desktop" ? -1 : 1));
  return {
    ok: true,
    value: {
      format: CAPTURE_PACKAGE_FORMAT,
      version: CAPTURE_PACKAGE_VERSION,
      source: {
        url: source.url,
        ...(typeof source.title === "string" ? { title: source.title } : {}),
      },
      capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : "",
      variants,
    },
  };
}

/** Decode base64 into bytes; null when it is not base64 at all. */
export function base64ToBytes(base64: string): Uint8Array | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** A capture file's element count for one device, for the summary line. */
export function packageElementCount(variant: CapturePackageVariant): number {
  const manifest = variant.manifest;
  return isRecord(manifest) && Array.isArray(manifest.elements) ? manifest.elements.length : 0;
}

/** The device a plain image most likely shows, from its width. */
export function guessVariant(width: number): UploadVariant {
  return width < 800 ? "mobile" : "desktop";
}

/**
 * The CSS-pixel width a plain image is scaled to: a high-DPR screenshot (at
 * least one and a half times the device's standard width) comes down to that
 * width, so it sits on the canvas at the size the page was laid out at;
 * anything narrower keeps its own pixels.
 */
export function targetWidth(width: number, variant: UploadVariant): number {
  const standard = variant === "desktop" ? DESKTOP_VIEWPORT.width : MOBILE_VIEWPORT.width;
  return width >= standard * 1.5 ? standard : width;
}

export type PreparedImage =
  | { ok: true; blob: Blob; width: number; height: number }
  | { ok: false; reason: "unreadable" | "too-tall" | "too-large" };

/** WebP qualities tried in turn until an image fits the upload cap. */
const QUALITIES = [0.92, 0.85, 0.75, 0.65, 0.5];

/**
 * Re-encode a plain image for upload: decoded, scaled for its device, and
 * written fresh as WebP (or PNG where the browser cannot write WebP), which
 * also drops whatever metadata the original file carried. The quality steps
 * down until the image fits the upload cap.
 */
export async function prepareImage(file: Blob, variant: UploadVariant): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const width = targetWidth(bitmap.width, variant);
  const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
  if (height > MAX_DOCUMENT_HEIGHT_PX || width * height > MAX_DOCUMENT_PIXELS) {
    bitmap.close();
    return { ok: false, reason: "too-tall" };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return { ok: false, reason: "unreadable" };
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  for (const quality of QUALITIES) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (!blob) return { ok: false, reason: "unreadable" };
    if (blob.size <= UPLOAD_IMAGE_MAX_BYTES) return { ok: true, blob, width, height };
    // A browser that cannot write WebP hands back PNG whatever the quality.
    if (blob.type !== "image/webp") break;
  }
  return { ok: false, reason: "too-large" };
}

/** Where an upload goes. */
export type ImportTarget =
  | { project: string; page?: string }
  | { newProject: { title?: string } };

export interface ImportMetaInput {
  idempotencyKey: string;
  target: ImportTarget;
  url?: string;
  variant: UploadVariant;
  capturedAt?: number;
  document: { width: number; height: number };
  manifest: unknown;
}

export interface ImportResponse {
  project: { publicId: string; title: string; created: boolean };
  page: { id: string; normalizedUrl: string; created: boolean };
  capture: { id: string; variant: UploadVariant; attempt: number; elements: number };
}

export type ImportOutcome =
  | { ok: true; value: ImportResponse }
  | { ok: false; status: number; code: string | null };

/** The multipart body of one import: the meta JSON and the image. */
export function importForm(meta: ImportMetaInput, image: Blob): FormData {
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  form.set("image", image, image.type === "image/png" ? "capture.png" : "capture.webp");
  return form;
}

/** Send one device to POST /api/imports as the signed-in editor. */
export async function sendImport(meta: ImportMetaInput, image: Blob): Promise<ImportOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/imports", {
      method: "POST",
      headers: { [EDITOR_CSRF_HEADER]: readCsrfProof() },
      body: importForm(meta, image),
    });
  } catch {
    return { ok: false, status: 0, code: null };
  }
  if (response.ok) return { ok: true, value: (await response.json()) as ImportResponse };
  let code: string | null = null;
  try {
    const body = (await response.json()) as { code?: unknown };
    code = typeof body.code === "string" ? body.code : null;
  } catch {
    code = null;
  }
  return { ok: false, status: response.status, code };
}

/** What to tell the editor when an upload was refused. */
export function importErrorMessage(outcome: { status: number; code: string | null }): string {
  switch (outcome.code) {
    case "invalid-image":
      return "That screenshot doesn't match the page size in the file, or isn't a PNG or WebP image.";
    case "image-too-large":
      return "That screenshot is too large to upload. Capture a shorter page or use a smaller image.";
    case "document-too-tall":
    case "too-many-pixels":
      return "That page is too tall to upload.";
    case "invalid-url":
      return "Pinata can't use that page address. It must start with http:// or https:// and have no password in it.";
    case "too-many-pages":
      return "This project has the most pages it can hold.";
    case "too-many-captures":
      return "This project has used up its screenshots.";
    default:
      break;
  }
  if (outcome.status === 0) return "Pinata could not reach the server. Try again.";
  if (outcome.status === 404) return "That project or page is no longer there. Reload and try again.";
  if (outcome.status === 409) return "Something changed while uploading. Try again.";
  if (outcome.status === 413) return "That upload is too large.";
  return "Pinata could not upload that capture. Try again.";
}
