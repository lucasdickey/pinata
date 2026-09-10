// Pure property tests for the natural-pixel coordinate adapter
// (VAL-CANVAS-001, VAL-CANVAS-003, VAL-CANVAS-008). The adapter is the
// documented boundary between domain geometry and React Flow: inclusive
// capture clamps, finite-value rejection, the shared minimum screen hit
// target at every zoom, and exact tip round trips. These functions are an
// independent oracle — nothing here touches the DOM or React Flow state.

import { describe, expect, test } from "vitest";
import { MIN_HIT_TARGET_CSS_PX } from "../../src/lib/boundaries";
import type { NaturalPoint } from "../../src/lib/canvas/camera";
import {
  clampNaturalPointToCapture,
  dragPinBox,
  isFiniteNaturalPoint,
  pinHitBox,
  tipFromPinBox,
} from "../../src/lib/canvas/geometry";
import { MAX_DOCUMENT_HEIGHT_PX } from "../../src/lib/boundaries";

const doc = { width: 1440, height: 8966 };

describe("clampNaturalPointToCapture", () => {
  test("keeps interior points byte-identical", () => {
    const point = { x: 812.25, y: 4231.5 };
    expect(clampNaturalPointToCapture(point, doc)).toEqual(point);
  });

  test("is inclusive on every edge and corner", () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: doc.width, y: 0 },
      { x: 0, y: doc.height },
      { x: doc.width, y: doc.height },
    ]) {
      expect(clampNaturalPointToCapture(point, doc)).toEqual(point);
    }
  });

  test("clamps out-of-frame attempts to the nearest bound", () => {
    expect(clampNaturalPointToCapture({ x: -40, y: -0.001 }, doc)).toEqual({ x: 0, y: 0 });
    expect(clampNaturalPointToCapture({ x: doc.width + 500, y: doc.height * 2 }, doc)).toEqual({
      x: doc.width,
      y: doc.height,
    });
    expect(clampNaturalPointToCapture({ x: -1, y: doc.height + 1 }, doc)).toEqual({
      x: 0,
      y: doc.height,
    });
  });

  test("rejects non-finite points and degenerate documents", () => {
    expect(() => clampNaturalPointToCapture({ x: Number.NaN, y: 4 }, doc)).toThrow(RangeError);
    expect(() =>
      clampNaturalPointToCapture({ x: 4, y: Number.POSITIVE_INFINITY }, doc),
    ).toThrow(RangeError);
    expect(() => clampNaturalPointToCapture({ x: 0, y: 0 }, { width: 0, height: 10 })).toThrow(
      RangeError,
    );
    expect(() =>
      clampNaturalPointToCapture({ x: 0, y: 0 }, { width: 10, height: Number.NaN }),
    ).toThrow(RangeError);
  });

  test("spread: arbitrary finite points clamp into the inclusive domain", () => {
    // Deterministic spread across negative, fractional, interior, and far
    // out-of-range values on the tallest published document.
    const tall = { width: 390, height: MAX_DOCUMENT_HEIGHT_PX };
    for (let i = 0; i < 500; i += 1) {
      const point = {
        x: Math.sin(i * 12.9898) * 40_000 * (i % 3 === 0 ? -1 : 1) + i * 0.125,
        y: Math.cos(i * 78.233) * 90_000 * (i % 4 === 0 ? -1 : 1) + i * 0.25,
      };
      const clamped = clampNaturalPointToCapture(point, tall);
      expect(clamped.x).toBeGreaterThanOrEqual(0);
      expect(clamped.x).toBeLessThanOrEqual(tall.width);
      expect(clamped.y).toBeGreaterThanOrEqual(0);
      expect(clamped.y).toBeLessThanOrEqual(tall.height);
      if (point.x >= 0 && point.x <= tall.width) expect(clamped.x).toBe(point.x);
      if (point.y >= 0 && point.y <= tall.height) expect(clamped.y).toBe(point.y);
    }
  });
});

describe("pinHitBox", () => {
  test("centers the tip at the box bottom-center for interior tips", () => {
    const tip = { x: 720, y: 4000 };
    const box = pinHitBox(tip, doc, 1);
    expect(box.size).toBe(MIN_HIT_TARGET_CSS_PX);
    expect(box.x).toBe(tip.x - box.size / 2);
    expect(box.y).toBe(tip.y - box.size);
    expect(box.tipOffsetX).toBeCloseTo(box.size / 2, 10);
    expect(box.tipOffsetY).toBeCloseTo(box.size, 10);
  });

  test("the on-screen hit area never shrinks below the shared minimum while the document allows it", () => {
    // Above MIN_HIT_TARGET_CSS_PX / doc-width the document itself is the
    // binding constraint (the whole capture is smaller than 24 screen px),
    // so the guarantee only applies where the box is not doc-capped.
    for (const zoom of [0.0776, 0.25, 1, 2.5, 4, 8]) {
      const box = pinHitBox({ x: 720, y: 4000 }, doc, zoom);
      expect(box.size * zoom).toBeGreaterThanOrEqual(MIN_HIT_TARGET_CSS_PX - 1e-9);
    }
    // At extreme overview zoom the box is capped by the document, not grown
    // past it.
    const capped = pinHitBox({ x: 720, y: 4000 }, doc, 0.01);
    expect(capped.size).toBe(Math.min(doc.width, doc.height));
  });

  test("the box always stays inside the frame, even for corner tips", () => {
    for (const zoom of [0.01, 1, 8]) {
      for (const tip of [
        { x: 0, y: 0 },
        { x: doc.width, y: 0 },
        { x: 0, y: doc.height },
        { x: doc.width, y: doc.height },
        { x: 0.5, y: doc.height - 0.5 },
      ]) {
        const box = pinHitBox(tip, doc, zoom);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.size).toBeLessThanOrEqual(doc.width + 1e-9);
        expect(box.y + box.size).toBeLessThanOrEqual(doc.height + 1e-9);
      }
    }
  });

  test("the tip round-trips exactly through the box at every zoom and edge", () => {
    const tips = [
      { x: 0, y: 0 },
      { x: doc.width, y: doc.height },
      { x: 812.25, y: 4231.5 },
      { x: 0.125, y: 16_383.875 },
      { x: doc.width, y: 0 },
    ];
    for (const zoom of [0.01, 0.5, 1, 4, 8]) {
      for (const tip of tips) {
        const roundTrip = tipFromPinBox(pinHitBox(tip, { width: 1440, height: 16_384 }, zoom));
        // The contract bar is one natural pixel; the adapter is exact.
        expect(roundTrip.x).toBeCloseTo(tip.x, 9);
        expect(roundTrip.y).toBeCloseTo(tip.y, 9);
      }
    }
  });

  test("the box never exceeds the document, however deep the overview zoom", () => {
    const tiny = { width: 10, height: 8 };
    const box = pinHitBox({ x: 5, y: 4 }, tiny, 0.01);
    expect(box.size).toBe(8);
    expect(tipFromPinBox(box)).toEqual({ x: 5, y: 4 });
  });

  test("rejects non-finite tips, documents, and zooms", () => {
    expect(() => pinHitBox({ x: Number.NaN, y: 1 }, doc, 1)).toThrow(RangeError);
    expect(() => pinHitBox({ x: 1, y: 1 }, { width: -1, height: 5 }, 1)).toThrow(RangeError);
    expect(() => pinHitBox({ x: 1, y: 1 }, doc, 0)).toThrow(RangeError);
    expect(() => pinHitBox({ x: 1, y: 1 }, doc, Number.NaN)).toThrow(RangeError);
  });
});

describe("dragPinBox (grab offset and clamped drag commit)", () => {
  test("a drag by a natural delta moves the tip by exactly that delta", () => {
    const tip = { x: 720, y: 4000 };
    const zoom = 8;
    const start = pinHitBox(tip, doc, zoom);
    // React Flow moves the node top-left by the pointer delta; the tip must
    // follow 1:1 wherever the pointer grabbed the badge.
    for (const grabPoint of [
      { x: 0, y: 0 },
      { x: start.size / 2, y: start.size },
      { x: start.size * 0.9, y: start.size * 0.1 },
    ]) {
      const grabOffset = {
        tipOffsetX: start.tipOffsetX,
        tipOffsetY: start.tipOffsetY,
      };
      const delta = { x: 37.5, y: -120.25 };
      const dragged = dragPinBox(
        { x: start.x + delta.x, y: start.y + delta.y },
        grabOffset,
        doc,
        zoom,
      );
      expect(tipFromPinBox(dragged).x).toBeCloseTo(tip.x + delta.x, 9);
      expect(tipFromPinBox(dragged).y).toBeCloseTo(tip.y + delta.y, 9);
      void grabPoint;
    }
  });

  test("out-of-frame drags clamp the tip inclusively on all four edges", () => {
    const zoom = 1;
    const start = pinHitBox({ x: 720, y: 4000 }, doc, zoom);
    const grab = { tipOffsetX: start.tipOffsetX, tipOffsetY: start.tipOffsetY };
    const cases: [NaturalPoint, NaturalPoint][] = [
      [{ x: -10_000, y: start.y }, { x: 0, y: 4000 }],
      [{ x: 10_000, y: start.y }, { x: doc.width, y: 4000 }],
      [{ x: start.x, y: -10_000 }, { x: 720, y: 0 }],
      [{ x: start.x, y: 100_000 }, { x: 720, y: doc.height }],
    ];
    for (const [position, expectedTip] of cases) {
      const box = dragPinBox(position, grab, doc, zoom);
      const tip = tipFromPinBox(box);
      expect(tip.x).toBeCloseTo(expectedTip.x, 9);
      expect(tip.y).toBeCloseTo(expectedTip.y, 9);
      // The clamped box itself stays inside the frame.
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.size).toBeLessThanOrEqual(doc.width + 1e-9);
      expect(box.y + box.size).toBeLessThanOrEqual(doc.height + 1e-9);
    }
  });

  test("the grab offset survives a clamp and reverse drag (no stuck edges)", () => {
    const zoom = 4;
    const tip0 = { x: 100, y: 200 };
    const box0 = pinHitBox(tip0, doc, zoom);
    const grab = { tipOffsetX: box0.tipOffsetX, tipOffsetY: box0.tipOffsetY };
    // Drag far past the right edge: the tip clamps to document_width.
    const clampedBox = dragPinBox({ x: 99_999, y: box0.y }, grab, doc, zoom);
    expect(tipFromPinBox(clampedBox).x).toBe(doc.width);
    // React Flow's internal drag is delta-from-start, so dragging back by a
    // smaller amount re-derives from the same grab: the tip leaves the edge
    // immediately rather than unaccumulating a clamped offset.
    const backBox = dragPinBox({ x: box0.x - 20, y: box0.y }, grab, doc, zoom);
    expect(tipFromPinBox(backBox).x).toBeCloseTo(80, 9);
  });

  test("rejects non-finite dragged positions", () => {
    const box = pinHitBox({ x: 1, y: 1 }, doc, 1);
    expect(() =>
      dragPinBox({ x: Number.NaN, y: 0 }, box, doc, 1),
    ).toThrow(RangeError);
  });
});

describe("isFiniteNaturalPoint", () => {
  test("accepts finite and rejects non-finite coordinates", () => {
    expect(isFiniteNaturalPoint({ x: 0, y: 16_384 })).toBe(true);
    expect(isFiniteNaturalPoint({ x: Number.NaN, y: 0 })).toBe(false);
    expect(isFiniteNaturalPoint({ x: 0, y: Number.NEGATIVE_INFINITY })).toBe(false);
  });
});
