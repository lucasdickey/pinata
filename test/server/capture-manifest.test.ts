// Server-side manifest bounding (VAL-CAPTURE-005, VAL-CAPTURE-006).
//
// The in-page pass already sanitizes; this suite proves the server does not
// trust it. Provider-shaped manifests with hostile strings, hostile
// rectangles, wrong keys, and oversized payloads are parsed, re-bounded, and
// re-measured here, and what is persisted always obeys both published caps.

import { describe, expect, test } from "vitest";
import {
  MANIFEST_ELEMENT_KEYS,
  MANIFEST_HINT_KEYS,
  MANIFEST_HINT_MAX_CHARS,
  MANIFEST_MAX_CLASSES,
  MANIFEST_PATH_MAX_DEPTH,
  MANIFEST_RECT_MAX_PX,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_TEXT_MAX_CHARS,
  MAX_MANIFEST_BYTES,
  MAX_MANIFEST_ELEMENTS,
} from "../../src/lib/boundaries";
import {
  boundManifest,
  sampleForCoverage,
  sanitizeManifestString,
} from "../../src/lib/server/captures/manifest";
import {
  captureManifestSchema,
  manifestFits,
  parseCaptureResponse,
} from "../../src/lib/server/captures/result";
import { successEnvelope } from "./capture-provider-fakes";

const rect = { x: 10, y: 20, width: 300, height: 40 };

function element(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    kind: "text",
    tag: "p",
    role: "",
    text: "Hello",
    accessibleName: "Hello",
    hints: { id: "", classes: [], alt: "", title: "", testId: "" },
    path: ["html:1", "body:1", "p:1"],
    rect: { ...rect },
    ...overrides,
  };
}

function manifest(elements: unknown[], truncated = false) {
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, truncated, elements };
}

describe("response schema: exact keys, finite numbers", () => {
  test("extra keys anywhere in the manifest reject the envelope", () => {
    const cases: Record<string, unknown>[] = [
      manifest([element({ outerHTML: "<p>Hello</p>" })]),
      { ...manifest([element()]), url: "https://leak.example" },
      manifest([{ ...element(), rect: { ...rect, href: "https://leak.example" } }]),
      manifest([{ ...element(), hints: { ...element().hints, value: "s3cret" } }]),
    ];
    for (const value of cases) {
      expect(captureManifestSchema.safeParse(value).success).toBe(false);
    }
  });

  test("non-finite or negative-extent rectangles reject the envelope", () => {
    for (const bad of [
      { ...rect, x: Number.NaN },
      { ...rect, y: Number.POSITIVE_INFINITY },
      { ...rect, width: -1 },
      { ...rect, height: Number.NEGATIVE_INFINITY },
    ]) {
      expect(captureManifestSchema.safeParse(manifest([element({ rect: bad })])).success).toBe(
        false,
      );
    }
  });

  test("an unknown kind rejects rather than being coerced", () => {
    expect(
      captureManifestSchema.safeParse(manifest([element({ kind: "script" })])).success,
    ).toBe(false);
  });

  test("more than the element cap rejects the envelope", () => {
    const many = Array.from({ length: MAX_MANIFEST_ELEMENTS + 1 }, (_, i) =>
      element({ id: `e${i}` }),
    );
    expect(captureManifestSchema.safeParse(manifest(many)).success).toBe(false);
  });

  test("a hostile manifest inside a full success envelope rejects the response", () => {
    const good = JSON.parse(successEnvelope()) as { data: { manifest: unknown } };
    good.data.manifest = manifest([element({ onclick: "alert(1)" })]);
    const body = new Uint8Array(Buffer.from(JSON.stringify(good), "utf8"));
    expect(parseCaptureResponse(body)).toBeNull();
  });
});

describe("sanitizeManifestString", () => {
  test("strips controls, bidi, separators, and caps stacked marks", () => {
    expect(sanitizeManifestString("a\u0000b\u001cc", 80)).toBe("abc");
    expect(sanitizeManifestString("x\u202ey\u202cz\u200bw\ufeffv", 80)).toBe("xyzwv");
    expect(sanitizeManifestString("line\u2028para\u2029", 80)).toBe("linepara");
    expect(sanitizeManifestString("\ufefffeff\ufeff", 80)).toBe("feff");
    const zalgo = sanitizeManifestString(`z${"\u0301".repeat(100)}`, 80);
    expect(zalgo.match(/\u0301/g)!.length).toBeLessThanOrEqual(8);
  });

  test("bounds by code point and never splits a surrogate pair", () => {
    const emoji = "\ud83d\udc69\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66\ud83c\udf89".repeat(50);
    const out = sanitizeManifestString(emoji, MANIFEST_TEXT_MAX_CHARS);
    expect(out.length).toBeLessThanOrEqual(MANIFEST_TEXT_MAX_CHARS);
    expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
    expect(sanitizeManifestString(123, 10)).toBe("");
  });
});

describe("boundManifest", () => {
  test("hostile fields are trimmed, not trusted, and keys stay exact", () => {
    const bounded = boundManifest(
      captureManifestSchema.parse(
        manifest([
          element({
            text: `before‮evil‬${"y".repeat(900)}`,
            accessibleName: `${"n".repeat(900)} `,
            hints: {
              id: "i".repeat(500),
              classes: ["ok", "c".repeat(500), ...Array.from({ length: 40 }, (_, i) => `k${i}`)],
              alt: "",
              title: "t".repeat(500),
              testId: "",
            },
            path: [
              "html:1",
              ...Array.from({ length: 40 }, () => "div:1"),
              "script>alert(1)</script:9",
            ],
          }),
        ]),
      ),
    );
    const el = bounded.manifest.elements[0]!;
    expect(Object.keys(el)).toEqual([...MANIFEST_ELEMENT_KEYS]);
    expect(Object.keys(el.hints)).toEqual([...MANIFEST_HINT_KEYS]);
    expect(el.text.startsWith("beforeevil")).toBe(true);
    expect(el.text.length).toBeLessThanOrEqual(MANIFEST_TEXT_MAX_CHARS);
    expect(el.accessibleName.length).toBeLessThanOrEqual(MANIFEST_TEXT_MAX_CHARS);
    expect(el.hints.id.length).toBeLessThanOrEqual(MANIFEST_HINT_MAX_CHARS);
    expect(el.hints.classes.length).toBeLessThanOrEqual(MANIFEST_MAX_CLASSES);
    expect(el.path.length).toBeLessThanOrEqual(MANIFEST_PATH_MAX_DEPTH);
    for (const segment of el.path) expect(segment).toMatch(/^[a-z][a-z0-9-]*:\d+$/);
    expect(manifestFits(bounded.manifest)).toBe(true);
  });

  test("a hostile rectangle drops only its own element", () => {
    const bounded = boundManifest(
      captureManifestSchema.parse(
        manifest([
          element({ id: "huge", rect: { x: 0, y: 0, width: MANIFEST_RECT_MAX_PX + 1, height: 5 } }),
          element({ id: "fine", rect: { x: 1.006, y: 2.994, width: 3, height: 4 } }),
        ]),
      ),
    );
    expect(bounded.dropped).toBe(1);
    expect(bounded.truncated).toBe(true);
    expect(bounded.manifest.elements).toHaveLength(1);
    expect(bounded.manifest.elements[0]!.rect).toEqual({
      x: 1.01,
      y: 2.99,
      width: 3,
      height: 4,
    });
  });

  test("duplicate and hostile ids are made unique and safe", () => {
    const bounded = boundManifest(
      captureManifestSchema.parse(
        manifest([element({ id: "e1" }), element({ id: "e1" }), element({ id: '"><x' })]),
      ),
    );
    const ids = bounded.manifest.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,16}$/);
  });

  test("the element cap truncates with deterministic top/middle/bottom coverage", () => {
    const rows = 800;
    const many = Array.from({ length: rows }, (_, i) =>
      element({ id: `e${i + 1}`, rect: { x: 0, y: i * 60, width: 800, height: 40 } }),
    );
    // Deliberately un-parsed: the schema already rejects this, and this test
    // proves the bounding layer would still hold the caps if it ever got one.
    const oversized = manifest(many) as Parameters<typeof boundManifest>[0];
    const bounded = boundManifest(oversized);
    expect(bounded.truncated).toBe(true);
    expect(bounded.manifest.elements.length).toBeLessThanOrEqual(MAX_MANIFEST_ELEMENTS);

    const kept = bounded.manifest.elements.map((e) => Number(e.id.slice(1)) - 1);
    expect(Math.min(...kept)).toBe(0);
    expect(Math.max(...kept)).toBe(rows - 1);
    const third = rows / 3;
    expect(kept.filter((i) => i < third).length).toBeGreaterThan(100);
    expect(kept.filter((i) => i >= third && i < third * 2).length).toBeGreaterThan(100);
    expect(kept.filter((i) => i >= third * 2).length).toBeGreaterThan(100);

    const again = boundManifest(oversized);
    expect(again.json).toBe(bounded.json);
  });

  test("the exact persisted UTF-8 JSON never exceeds the byte cap", () => {
    // 500 elements at ~950 bytes each: well over 256 KiB before bounding.
    const fat = Array.from({ length: MAX_MANIFEST_ELEMENTS }, (_, i) =>
      element({
        id: `e${i + 1}`,
        text: "x".repeat(MANIFEST_TEXT_MAX_CHARS),
        hints: {
          id: "",
          classes: Array.from({ length: MANIFEST_MAX_CLASSES }, (_, c) => `c${c}${"y".repeat(56)}`),
          alt: "",
          title: "",
          testId: "",
        },
      }),
    );
    const bounded = boundManifest(captureManifestSchema.parse(manifest(fat)));
    expect(bounded.truncated).toBe(true);
    expect(bounded.bytes).toBeLessThanOrEqual(MAX_MANIFEST_BYTES);
    expect(Buffer.byteLength(bounded.json, "utf8")).toBe(bounded.bytes);
    expect(JSON.parse(bounded.json).elements.length).toBe(bounded.manifest.elements.length);
    expect(bounded.manifest.elements.length).toBeGreaterThan(10);
  });

  test("a clean manifest round-trips untruncated", () => {
    const bounded = boundManifest(captureManifestSchema.parse(manifest([element(), element({ id: "e2", rect })])));
    expect(bounded.truncated).toBe(false);
    expect(bounded.dropped).toBe(0);
    expect(bounded.manifest.elements).toHaveLength(2);
  });
});

describe("sampleForCoverage", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    rect: { x: 0, y: i * 10 },
  }));

  test("always keeps the topmost and bottom-most elements", () => {
    for (const keep of [1, 2, 7, 50, 99]) {
      const kept = sampleForCoverage(rows, keep);
      expect(kept.length).toBeLessThanOrEqual(keep);
      expect(kept.some((r) => r.id === 0)).toBe(true);
      if (keep > 1) expect(kept.some((r) => r.id === 99)).toBe(true);
      expect([...kept].map((r) => r.id)).toEqual([...kept].map((r) => r.id).sort((a, b) => a - b));
    }
  });

  test("is a pure function of its input", () => {
    expect(sampleForCoverage(rows, 33)).toEqual(sampleForCoverage(rows, 33));
    expect(sampleForCoverage(rows, 200)).toHaveLength(100);
    expect(sampleForCoverage(rows, 0)).toHaveLength(0);
  });
});
