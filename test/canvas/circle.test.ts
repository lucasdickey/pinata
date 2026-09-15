// Pure property tests for circle geometry (D082, VAL-MARK-002,
// VAL-CANVAS-001, VAL-CANVAS-003): the square a drag draws stays square and
// inside the frame whatever shape the drag had, the minimum is the published
// constant, a move keeps the size and clamps the corner, and a corner resize
// governs both dimensions without crossing the fixed corner or leaving the
// frame. These are the canvas's single clamping authority for circles; the
// server applies the same two rules and rejects instead of clamping.

import { describe, expect, test } from "vitest";
import { MIN_SHAPE_SIZE_PX } from "../../src/lib/boundaries";
import {
  circleBounds,
  circleCenter,
  circleFromCorners,
  CIRCLE_RESIZE_HANDLES,
  circlesEqual,
  clampCircleToCapture,
  isFiniteCircle,
  meetsMinimumCircleSize,
  moveCircle,
  resizeCircle,
  type NaturalCircle,
} from "../../src/lib/canvas/circle";

const doc = { width: 1440, height: 8966 };
const circle: NaturalCircle = { x: 100, y: 200, size: 300 };

describe("circleFromCorners", () => {
  test("the drag's larger dimension sets the size, so an off-square drag stays square", () => {
    expect(circleFromCorners({ x: 10, y: 20 }, { x: 100, y: 80 }, doc)).toEqual({
      x: 10,
      y: 20,
      size: 90,
    });
    expect(circleFromCorners({ x: 10, y: 20 }, { x: 40, y: 200 }, doc)).toEqual({
      x: 10,
      y: 20,
      size: 180,
    });
  });

  test("the square grows from the press corner, in the direction the drag went", () => {
    // Up and to the left: the press point is the bottom-right corner.
    expect(circleFromCorners({ x: 500, y: 600 }, { x: 420, y: 540 }, doc)).toEqual({
      x: 420,
      y: 520,
      size: 80,
    });
    // Up and to the right.
    expect(circleFromCorners({ x: 500, y: 600 }, { x: 560, y: 500 }, doc)).toEqual({
      x: 500,
      y: 500,
      size: 100,
    });
  });

  test("the square stops at the frame edge rather than sliding sideways", () => {
    const wide = circleFromCorners({ x: 1400, y: 10 }, { x: 3000, y: 900 }, doc);
    expect(wide).toEqual({ x: 1400, y: 10, size: 40 });
    expect(wide.x + wide.size).toBeLessThanOrEqual(doc.width);
    const up = circleFromCorners({ x: 500, y: 30 }, { x: 100, y: -900 }, doc);
    expect(up).toEqual({ x: 470, y: 0, size: 30 });
  });

  test("a press with no travel is a zero-size square, which is below the minimum", () => {
    const drawn = circleFromCorners({ x: 5, y: 5 }, { x: 5, y: 5 }, doc);
    expect(drawn).toEqual({ x: 5, y: 5, size: 0 });
    expect(meetsMinimumCircleSize(drawn)).toBe(false);
  });

  test("exactly the minimum in the larger dimension draws", () => {
    const drawn = circleFromCorners(
      { x: 100, y: 100 },
      { x: 100 + MIN_SHAPE_SIZE_PX, y: 101 },
      doc,
    );
    expect(drawn.size).toBe(MIN_SHAPE_SIZE_PX);
    expect(meetsMinimumCircleSize(drawn)).toBe(true);
  });

  test("rejects non-finite corners", () => {
    expect(() => circleFromCorners({ x: Number.NaN, y: 0 }, { x: 1, y: 1 }, doc)).toThrow(
      RangeError,
    );
  });
});

describe("clampCircleToCapture", () => {
  test("keeps the size and moves the corner when the square fits", () => {
    expect(clampCircleToCapture({ x: -40, y: -40, size: 300 }, doc)).toEqual({
      x: 0,
      y: 0,
      size: 300,
    });
    expect(clampCircleToCapture({ x: 1400, y: 10, size: 300 }, doc)).toEqual({
      x: 1140,
      y: 10,
      size: 300,
    });
  });

  test("shrinks a square larger than the frame's shorter side", () => {
    expect(clampCircleToCapture({ x: 0, y: 0, size: 99_999 }, doc)).toEqual({
      x: 0,
      y: 0,
      size: doc.width,
    });
  });

  test("rejects non-finite values", () => {
    expect(() => clampCircleToCapture({ x: 0, y: 0, size: Number.NaN }, doc)).toThrow(RangeError);
  });
});

describe("moveCircle", () => {
  test("puts the bounding square's corner at the position and clamps it", () => {
    expect(moveCircle(circle, { x: 20, y: 30 }, doc)).toEqual({ x: 20, y: 30, size: 300 });
    const clamped = moveCircle(circle, { x: 5000, y: 99_999 }, doc);
    expect(clamped.x + clamped.size).toBe(doc.width);
    expect(clamped.y + clamped.size).toBe(doc.height);
    expect(clamped.size).toBe(300);
  });

  test("rejects a non-finite position", () => {
    expect(() => moveCircle(circle, { x: 0, y: Number.POSITIVE_INFINITY }, doc)).toThrow(
      RangeError,
    );
  });
});

describe("resizeCircle", () => {
  test("offers the four corners only: an edge handle would move two dimensions", () => {
    expect([...CIRCLE_RESIZE_HANDLES]).toEqual(["nw", "ne", "se", "sw"]);
  });

  test("a corner drag governs both dimensions and keeps the opposite corner fixed", () => {
    const grown = resizeCircle(circle, "se", { x: 40, y: 10 }, doc);
    // The larger span wins, so a lopsided drag still yields a square.
    expect(grown).toEqual({ x: 100, y: 200, size: 340 });
    const nw = resizeCircle(circle, "nw", { x: -40, y: -10 }, doc);
    expect(nw.x + nw.size).toBe(circle.x + circle.size);
    expect(nw.y + nw.size).toBe(circle.y + circle.size);
    expect(nw.size).toBe(340);
  });

  test("never shrinks past the minimum, whatever the drag", () => {
    for (const handle of CIRCLE_RESIZE_HANDLES) {
      // Drag the handle far past the corner that stays fixed.
      const toward = {
        x: handle.includes("e") ? -9000 : 9000,
        y: handle.includes("s") ? -9000 : 9000,
      };
      const shrunk = resizeCircle(circle, handle, toward, doc);
      expect(shrunk.size).toBe(MIN_SHAPE_SIZE_PX);
      // And the fixed corner really did stay put.
      const fixed = {
        x: handle.includes("e") ? circle.x : circle.x + circle.size,
        y: handle.includes("s") ? circle.y : circle.y + circle.size,
      };
      expect(handle.includes("e") ? shrunk.x : shrunk.x + shrunk.size).toBe(fixed.x);
      expect(handle.includes("s") ? shrunk.y : shrunk.y + shrunk.size).toBe(fixed.y);
    }
  });

  test("never grows past the frame in either direction", () => {
    for (const handle of CIRCLE_RESIZE_HANDLES) {
      const grown = resizeCircle(circle, handle, { x: 99_999, y: 99_999 }, doc);
      expect(grown.x).toBeGreaterThanOrEqual(0);
      expect(grown.y).toBeGreaterThanOrEqual(0);
      expect(grown.x + grown.size).toBeLessThanOrEqual(doc.width);
      expect(grown.y + grown.size).toBeLessThanOrEqual(doc.height);
    }
  });

  test("rejects non-finite input", () => {
    expect(() => resizeCircle(circle, "se", { x: Number.NaN, y: 0 }, doc)).toThrow(RangeError);
    expect(() => resizeCircle({ x: 0, y: 0, size: Number.NaN }, "se", { x: 1, y: 1 }, doc)).toThrow(
      RangeError,
    );
  });
});

describe("helpers", () => {
  test("bounds are the square, and the center is its middle", () => {
    expect(circleBounds(circle)).toEqual({ x: 100, y: 200, width: 300, height: 300 });
    expect(circleCenter(circle)).toEqual({ x: 250, y: 350 });
  });

  test("equality and finiteness are value checks", () => {
    expect(circlesEqual(circle, { ...circle })).toBe(true);
    expect(circlesEqual(circle, { ...circle, size: 301 })).toBe(false);
    expect(isFiniteCircle(circle)).toBe(true);
    expect(isFiniteCircle({ x: 0, y: 0, size: Number.NaN })).toBe(false);
  });

  test("the minimum is the published constant", () => {
    expect(meetsMinimumCircleSize({ x: 0, y: 0, size: MIN_SHAPE_SIZE_PX })).toBe(true);
    expect(meetsMinimumCircleSize({ x: 0, y: 0, size: MIN_SHAPE_SIZE_PX - 0.01 })).toBe(false);
  });
});
