// Screenshot byte validation (VAL-CAPTURE-014).
//
// Everything a capture stores passes through here first. The provider hands
// back base64 inside a JSON envelope, so the bytes are attacker-influenced in
// exactly the way a decoder cares about: they may be HTML, a provider error
// page, a truncated image, or a polyglot with a valid header and something
// else appended. The parsers below therefore read the container structurally
// and require it to end exactly where the file ends — a header check alone
// would accept every polyglot.
//
// Dimensions come out of the container, never out of the provider's own
// claim, so the DPR-1 geometry contract is checked against the real pixels.

import { createHash } from "node:crypto";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "../../boundaries";

export type ImageFormat = "png" | "webp";

export interface DecodedImage {
  format: ImageFormat;
  width: number;
  height: number;
}

export type ImageDecodeResult =
  | { ok: true; value: DecodedImage }
  /** Bounded, secret-free reason; safe to persist as a warning detail. */
  | { ok: false; reason: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CONTENT_TYPE_BY_FORMAT: Record<ImageFormat, string> = {
  png: "image/png",
  webp: "image/webp",
};

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! +
    bytes[offset + 1]! * 0x100 +
    bytes[offset + 2]! * 0x10000 +
    bytes[offset + 3]! * 0x1000000
  );
}

function decodePng(bytes: Uint8Array): ImageDecodeResult {
  let offset = PNG_SIGNATURE.length;
  let dimensions: { width: number; height: number } | null = null;

  while (offset + 8 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const next = offset + 12 + length;
    if (!Number.isSafeInteger(length) || next > bytes.length) return { ok: false, reason: "truncated" };

    if (dimensions === null) {
      if (type !== "IHDR" || length !== 13) return { ok: false, reason: "malformed" };
      dimensions = {
        width: readU32BE(bytes, offset + 8),
        height: readU32BE(bytes, offset + 12),
      };
    }

    if (type === "IEND") {
      // Anything after IEND is appended payload, not part of the image.
      if (next !== bytes.length) return { ok: false, reason: "trailing-bytes" };
      if (dimensions.width <= 0 || dimensions.height <= 0) {
        return { ok: false, reason: "bad-dimensions" };
      }
      return { ok: true, value: { format: "png", ...dimensions } };
    }
    offset = next;
  }
  return { ok: false, reason: "truncated" };
}

function decodeWebp(bytes: Uint8Array): ImageDecodeResult {
  if (bytes.length < 16) return { ok: false, reason: "truncated" };
  // The RIFF size counts everything after the 8-byte RIFF header, so an exact
  // match rules out both truncation and appended payload.
  if (readU32LE(bytes, 4) !== bytes.length - 8) return { ok: false, reason: "truncated" };

  const chunk = ascii(bytes, 12, 4);
  const body = 20;

  if (chunk === "VP8X" && bytes.length >= body + 10) {
    // Four flag bytes, then canvas width-1 and height-1 as 24-bit LE.
    const width = 1 + (bytes[body + 4]! | (bytes[body + 5]! << 8) | (bytes[body + 6]! << 16));
    const height = 1 + (bytes[body + 7]! | (bytes[body + 8]! << 8) | (bytes[body + 9]! << 16));
    return { ok: true, value: { format: "webp", width, height } };
  }
  if (chunk === "VP8L" && bytes.length >= body + 5) {
    if (bytes[body]! !== 0x2f) return { ok: false, reason: "malformed" };
    const bits = readU32LE(bytes, body + 1);
    return {
      ok: true,
      value: { format: "webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) },
    };
  }
  if (chunk === "VP8 " && bytes.length >= body + 10) {
    if (bytes[body + 3] !== 0x9d || bytes[body + 4] !== 0x01 || bytes[body + 5] !== 0x2a) {
      return { ok: false, reason: "malformed" };
    }
    const width = (bytes[body + 6]! | (bytes[body + 7]! << 8)) & 0x3fff;
    const height = (bytes[body + 8]! | (bytes[body + 9]! << 8)) & 0x3fff;
    if (width <= 0 || height <= 0) return { ok: false, reason: "bad-dimensions" };
    return { ok: true, value: { format: "webp", width, height } };
  }
  return { ok: false, reason: "malformed" };
}

/** Structurally decode PNG or WebP container bytes. Everything else fails. */
export function decodeImage(bytes: Uint8Array): ImageDecodeResult {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (startsWith(bytes, PNG_SIGNATURE)) return decodePng(bytes);
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return decodeWebp(bytes);
  }
  return { ok: false, reason: "unsupported-format" };
}

/** SHA-256 hex of exactly these bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface CaptureImageInput {
  /** Content type the provider declared for the screenshot. */
  declaredContentType: string;
  bytes: Uint8Array;
  /** Document dimensions the same stabilized result reported, in CSS px. */
  expected: { width: number; height: number };
}

export type CaptureImageResult =
  | {
      ok: true;
      contentType: string;
      format: ImageFormat;
      width: number;
      height: number;
      bytes: number;
      sha256: string;
    }
  | { ok: false; outcome: "invalid-image" | "image-bytes-exceeded"; reason: string };

/**
 * Accept a screenshot only when its declared type is allowed, its container
 * decodes cleanly, and its real pixel dimensions equal the document
 * dimensions from the same result. At DPR 1 those are the same number, so a
 * mismatch means the image and the manifest describe different layouts.
 */
export function validateCaptureImage(input: CaptureImageInput): CaptureImageResult {
  if (!ALLOWED_IMAGE_CONTENT_TYPES.includes(input.declaredContentType)) {
    return { ok: false, outcome: "invalid-image", reason: "content-type" };
  }
  if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, outcome: "image-bytes-exceeded", reason: "bytes" };
  }
  const decoded = decodeImage(input.bytes);
  if (!decoded.ok) return { ok: false, outcome: "invalid-image", reason: decoded.reason };
  if (CONTENT_TYPE_BY_FORMAT[decoded.value.format] !== input.declaredContentType) {
    return { ok: false, outcome: "invalid-image", reason: "content-type-mismatch" };
  }
  if (
    decoded.value.width !== input.expected.width ||
    decoded.value.height !== input.expected.height
  ) {
    return { ok: false, outcome: "invalid-image", reason: "dimension-mismatch" };
  }
  return {
    ok: true,
    contentType: input.declaredContentType,
    format: decoded.value.format,
    width: decoded.value.width,
    height: decoded.value.height,
    bytes: input.bytes.byteLength,
    sha256: sha256Hex(input.bytes),
  };
}
