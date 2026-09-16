// Natural-pixel geometry for circle marks (D082, VAL-MARK-002,
// VAL-CANVAS-001, VAL-CANVAS-003).
//
// A circle is a square-constrained region: one corner and one `size` that is
// both its width and its height, with the drawn ellipse inscribed in that
// bounding square. This is the pure, named boundary for it, beside
// rectangle.ts: the square a drag draws, the clamp that keeps it inside the
// frame, the minimum it must reach, and the move and resize math the canvas
// applies while a gesture is in flight. Nothing here reads the DOM or React
// Flow state. The server applies the same two rules (inside the document, at
// least MIN_SHAPE_SIZE_PX) and rejects rather than clamps.
//
// The square constraint is what keeps one resize contract: a corner drag
// governs both dimensions, so circles resize by their four corners and have
// no edge handles at all (an edge handle would have to move the perpendicular
// edges too, which is not what it shows).

import { MIN_SHAPE_SIZE_PX } from "../boundaries";
import type { NaturalPoint, PlaneSize } from "./camera";
import { clampNaturalPointToCapture } from "./geometry";
import type { NaturalRect } from "./rectangle";

/** A circle in screenshot-natural CSS pixels: the bounding square's corner and edge. */
export interface NaturalCircle {
  x: number;
  y: number;
  /** Both the width and the height of the bounding square. */
  size: number;
}

/** True when all three values are finite numbers. */
export function isFiniteCircle(circle: NaturalCircle): boolean {
  return [circle.x, circle.y, circle.size].every((value) => Number.isFinite(value));
}

/** True when the bounding square reaches the published minimum. */
export function meetsMinimumCircleSize(
  circle: NaturalCircle,
  minimum: number = MIN_SHAPE_SIZE_PX,
): boolean {
  return circle.size >= minimum;
}

/** True when two circles have identical values. */
export function circlesEqual(a: NaturalCircle, b: NaturalCircle): boolean {
  return a.x === b.x && a.y === b.y && a.size === b.size;
}

/** The circle's bounding square as a plain box, for rendering and ranking. */
export function circleBounds(circle: NaturalCircle): NaturalRect {
  return { x: circle.x, y: circle.y, width: circle.size, height: circle.size };
}

/** The circle's center in natural pixels. */
export function circleCenter(circle: NaturalCircle): NaturalPoint {
  return { x: circle.x + circle.size / 2, y: circle.y + circle.size / 2 };
}

/**
 * The circle between two drag corners. The square grows from the press point
 * in the direction the pointer travelled, and the drag's larger dimension
 * sets the size, so an off-square drag still yields a circle. Both corners
 * are clamped to the frame first and the size is capped by the room left in
 * the drag's own direction, so the square stops at the frame edge instead of
 * sliding sideways.
 */
export function circleFromCorners(
  a: NaturalPoint,
  b: NaturalPoint,
  doc: PlaneSize,
): NaturalCircle {
  const first = clampNaturalPointToCapture(a, doc);
  const second = clampNaturalPointToCapture(b, doc);
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const leftward = dx < 0;
  const upward = dy < 0;
  const roomX = leftward ? first.x : doc.width - first.x;
  const roomY = upward ? first.y : doc.height - first.y;
  const size = Math.max(0, Math.min(Math.max(Math.abs(dx), Math.abs(dy)), roomX, roomY));
  return {
    x: leftward ? first.x - size : first.x,
    y: upward ? first.y - size : first.y,
    size,
  };
}

/**
 * The same circle kept inside the frame: a square larger than the document
 * shrinks to it; otherwise its size is preserved and only its corner moves.
 */
export function clampCircleToCapture(circle: NaturalCircle, doc: PlaneSize): NaturalCircle {
  if (!isFiniteCircle(circle)) throw new RangeError("circle must have finite values");
  const size = Math.min(Math.max(0, circle.size), doc.width, doc.height);
  return {
    x: Math.min(doc.width - size, Math.max(0, circle.x)),
    y: Math.min(doc.height - size, Math.max(0, circle.y)),
    size,
  };
}

/**
 * A circle moved so its bounding square's top-left corner sits at `position`
 * (what React Flow emits during a node drag), clamped to the frame with its
 * size intact.
 */
export function moveCircle(
  circle: NaturalCircle,
  position: NaturalPoint,
  doc: PlaneSize,
): NaturalCircle {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new RangeError("position must have finite coordinates");
  }
  return clampCircleToCapture({ ...circle, x: position.x, y: position.y }, doc);
}

/**
 * The four corner handles a circle offers (D082). There are no edge handles:
 * the square constraint means one drag governs both dimensions, so an edge
 * handle would silently move the two perpendicular edges as well.
 */
export const CIRCLE_RESIZE_HANDLES = ["nw", "ne", "se", "sw"] as const;
export type CircleResizeHandle = (typeof CIRCLE_RESIZE_HANDLES)[number];

/**
 * The circle after dragging one corner handle by `delta` natural pixels from
 * where the gesture started. The opposite corner stays fixed, the dragged
 * corner follows the pointer, and the larger of the two spans sets the new
 * size, so the result is still a square. It never crosses the fixed corner
 * closer than `minimum`, and never leaves the frame.
 */
export function resizeCircle(
  start: NaturalCircle,
  handle: CircleResizeHandle,
  delta: NaturalPoint,
  doc: PlaneSize,
  minimum: number = MIN_SHAPE_SIZE_PX,
): NaturalCircle {
  if (!isFiniteCircle(start)) throw new RangeError("start must have finite values");
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new RangeError("delta must have finite coordinates");
  }
  const east = handle.includes("e");
  const south = handle.includes("s");
  // The corner that stays put is the one opposite the handle.
  const fixedX = east ? start.x : start.x + start.size;
  const fixedY = south ? start.y : start.y + start.size;
  const draggedX = (east ? start.x + start.size : start.x) + delta.x;
  const draggedY = (south ? start.y + start.size : start.y) + delta.y;
  const spanX = east ? draggedX - fixedX : fixedX - draggedX;
  const spanY = south ? draggedY - fixedY : fixedY - draggedY;
  const roomX = east ? doc.width - fixedX : fixedX;
  const roomY = south ? doc.height - fixedY : fixedY;
  // The room left from the fixed corner is at least the starting size, which
  // is at least the minimum, so the floor below can never push it outside.
  const size = Math.max(Math.min(Math.max(spanX, spanY), roomX, roomY), minimum);
  return {
    x: east ? fixedX : fixedX - size,
    y: south ? fixedY : fixedY - size,
    size,
  };
}
