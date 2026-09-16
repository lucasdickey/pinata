// The client-safe mark helpers (D079, D082, D083): the request shapes each kind sends,
// the context query each kind asks, and the labels every surface prints,
// including the one name a mark goes by everywhere (markLabel, D078).

import { describe, expect, test } from "vitest";
import type {
  ArrowAnnotationView,
  CircleAnnotationView,
  PinAnnotationView,
  PinElementSnapshot,
  RectangleAnnotationView,
} from "../../src/lib/annotations";
import {
  arrowPosition,
  arrowsOf,
  circlePosition,
  circlesOf,
  contextQuery,
  elementShortLabel,
  MARK_ELEMENT_LABEL_MAX_CHARS,
  MARK_EXCERPT_MAX_CHARS,
  markCenter,
  markCountLabel,
  markKindLabel,
  markKindNoun,
  markLabel,
  markOf,
  markPayload,
  markExtent,
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

const round: CircleAnnotationView = {
  id: "a3",
  captureId: "cap-1",
  kind: "circle",
  number: 4,
  circle: { x: 100.4, y: 200.6, size: 300.2 },
  body: "Circle body",
  elementSnapshot: null,
  revision: 1,
  status: "open",
  unreadReplies: 0,
  createdAt: 2,
};

const pointer: ArrowAnnotationView = {
  id: "a6",
  captureId: "cap-1",
  kind: "arrow",
  number: 6,
  arrow: { start: { x: 100.4, y: 200.6 }, end: { x: 400.2, y: 600.9 } },
  body: "Arrow body",
  elementSnapshot: null,
  revision: 1,
  status: "open",
  unreadReplies: 0,
  createdAt: 3,
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

  test("a circle sends its bounding square and asks by overlap with it (D082)", () => {
    const circle = { x: 1, y: 2, size: 30 };
    expect(markPayload({ kind: "circle", circle })).toEqual({ circle });
    // The overlap ranking is the region ranking: the query is the square.
    expect(contextQuery({ kind: "circle", circle })).toBe("x=1&y=2&width=30&height=30");
  });

  test("markOf and withMark round-trip a circle too", () => {
    const mark = markOf(round);
    expect(mark).toEqual({ kind: "circle", circle: round.circle });
    if (mark.kind === "circle") {
      mark.circle.size = 0;
      expect(round.circle.size).toBe(300.2);
    }
    const resized = withMark(round, { kind: "circle", circle: { x: 5, y: 6, size: 40 } });
    if (resized.kind === "circle") expect(resized.circle).toEqual({ x: 5, y: 6, size: 40 });
    // Geometry of another kind changes nothing.
    expect(withMark(round, { kind: "rectangle", rect: box.rect })).toBe(round);
    expect(marksEqual(markOf(round), markOf(round))).toBe(true);
    expect(marksEqual(markOf(round), { kind: "circle", circle: { x: 5, y: 6, size: 40 } })).toBe(
      false,
    );
    expect(marksEqual(markOf(round), markOf(box))).toBe(false);
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
    expect(markTitle(round)).toBe("Circle 4");
    expect(markKindLabel("rectangle")).toBe("Box");
    expect(markKindLabel("circle")).toBe("Circle");
    expect(markKindNoun("rectangle")).toBe("box");
    expect(markKindNoun("circle")).toBe("circle");
  });

  test("positions are rounded natural pixels: a point for a pin, corner and size for a box", () => {
    expect(markPosition(pin)).toBe("392, 387");
    expect(markPosition(box)).toBe("100, 201 · 300 × 151");
    expect(rectanglePosition({ x: 0, y: 0, width: 8, height: 8 })).toBe("0, 0 · 8 × 8");
  });

  test("a circle's position is its center and its width (D082)", () => {
    expect(markPosition(round)).toBe("251, 351 · 300 wide");
    expect(circlePosition({ x: 0, y: 0, size: 80 })).toBe("40, 40 · 80 wide");
  });

  test("pinsOf, rectanglesOf and circlesOf split a mixed list without reordering", () => {
    const list = [box, pin, round];
    expect(pinsOf(list)).toEqual([pin]);
    expect(rectanglesOf(list)).toEqual([box]);
    expect(circlesOf(list)).toEqual([round]);
  });

  test("markCountLabel counts each kind, never calling a box a pin", () => {
    expect(markCountLabel([])).toBe("0 pins");
    expect(markCountLabel([pin])).toBe("1 pin");
    expect(markCountLabel([pin, { ...pin, id: "a3" }])).toBe("2 pins");
    expect(markCountLabel([box])).toBe("1 box");
    expect(markCountLabel([box, { ...box, id: "a4" }])).toBe("2 boxes");
    expect(markCountLabel([pin, box])).toBe("1 pin · 1 box");
    expect(markCountLabel([round])).toBe("1 circle");
    expect(markCountLabel([round, { ...round, id: "a5" }])).toBe("2 circles");
    expect(markCountLabel([round, box, pin])).toBe("1 pin · 1 box · 1 circle");
  });
});

// A mark's name (D078): the kind and number first, then what the comment
// says, then what the mark points at. Never where it sits.
describe("mark names (D078)", () => {
  const element: PinElementSnapshot = {
    id: "el-1",
    kind: "button",
    tag: "button",
    role: "switch",
    text: "Annual (save 20%)",
    accessibleName: "Billing period",
    hints: { id: "", classes: [], alt: "", title: "", testId: "" },
    path: ["main", "section.pricing", "div.billing-toggle"],
    rect: { x: 380, y: 372, width: 176, height: 44 },
  };

  test("a pin with an element: kind and number, the quoted comment, the element's text", () => {
    expect(
      markLabel({ ...pin, body: "This toggle reads the same in both states", elementSnapshot: element }),
    ).toBe("Pin 1 · “This toggle reads the same in both states” · Annual (save 20%)");
  });

  test("a box is prefixed Box, and with no element the name ends at the comment", () => {
    expect(markLabel({ ...box, body: "More air around these" })).toBe(
      "Box 2 · “More air around these”",
    );
    expect(markLabel({ ...box, elementSnapshot: element })).toBe(
      "Box 2 · “Box body” · Annual (save 20%)",
    );
  });

  test("the comment is cut to about sixty characters with an ellipsis, on one line", () => {
    const long =
      "This paragraph runs on far longer than any reasonable excerpt should, so the name has to cut it short.";
    const label = markLabel({ ...pin, body: long });
    const quoted = label.slice(label.indexOf("“") + 1, label.lastIndexOf("”"));
    expect(quoted.length).toBeLessThanOrEqual(MARK_EXCERPT_MAX_CHARS);
    expect(quoted.endsWith("…")).toBe(true);
    expect(quoted.startsWith("This paragraph runs on far longer")).toBe(true);
    expect(label).not.toContain("cut it short");
    // Line breaks and runs of spaces collapse; a comment that fits is untouched.
    expect(markLabel({ ...pin, body: "two\n\n  lines   here" })).toBe("Pin 1 · “two lines here”");
    expect(markLabel({ ...pin, body: "x".repeat(MARK_EXCERPT_MAX_CHARS) })).toBe(
      `Pin 1 · “${"x".repeat(MARK_EXCERPT_MAX_CHARS)}”`,
    );
  });

  test("the element label falls back from text to accessible name to tag, and is cut too", () => {
    expect(elementShortLabel(element)).toBe("Annual (save 20%)");
    expect(elementShortLabel({ ...element, text: "" })).toBe("Billing period");
    expect(elementShortLabel({ ...element, text: "  ", accessibleName: "" })).toBe("button");
    expect(elementShortLabel({ ...element, text: "", accessibleName: "", tag: "" })).toBeNull();
    expect(elementShortLabel(null)).toBeNull();
    const wordy = elementShortLabel({ ...element, text: "word ".repeat(30) })!;
    expect(wordy.length).toBeLessThanOrEqual(MARK_ELEMENT_LABEL_MAX_CHARS);
    expect(wordy.endsWith("…")).toBe(true);
    // A snapshot with no words adds nothing to the name.
    expect(
      markLabel({ ...pin, elementSnapshot: { ...element, text: "", accessibleName: "", tag: "" } }),
    ).toBe("Pin 1 · “Pin body”");
  });

  test("an empty comment leaves just the kind and number; coordinates never appear", () => {
    expect(markLabel({ ...pin, body: "   " })).toBe("Pin 1");
    for (const mark of [pin, box, { ...pin, elementSnapshot: element }]) {
      expect(markLabel(mark)).not.toMatch(/\d+, \d+/);
      expect(markLabel(mark)).not.toMatch(/natural|px/);
    }
  });

  test("markCenter is a pin's tip, a box's middle, and a circle's center", () => {
    expect(markCenter({ kind: "pin", tip: { x: 3, y: 4 } })).toEqual({ x: 3, y: 4 });
    expect(markCenter({ kind: "rectangle", rect: { x: 10, y: 20, width: 30, height: 40 } })).toEqual(
      { x: 25, y: 40 },
    );
    expect(markCenter({ kind: "circle", circle: { x: 10, y: 20, size: 30 } })).toEqual({
      x: 25,
      y: 35,
    });
  });

  test("markExtent is the box a reveal must fit, and null for a pin", () => {
    expect(markExtent({ kind: "pin", tip: { x: 3, y: 4 } })).toBeNull();
    expect(markExtent({ kind: "circle", circle: { x: 10, y: 20, size: 30 } })).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 30,
    });
  });

  test("a circle is prefixed Circle in its name", () => {
    expect(markLabel({ ...round, body: "Draw the eye here" })).toBe(
      "Circle 4 · “Draw the eye here”",
    );
  });
});

// An arrow is two points and a direction (D083): the head is what the mark
// is about, so it is the point the context ranking is taken from and the
// tail is where the badge and the reading order start.
describe("arrows (D083)", () => {
  test("an arrow sends both endpoints and asks around its head, by point", () => {
    const arrow = { start: { x: 1, y: 2 }, end: { x: 30, y: 40 } };
    expect(markPayload({ kind: "arrow", arrow })).toEqual({ arrow });
    // The point ranking, not the overlap ranking: no width or height.
    expect(contextQuery({ kind: "arrow", arrow })).toBe("x=30&y=40");
  });

  test("markOf and withMark round-trip the endpoints and copy them", () => {
    const mark = markOf(pointer);
    expect(mark).toEqual({ kind: "arrow", arrow: pointer.arrow });
    if (mark.kind === "arrow") {
      mark.arrow.end.x = 0;
      expect(pointer.arrow.end.x).toBe(400.2);
    }
    const aimed = withMark(pointer, {
      kind: "arrow",
      arrow: { start: { x: 5, y: 6 }, end: { x: 7, y: 8 } },
    });
    if (aimed.kind === "arrow") {
      expect(aimed.arrow).toEqual({ start: { x: 5, y: 6 }, end: { x: 7, y: 8 } });
    }
    // Geometry of another kind changes nothing.
    expect(withMark(pointer, { kind: "rectangle", rect: box.rect })).toBe(pointer);
  });

  test("marksEqual compares both endpoints and the direction", () => {
    expect(marksEqual(markOf(pointer), markOf(pointer))).toBe(true);
    expect(
      marksEqual(markOf(pointer), { kind: "arrow", arrow: { start: pointer.arrow.end, end: pointer.arrow.start } }),
    ).toBe(false);
    expect(marksEqual(markOf(pointer), markOf(box))).toBe(false);
  });

  test("names, counts and nouns know the kind", () => {
    expect(markTitle(pointer)).toBe("Arrow 6");
    expect(markKindLabel("arrow")).toBe("Arrow");
    expect(markKindNoun("arrow")).toBe("arrow");
    expect(markLabel({ ...pointer, body: "Move this up here" })).toBe(
      "Arrow 6 · “Move this up here”",
    );
    expect(markCountLabel([pointer])).toBe("1 arrow");
    expect(markCountLabel([pointer, { ...pointer, id: "a7" }])).toBe("2 arrows");
    expect(markCountLabel([pin, box, round, pointer])).toBe(
      "1 pin · 1 box · 1 circle · 1 arrow",
    );
    expect(arrowsOf([box, pin, round, pointer])).toEqual([pointer]);
  });

  test("the position is both points, tail first, and the name never shows them", () => {
    expect(markPosition(pointer)).toBe("100, 201 → 400, 601");
    expect(arrowPosition({ start: { x: 0, y: 0 }, end: { x: 8, y: 9 } })).toBe("0, 0 → 8, 9");
    expect(markLabel(pointer)).not.toMatch(/\d+, \d+/);
  });

  test("a camera centers the shaft's middle and fits the whole arrow", () => {
    expect(markCenter(markOf(pointer))).toEqual({ x: 250.3, y: 400.75 });
    expect(markExtent(markOf(pointer))).toEqual({
      x: 100.4,
      y: 200.6,
      width: 299.79999999999995,
      height: 400.29999999999995,
    });
  });
});
