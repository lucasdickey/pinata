// The pin composer's screen placement (D074): opens to the right of the
// draft badge, flips left when the right side has no room, and is clamped
// inside its bounds on every axis; the bounds are the visible canvas frame
// when it is big enough and the browser viewport otherwise.

import { describe, expect, test } from "vitest";
import {
  intersectRects,
  placePopover,
  popoverBounds,
  POPOVER_GAP_PX,
  POPOVER_MARGIN_PX,
} from "../../src/lib/canvas/popover";

const size = { width: 320, height: 240 };
const bounds = { left: 0, top: 0, right: 1200, bottom: 800 };
const badge = 24;

describe("placePopover", () => {
  test("opens to the right of the badge, top level with the badge's top", () => {
    const placed = placePopover({ anchor: { x: 400, y: 300 }, badge, size, bounds });
    expect(placed.side).toBe("right");
    expect(placed.left).toBe(400 + badge / 2 + POPOVER_GAP_PX);
    expect(placed.top).toBe(300 - badge);
  });

  test("flips to the left when the right side has no room and the left does", () => {
    const placed = placePopover({ anchor: { x: 1100, y: 300 }, badge, size, bounds });
    expect(placed.side).toBe("left");
    expect(placed.left).toBe(1100 - badge / 2 - POPOVER_GAP_PX - size.width);
    expect(placed.left + size.width).toBeLessThanOrEqual(bounds.right);
  });

  test("clamps inside the bounds when neither side fits", () => {
    const narrow = { left: 0, top: 0, right: 400, bottom: 800 };
    const placed = placePopover({ anchor: { x: 200, y: 300 }, badge, size, bounds: narrow });
    expect(placed.left).toBeGreaterThanOrEqual(narrow.left);
    expect(placed.left + size.width).toBeLessThanOrEqual(narrow.right);
  });

  test("never leaves the bounds vertically: top and bottom edges are clamped", () => {
    const high = placePopover({ anchor: { x: 400, y: 5 }, badge, size, bounds });
    expect(high.top).toBe(bounds.top);
    const low = placePopover({ anchor: { x: 400, y: 790 }, badge, size, bounds });
    expect(low.top).toBe(bounds.bottom - size.height);
  });

  test("an anchor far outside the bounds still yields a box inside them", () => {
    const placed = placePopover({ anchor: { x: -5000, y: 90000 }, badge, size, bounds });
    expect(placed.left).toBeGreaterThanOrEqual(bounds.left);
    expect(placed.left + size.width).toBeLessThanOrEqual(bounds.right);
    expect(placed.top).toBeGreaterThanOrEqual(bounds.top);
    expect(placed.top + size.height).toBeLessThanOrEqual(bounds.bottom);
  });

  test("a box larger than its bounds pins to the near edge rather than overflowing far", () => {
    const tiny = { left: 100, top: 100, right: 200, bottom: 150 };
    const placed = placePopover({ anchor: { x: 150, y: 120 }, badge, size, bounds: tiny });
    expect(placed.left).toBe(tiny.left);
    expect(placed.top).toBe(tiny.top);
  });
});

describe("popoverBounds", () => {
  const viewport = { left: 0, top: 0, right: 1400, bottom: 900 };

  test("uses the visible canvas frame when it can hold the popover", () => {
    const frame = { left: 100, top: 200, right: 1000, bottom: 850 };
    const result = popoverBounds(frame, viewport, size);
    expect(result).toEqual({
      left: 100 + POPOVER_MARGIN_PX,
      top: 200 + POPOVER_MARGIN_PX,
      right: 1000 - POPOVER_MARGIN_PX,
      bottom: 850 - POPOVER_MARGIN_PX,
    });
  });

  test("uses only the part of the frame that is on screen", () => {
    const frame = { left: 100, top: -300, right: 1000, bottom: 700 };
    const result = popoverBounds(frame, viewport, size);
    expect(result.top).toBe(POPOVER_MARGIN_PX);
    expect(result.bottom).toBe(700 - POPOVER_MARGIN_PX);
  });

  test("falls back to the viewport when the visible frame is too small", () => {
    const frame = { left: 100, top: 800, right: 1000, bottom: 1400 };
    const result = popoverBounds(frame, viewport, size);
    expect(result).toEqual({
      left: POPOVER_MARGIN_PX,
      top: POPOVER_MARGIN_PX,
      right: 1400 - POPOVER_MARGIN_PX,
      bottom: 900 - POPOVER_MARGIN_PX,
    });
  });

  test("falls back to the viewport when the frame is entirely off screen", () => {
    const frame = { left: 100, top: 2000, right: 1000, bottom: 2600 };
    expect(intersectRects(frame, viewport)).toBeNull();
    const result = popoverBounds(frame, viewport, size);
    expect(result.top).toBe(POPOVER_MARGIN_PX);
  });
});
