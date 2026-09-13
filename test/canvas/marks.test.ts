// The client-safe mark helpers (D079): the request shapes each kind sends,
// the context query each kind asks, and the labels every surface prints,
// including the one name a mark goes by everywhere (markLabel, D078).

import { describe, expect, test } from "vitest";
import type {
  PinAnnotationView,
  PinElementSnapshot,
  RectangleAnnotationView,
} from "../../src/lib/annotations";
import {
  contextQuery,
  elementShortLabel,
  MARK_ELEMENT_LABEL_MAX_CHARS,
  MARK_EXCERPT_MAX_CHARS,
  markCenter,
  markKindLabel,
  markKindNoun,
  markLabel,
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

  test("markCenter is a pin's tip and a box's middle", () => {
    expect(markCenter({ kind: "pin", tip: { x: 3, y: 4 } })).toEqual({ x: 3, y: 4 });
    expect(markCenter({ kind: "rectangle", rect: { x: 10, y: 20, width: 30, height: 40 } })).toEqual(
      { x: 25, y: 40 },
    );
  });
});
