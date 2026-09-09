// Screenshot byte validation before upload or ready state (VAL-CAPTURE-014).
//
// The provider hands back base64 in a JSON envelope, so these bytes could be
// an error page, a truncation, or a polyglot with a real header and something
// appended. Every one of those must fail before anything is stored, and the
// hash that is stored must be over the exact bytes.

import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from "../../src/lib/boundaries";
import {
  decodeImage,
  sha256Hex,
  validateCaptureImage,
} from "../../src/lib/server/captures/image";
import { encodeSolidPng } from "../helpers/png";

const PNG = encodeSolidPng({ width: 40, height: 25, rgb: [12, 34, 56] });

/** Minimal valid lossy WebP container with a 40 × 25 canvas. */
function lossyWebp(width: number, height: number): Uint8Array {
  const body = Buffer.alloc(20);
  body[3] = 0x9d;
  body[4] = 0x01;
  body[5] = 0x2a;
  body.writeUInt16LE(width, 6);
  body.writeUInt16LE(height, 8);
  const chunk = Buffer.concat([Buffer.from("VP8 ", "ascii"), Buffer.alloc(4), body]);
  chunk.writeUInt32LE(body.length, 4);
  const riff = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.alloc(4),
    Buffer.from("WEBP", "ascii"),
    chunk,
  ]);
  riff.writeUInt32LE(riff.length - 8, 4);
  return new Uint8Array(riff);
}

const validate = (bytes: Uint8Array, contentType = "image/png", width = 40, height = 25) =>
  validateCaptureImage({ declaredContentType: contentType, bytes, expected: { width, height } });

describe("container decoding", () => {
  test("a real PNG reports its own pixel dimensions", () => {
    expect(decodeImage(PNG)).toEqual({ ok: true, value: { format: "png", width: 40, height: 25 } });
  });

  test("a real WebP reports its own canvas dimensions", () => {
    expect(decodeImage(lossyWebp(40, 25))).toEqual({
      ok: true,
      value: { format: "webp", width: 40, height: 25 },
    });
  });

  test.each([
    ["HTML", Buffer.from("<!doctype html><h1>Gateway timeout</h1>")],
    ["JSON", Buffer.from('{"error":"provider exploded"}')],
    ["plain provider text", Buffer.from("Bad Gateway")],
    ["empty bytes", Buffer.alloc(0)],
    ["a JPEG", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])],
  ])("%s never decodes as an image", (_label, bytes) => {
    expect(decodeImage(new Uint8Array(bytes)).ok).toBe(false);
  });

  test("a truncated PNG is rejected rather than half-read", () => {
    expect(decodeImage(PNG.subarray(0, PNG.length - 20))).toEqual({
      ok: false,
      reason: "truncated",
    });
  });

  test("a polyglot with payload appended after IEND is rejected", () => {
    const polyglot = new Uint8Array(PNG.length + 32);
    polyglot.set(PNG, 0);
    polyglot.set(Buffer.from("<script>alert(1)</script>       "), PNG.length);
    expect(decodeImage(polyglot)).toEqual({ ok: false, reason: "trailing-bytes" });
  });

  test("a polyglot with an image hidden behind a prefix is rejected", () => {
    const prefixed = new Uint8Array(PNG.length + 16);
    prefixed.set(Buffer.from("GIF89a          "), 0);
    prefixed.set(PNG, 16);
    expect(decodeImage(prefixed)).toEqual({ ok: false, reason: "unsupported-format" });
  });

  test("a WebP whose RIFF size disagrees with its bytes is rejected", () => {
    const webp = lossyWebp(40, 25);
    const truncated = webp.subarray(0, webp.length - 4);
    expect(decodeImage(truncated)).toEqual({ ok: false, reason: "truncated" });
  });
});

describe("capture image validation", () => {
  test("an allowed, correctly sized image is accepted with an exact hash", () => {
    const result = validate(PNG);
    expect(result).toMatchObject({
      ok: true,
      contentType: "image/png",
      format: "png",
      width: 40,
      height: 25,
      bytes: PNG.byteLength,
    });
    expect(result.ok && result.sha256).toBe(
      createHash("sha256").update(PNG).digest("hex"),
    );
    expect(sha256Hex(PNG)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("only published content types are storable", () => {
    expect(ALLOWED_IMAGE_CONTENT_TYPES).toEqual(["image/png", "image/webp"]);
    expect(validate(PNG, "image/jpeg")).toEqual({
      ok: false,
      outcome: "invalid-image",
      reason: "content-type",
    });
    expect(validate(PNG, "text/html")).toMatchObject({ outcome: "invalid-image" });
  });

  test("a declared type that disagrees with the real container is rejected", () => {
    expect(validate(PNG, "image/webp")).toEqual({
      ok: false,
      outcome: "invalid-image",
      reason: "content-type-mismatch",
    });
  });

  test("dimensions must equal the document dimensions from the same result", () => {
    expect(validate(PNG, "image/png", 40, 26)).toEqual({
      ok: false,
      outcome: "invalid-image",
      reason: "dimension-mismatch",
    });
    expect(validate(PNG, "image/png", 41, 25)).toMatchObject({ reason: "dimension-mismatch" });
  });

  test("bytes over the published cap fail as image-bytes-exceeded, not invalid-image", () => {
    const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
    oversized.set(PNG, 0);
    expect(validate(oversized)).toEqual({
      ok: false,
      outcome: "image-bytes-exceeded",
      reason: "bytes",
    });
  });

  test("a provider error body declared as an image never validates", () => {
    const body = new Uint8Array(Buffer.from('{"error":"Function timed out","stack":"..."}'));
    expect(validate(body)).toMatchObject({ ok: false, outcome: "invalid-image" });
  });
});
