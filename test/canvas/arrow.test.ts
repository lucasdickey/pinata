// Pure property tests for arrow geometry (D083, VAL-MARK-002,
// VAL-CANVAS-001, VAL-CANVAS-003): an arrow keeps its direction because the
// head is what it means, both endpoints stay inside the frame, the minimum
// length is the published constant, a shaft move keeps length and direction
// exactly, an endpoint drag moves one end alone and never shortens the arrow
// past the minimum, and hit-testing is distance to the segment rather than to
// a box. These are the canvas's single clamping authority for arrows; the
// server applies the same two rules and rejects instead of clamping.

import { describe, expect, test } from "vitest";
import { ARROW_HIT_TOLERANCE_CSS_PX, MIN_ARROW_LENGTH_PX } from "../../src/lib/boundaries";
import {
  arrowBounds,
  arrowFromPoints,
  arrowHitsPoint,
  arrowLength,
  arrowMidpoint,
  arrowsEqual,
  clampArrowToCapture,
  distanceToArrow,
  dragArrowEndpoint,
  isFiniteArrow,
  meetsMinimumArrowLength,
  translateArrow,
  type NaturalArrow,
} from "../../src/lib/canvas/arrow";

const doc = { width: 1440, height: 8966 };
const arrow: NaturalArrow = { start: { x: 100, y: 200 }, end: { x: 400, y: 600 } };

describe("arrowFromPoints", () => {
  test("the press is the tail and the release is the head: they are never reordered", () => {
    expect(arrowFromPoints({ x: 400, y: 600 }, { x: 100, y: 200 }, doc)).toEqual({
      start: { x: 400, y: 600 },
      end: { x: 100, y: 200 },
    });
  });

  test("both endpoints are clamped to the frame, inclusively", () => {
    expect(arrowFromPoints({ x: -50, y: -50 }, { x: 5000, y: 99_999 }, doc)).toEqual({
      start: { x: 0, y: 0 },
      end: { x: doc.width, y: doc.height },
    });
  });

  test("a press with no travel is a zero-length arrow, which is below the minimum", () => {
    const drawn = arrowFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 }, doc);
    expect(arrowLength(drawn)).toBe(0);
    expect(meetsMinimumArrowLength(drawn)).toBe(false);
  });

  test("exactly the minimum length draws", () => {
    const drawn = arrowFromPoints({ x: 100, y: 100 }, { x: 100 + MIN_ARROW_LENGTH_PX, y: 100 }, doc);
    expect(arrowLength(drawn)).toBe(MIN_ARROW_LENGTH_PX);
    expect(meetsMinimumArrowLength(drawn)).toBe(true);
    const short = arrowFromPoints({ x: 100, y: 100 }, { x: 100 + MIN_ARROW_LENGTH_PX - 0.5, y: 100 }, doc);
    expect(meetsMinimumArrowLength(short)).toBe(false);
  });

  test("rejects non-finite points", () => {
    expect(() => arrowFromPoints({ x: Number.NaN, y: 0 }, { x: 1, y: 1 }, doc)).toThrow(RangeError);
  });
});

describe("clampArrowToCapture", () => {
  test("pulls both endpoints inside without reordering them", () => {
    expect(
      clampArrowToCapture({ start: { x: -10, y: 5 }, end: { x: 5000, y: 20 } }, doc),
    ).toEqual({ start: { x: 0, y: 5 }, end: { x: doc.width, y: 20 } });
  });

  test("rejects non-finite values", () => {
    expect(() =>
      clampArrowToCapture({ start: { x: 0, y: Number.NaN }, end: { x: 1, y: 1 } }, doc),
    ).toThrow(RangeError);
  });
});

describe("translateArrow", () => {
  test("moves the whole arrow, keeping its length and direction exactly", () => {
    const moved = translateArrow(arrow, { x: 25, y: -15 }, doc);
    expect(moved).toEqual({ start: { x: 125, y: 185 }, end: { x: 425, y: 585 } });
    expect(arrowLength(moved)).toBeCloseTo(arrowLength(arrow), 9);
  });

  test("slides along the frame edge rather than clipping an endpoint", () => {
    const pushed = translateArrow(arrow, { x: 99_999, y: 99_999 }, doc);
    expect(arrowLength(pushed)).toBeCloseTo(arrowLength(arrow), 9);
    const bounds = arrowBounds(pushed);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeCloseTo(doc.width, 9);
    expect(bounds.y + bounds.height).toBeCloseTo(doc.height, 9);
    const pulled = translateArrow(arrow, { x: -99_999, y: -99_999 }, doc);
    expect(arrowBounds(pulled).x).toBe(0);
    expect(arrowBounds(pulled).y).toBe(0);
    expect(arrowLength(pulled)).toBeCloseTo(arrowLength(arrow), 9);
  });

  test("rejects a non-finite delta", () => {
    expect(() => translateArrow(arrow, { x: 0, y: Number.POSITIVE_INFINITY }, doc)).toThrow(
      RangeError,
    );
  });
});

describe("dragArrowEndpoint", () => {
  test("moves one endpoint and leaves the other exactly where it was", () => {
    const head = dragArrowEndpoint(arrow, "end", { x: 700, y: 900 }, doc);
    expect(head.start).toEqual(arrow.start);
    expect(head.end).toEqual({ x: 700, y: 900 });
    const tail = dragArrowEndpoint(arrow, "start", { x: 20, y: 30 }, doc);
    expect(tail.end).toEqual(arrow.end);
    expect(tail.start).toEqual({ x: 20, y: 30 });
  });

  test("clamps the dragged endpoint to the frame", () => {
    const head = dragArrowEndpoint(arrow, "end", { x: 99_999, y: -40 }, doc);
    expect(head.end).toEqual({ x: doc.width, y: 0 });
    expect(head.start).toEqual(arrow.start);
  });

  test("never shortens the arrow past the minimum", () => {
    for (const endpoint of ["start", "end"] as const) {
      const fixed = endpoint === "start" ? arrow.end : arrow.start;
      const collapsed = dragArrowEndpoint(arrow, endpoint, { ...fixed }, doc);
      expect(arrowLength(collapsed)).toBeGreaterThanOrEqual(MIN_ARROW_LENGTH_PX - 1e-9);
      // The fixed endpoint still did not move.
      expect(endpoint === "start" ? collapsed.end : collapsed.start).toEqual(fixed);
      const nearly = dragArrowEndpoint(
        arrow,
        endpoint,
        { x: fixed.x + 1, y: fixed.y + 1 },
        doc,
      );
      expect(arrowLength(nearly)).toBeGreaterThanOrEqual(MIN_ARROW_LENGTH_PX - 1e-9);
    }
  });

  test("leaves the arrow untouched when even the minimum would land outside", () => {
    // A frame too small to hold a minimum-length arrow at all: pushing the
    // head back out would leave it, so the arrow is handed back untouched
    // rather than committing geometry the server would reject.
    const tiny = { width: MIN_ARROW_LENGTH_PX - 6, height: MIN_ARROW_LENGTH_PX - 6 };
    const corner: NaturalArrow = { start: { x: 0, y: 0 }, end: { x: tiny.width, y: 0 } };
    expect(dragArrowEndpoint(corner, "end", { x: 0, y: 0 }, tiny)).toEqual(corner);
  });
});

describe("hit testing", () => {
  test("distance is measured to the segment, not to its infinite line", () => {
    const horizontal: NaturalArrow = { start: { x: 100, y: 100 }, end: { x: 300, y: 100 } };
    // Beside the middle of the shaft.
    expect(distanceToArrow(horizontal, { x: 200, y: 110 })).toBeCloseTo(10, 9);
    // Beyond the head: the distance is to the head itself, not zero.
    expect(distanceToArrow(horizontal, { x: 400, y: 100 })).toBeCloseTo(100, 9);
    // Behind the tail, the same on the other side.
    expect(distanceToArrow(horizontal, { x: 60, y: 100 })).toBeCloseTo(40, 9);
    // A zero-length arrow degrades to the distance to its one point.
    expect(
      distanceToArrow({ start: { x: 10, y: 10 }, end: { x: 10, y: 10 } }, { x: 13, y: 14 }),
    ).toBeCloseTo(5, 9);
  });

  test("near the line hits and just off it does not, at the published tolerance", () => {
    const horizontal: NaturalArrow = { start: { x: 100, y: 100 }, end: { x: 300, y: 100 } };
    const tolerance = ARROW_HIT_TOLERANCE_CSS_PX;
    expect(arrowHitsPoint(horizontal, { x: 200, y: 100 + tolerance }, tolerance)).toBe(true);
    expect(arrowHitsPoint(horizontal, { x: 200, y: 100 + tolerance + 0.5 }, tolerance)).toBe(false);
    // Inside the bounding box of a diagonal arrow but far from the shaft: a
    // box test would call this a hit, a distance test does not.
    expect(arrowHitsPoint(arrow, { x: 380, y: 210 }, tolerance)).toBe(false);
    expect(arrowHitsPoint(arrow, { x: 250, y: 400 }, tolerance)).toBe(true);
  });

  test("non-finite input never hits", () => {
    expect(arrowHitsPoint(arrow, { x: Number.NaN, y: 0 }, 10)).toBe(false);
    expect(
      arrowHitsPoint({ start: { x: 0, y: 0 }, end: { x: Number.NaN, y: 1 } }, { x: 0, y: 0 }, 10),
    ).toBe(false);
  });
});

describe("helpers", () => {
  test("bounds cover both endpoints and may be flat; the midpoint is the middle", () => {
    expect(arrowBounds(arrow)).toEqual({ x: 100, y: 200, width: 300, height: 400 });
    expect(arrowBounds({ start: { x: 10, y: 5 }, end: { x: 90, y: 5 } })).toEqual({
      x: 10,
      y: 5,
      width: 80,
      height: 0,
    });
    expect(arrowMidpoint(arrow)).toEqual({ x: 250, y: 400 });
  });

  test("equality and finiteness are value checks", () => {
    expect(arrowsEqual(arrow, { start: { ...arrow.start }, end: { ...arrow.end } })).toBe(true);
    expect(arrowsEqual(arrow, { start: arrow.end, end: arrow.start })).toBe(false);
    expect(isFiniteArrow(arrow)).toBe(true);
    expect(isFiniteArrow({ start: { x: 0, y: 0 }, end: { x: 1, y: Number.NaN } })).toBe(false);
  });
});
