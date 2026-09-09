// Test-only PNG encoder and pixel decoder.
//
// The application never needs pixels — it validates containers and hashes
// bytes — but capture tests do: the lazy/motion assertions are about what is
// actually painted at a document coordinate, and the reproducibility
// assertion compares two captures pixel by pixel. Node's zlib is the only
// dependency, so this stays inside the approved package set.

import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crcInput = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(crcInput) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}

export interface EncodeOptions {
  width: number;
  height: number;
  /** RGB fill applied to every pixel. */
  rgb?: [number, number, number];
}

/** Encode a valid 8-bit RGB PNG of a solid colour. */
export function encodeSolidPng(options: EncodeOptions): Uint8Array {
  const { width, height } = options;
  const [r, g, b] = options.rgb ?? [255, 255, 255];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  return new Uint8Array(
    Buffer.concat([
      SIGNATURE,
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

export interface DecodedPixels {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8Array;
  pixelAt(x: number, y: number): [number, number, number, number];
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decode an 8-bit non-interlaced RGB/RGBA/grey PNG into RGBA pixels. */
export function decodePngPixels(bytes: Uint8Array): DecodedPixels {
  const buf = Buffer.from(bytes);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`unsupported bit depth ${data[8]}`);
      colorType = data[9]!;
      if (data[12] !== 0) throw new Error("interlaced PNG is not supported");
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (channels === 0) throw new Error(`unsupported colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prior = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = prior[i]!;
      const c = i >= channels ? prior[i - channels]! : 0;
      const x = line[i]!;
      if (filter === 1) line[i] = (x + a) & 0xff;
      else if (filter === 2) line[i] = (x + b) & 0xff;
      else if (filter === 3) line[i] = (x + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) line[i] = (x + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`unsupported filter ${filter}`);
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      if (channels === 1) {
        out[dst] = line[src]!;
        out[dst + 1] = line[src]!;
        out[dst + 2] = line[src]!;
        out[dst + 3] = 255;
      } else {
        out[dst] = line[src]!;
        out[dst + 1] = line[src + 1]!;
        out[dst + 2] = line[src + 2]!;
        out[dst + 3] = channels === 4 ? line[src + 3]! : 255;
      }
    }
    prior = line;
  }

  return {
    width,
    height,
    data: out,
    pixelAt(x, y) {
      const i = (y * width + x) * 4;
      return [out[i]!, out[i + 1]!, out[i + 2]!, out[i + 3]!];
    },
  };
}
