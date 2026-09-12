// Pure property tests for rectangle geometry (D079, VAL-MARK-002,
// VAL-CANVAS-001, VAL-CANVAS-003): the box a drag draws is normalized and
// clamped to the frame, the minimum size is the published constant, a move
// keeps the size and clamps the corner, and a resize moves only the edges
// the handle names, never past the frame or below the minimum. These are
// the canvas's single clamping authority for boxes; the server applies the
// same two rules and rejects instead of clamping.

import { describe, expect, test } from "vitest";
import { MIN_SHAPE_SIZE_PX } from "../../src/lib/boundaries";
import {
  clampRectToCapture,
  handleAnchor,
  handleCursor,
  isFiniteRect,
  meetsMinimumSize,
  moveRect,
  rectFromCorners,
  rectsEqual,
  resizeRect,
  RESIZE_HANDLES,
  type NaturalRect,
} from "../../src/lib/canvas/rectangle";

const doc = { width: 1440, height: 8966 };
const box: NaturalRect = { x: 100, y: 200, width: 300, height: 150 };

describe("rectFromCorners", () => {
  test("normalizes any two corners into a box with positive size", () => {
    const expected = { x: 10, y: 20, width: 90, height: 60 };
    expect(rectFromCorners({ x: 10, y: 20 }, { x: 100, y: 80 }, doc)).toEqual(expected);
    expect(rectFromCorners({ x: 100, y: 80 }, { x: 10, y: 20 }, doc)).toEqual(expected);
    expect(rectFromCorners({ x: 100, y: 20 }, { x: 10, y: 80 }, doc)).toEqual(expected);
  });

  test("clamps both corners to the frame first, inclusively", () => {
    expect(rectFromCorners({ x: -50, y: -50 }, { x: 2000, y: 20_000 }, doc)).toEqual({
      x: 0,
      y: 0,
      width: doc.width,
      height: doc.height,
    });
    expect(rectFromCorners({ x: 1400, y: 10 }, { x: 1500, y: 40 }, doc)).toEqual({
      x: 1400,
      y: 10,
      width: 40,
      height: 30,
    });
  });

  test("a press with no travel is a zero-size box, which is below the minimum", () => {
    const rect = rectFromCorners({ x: 5, y: 5 }, { x: 5, y: 5 }, doc);
    expect(rect).toEqual({ x: 5, y: 5, width: 0, height: 0 });
    expect(meetsMinimumSize(rect)).toBe(false);
  });

  test("rejects non-finite corners", () => {
    expect(() => rectFromCorners({ x: Number.NaN, y: 0 }, { x: 1, y: 1 }, doc)).toThrow(RangeError);
  });
});

describe("meetsMinimumSize", () => {
  test("is the published MIN_SHAPE_SIZE_PX in both dimensions, inclusive", () => {
    const min = MIN_SHAPE_SIZE_PX;
    expect(meetsMinimumSize({ x: 0, y: 0, width: min, height: min })).toBe(true);
    expect(meetsMinimumSize({ x: 0, y: 0, width: min - 0.01, height: min })).toBe(false);
    expect(meetsMinimumSize({ x: 0, y: 0, width: 500, height: min - 1 })).toBe(false);
  });
});

describe("clampRectToCapture and moveRect", () => {
  test("keeps an interior box byte-identical", () => {
    expect(clampRectToCapture(box, doc)).toEqual(box);
  });

  test("moves the corner, not the size, to stay inside the frame", () => {
    expect(clampRectToCapture({ ...box, x: -20, y: -5 }, doc)).toEqual({ ...box, x: 0, y: 0 });
    expect(clampRectToCapture({ ...box, x: 1400, y: 8900 }, doc)).toEqual({
      ...box,
      x: doc.width - box.width,
      y: doc.height - box.height,
    });
  });

  test("a box larger than the document shrinks to it", () => {
    expect(clampRectToCapture({ x: 10, y: 10, width: 5000, height: 20_000 }, doc)).toEqual({
      x: 0,
      y: 0,
      width: doc.width,
      height: doc.height,
    });
  });

  test("moveRect places the corner where the drag put it, clamped", () => {
    expect(moveRect(box, { x: 500, y: 600 }, doc)).toEqual({ ...box, x: 500, y: 600 });
    expect(moveRect(box, { x: 1300, y: -40 }, doc)).toEqual({ ...box, x: 1140, y: 0 });
    expect(() => moveRect(box, { x: Number.POSITIVE_INFINITY, y: 0 }, doc)).toThrow(RangeError);
  });

  test("rectsEqual and isFiniteRect are exact", () => {
    expect(rectsEqual(box, { ...box })).toBe(true);
    expect(rectsEqual(box, { ...box, width: 300.5 })).toBe(false);
    expect(isFiniteRect(box)).toBe(true);
    expect(isFiniteRect({ ...box, height: Number.NaN })).toBe(false);
  });
});

describe("resizeRect", () => {
  test("each corner handle moves only its two edges; edge handles move one", () => {
    const delta = { x: 10, y: 20 };
    expect(resizeRect(box, "se", delta, doc)).toEqual({ x: 100, y: 200, width: 310, height: 170 });
    expect(resizeRect(box, "nw", delta, doc)).toEqual({ x: 110, y: 220, width: 290, height: 130 });
    expect(resizeRect(box, "ne", delta, doc)).toEqual({ x: 100, y: 220, width: 310, height: 130 });
    expect(resizeRect(box, "sw", delta, doc)).toEqual({ x: 110, y: 200, width: 290, height: 170 });
    expect(resizeRect(box, "n", delta, doc)).toEqual({ x: 100, y: 220, width: 300, height: 130 });
    expect(resizeRect(box, "s", delta, doc)).toEqual({ x: 100, y: 200, width: 300, height: 170 });
    expect(resizeRect(box, "e", delta, doc)).toEqual({ x: 100, y: 200, width: 310, height: 150 });
    expect(resizeRect(box, "w", delta, doc)).toEqual({ x: 110, y: 200, width: 290, height: 150 });
  });

  test("a moving edge stops at the frame", () => {
    expect(resizeRect(box, "se", { x: 5000, y: 20_000 }, doc)).toEqual({
      x: 100,
      y: 200,
      width: doc.width - 100,
      height: doc.height - 200,
    });
    expect(resizeRect(box, "nw", { x: -500, y: -500 }, doc)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 350,
    });
  });

  test("a moving edge never crosses its opposite closer than the minimum", () => {
    const min = MIN_SHAPE_SIZE_PX;
    // Dragging the east edge far past the west edge leaves a minimum box
    // anchored on the fixed west edge.
    expect(resizeRect(box, "e", { x: -1000, y: 0 }, doc)).toEqual({
      x: 100,
      y: 200,
      width: min,
      height: 150,
    });
    // And the north-west corner past the south-east one leaves the
    // minimum box anchored on the fixed south-east corner.
    expect(resizeRect(box, "nw", { x: 1000, y: 1000 }, doc)).toEqual({
      x: 400 - min,
      y: 350 - min,
      width: min,
      height: min,
    });
  });

  test("a zero delta is the identity, and non-finite input is rejected", () => {
    for (const handle of RESIZE_HANDLES) {
      expect(resizeRect(box, handle, { x: 0, y: 0 }, doc)).toEqual(box);
    }
    expect(() => resizeRect(box, "se", { x: Number.NaN, y: 0 }, doc)).toThrow(RangeError);
    expect(() => resizeRect({ ...box, width: Number.NaN }, "se", { x: 0, y: 0 }, doc)).toThrow(
      RangeError,
    );
  });

  test("handle anchors sit on the box's corners and edge midpoints with matching cursors", () => {
    expect(RESIZE_HANDLES).toHaveLength(8);
    expect(handleAnchor("nw")).toEqual({ x: 0, y: 0 });
    expect(handleAnchor("se")).toEqual({ x: 1, y: 1 });
    expect(handleAnchor("n")).toEqual({ x: 0.5, y: 0 });
    expect(handleAnchor("w")).toEqual({ x: 0, y: 0.5 });
    expect(handleCursor("ne")).toBe("ne-resize");
  });
});
