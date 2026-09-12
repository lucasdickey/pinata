// The client-safe mark helpers (D079): the request shapes each kind sends,
// the context query each kind asks, and the labels every surface prints.

import { describe, expect, test } from "vitest";
import type { PinAnnotationView, RectangleAnnotationView } from "../../src/lib/annotations";
import {
  contextQuery,
  markKindLabel,
  markKindNoun,
  markOf,
  markPayload,
  markPosition,
  marksEqual,
  markTitle,
  pinsOf,
  rectanglePosition,
  rectanglesOf,
  withMark,
} from "../../src/lib/canvas/marks";

const pin: PinAnnotationView = {
  id: "a1",
  captureId: "cap-1",
  kind: "pin",
  number: 1,
  tip: { x: 392.4, y: 386.6 },
  body: "Pin body",
  elementSnapshot: null,
  revision: 1,
  status: "open",
  unreadReplies: 0,
  createdAt: 0,
};

const box: RectangleAnnotationView = {
  id: "a2",
  captureId: "cap-1",
  kind: "rectangle",
  number: 2,
  rect: { x: 100.4, y: 200.6, width: 300.2, height: 150.5 },
  body: "Box body",
  elementSnapshot: null,
  revision: 3,
  status: "replied",
  unreadReplies: 1,
  createdAt: 1,
};

describe("payloads and queries", () => {
  test("a pin sends its tip and asks around a point", () => {
    expect(markPayload({ kind: "pin", tip: { x: 1, y: 2 } })).toEqual({ tip: { x: 1, y: 2 } });
    expect(contextQuery({ kind: "pin", tip: { x: 1.5, y: 2 } })).toBe("x=1.5&y=2");
  });

  test("a rectangle sends its box and asks by overlap", () => {
    const rect = { x: 1, y: 2, width: 30, height: 40 };
    expect(markPayload({ kind: "rectangle", rect })).toEqual({ rect });
    expect(contextQuery({ kind: "rectangle", rect })).toBe("x=1&y=2&width=30&height=40");
  });

  test("markOf and withMark round-trip the geometry by kind and copy it", () => {
    const mark = markOf(box);
    expect(mark).toEqual({ kind: "rectangle", rect: box.rect });
    if (mark.kind === "rectangle") {
      mark.rect.x = 0;
      expect(box.rect.x).toBe(100.4);
    }
    const moved = withMark(box, { kind: "rectangle", rect: { x: 5, y: 6, width: 30, height: 40 } });
    expect(moved.kind).toBe("rectangle");
    if (moved.kind === "rectangle") expect(moved.rect).toEqual({ x: 5, y: 6, width: 30, height: 40 });
    const movedPin = withMark(pin, { kind: "pin", tip: { x: 9, y: 9 } });
    if (movedPin.kind === "pin") expect(movedPin.tip).toEqual({ x: 9, y: 9 });
    // A mark of the other kind changes nothing.
    expect(withMark(pin, { kind: "rectangle", rect: box.rect })).toBe(pin);
  });

  test("marksEqual compares kind and geometry", () => {
    expect(marksEqual(null, null)).toBe(true);
    expect(marksEqual(markOf(pin), null)).toBe(false);
    expect(marksEqual(markOf(pin), markOf(pin))).toBe(true);
    expect(marksEqual(markOf(pin), markOf(box))).toBe(false);
    expect(marksEqual(markOf(box), { kind: "rectangle", rect: { ...box.rect, width: 1 } })).toBe(
      false,
    );
  });
});

describe("labels", () => {
  test("names the kind and the number", () => {
    expect(markTitle(pin)).toBe("Pin 1");
    expect(markTitle(box)).toBe("Box 2");
    expect(markKindLabel("pin")).toBe("Pin");
    expect(markKindLabel("rectangle")).toBe("Box");
    expect(markKindNoun("rectangle")).toBe("box");
  });

  test("positions are rounded natural pixels: a point for a pin, corner and size for a box", () => {
    expect(markPosition(pin)).toBe("392, 387");
    expect(markPosition(box)).toBe("100, 201 · 300 × 151");
    expect(rectanglePosition({ x: 0, y: 0, width: 8, height: 8 })).toBe("0, 0 · 8 × 8");
  });

  test("pinsOf and rectanglesOf split a mixed list without reordering", () => {
    const list = [box, pin];
    expect(pinsOf(list)).toEqual([pin]);
    expect(rectanglesOf(list)).toEqual([box]);
  });
});
