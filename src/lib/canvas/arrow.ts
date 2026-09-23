// Natural-pixel geometry for arrow marks (D083, VAL-MARK-002,
// VAL-CANVAS-001, VAL-CANVAS-003).
//
// An arrow is two points and a direction: a tail at `start` and a head at
// `end`. The head is what the mark is about, which is why the nearby-element
// context is taken from it and the badge rides at the tail instead. This is
// the pure, named boundary beside rectangle.ts and circle.ts: the arrow a
// drag draws, the clamp that keeps both endpoints inside the frame, the
// minimum length, the move and endpoint math a gesture applies, and the
// distance-to-segment hit test that stands in for a box test, since an arrow
// has no area. Nothing here reads the DOM or React Flow state. The server
// applies the same two rules (both endpoints inside the document, at least
// MIN_ARROW_LENGTH_PX apart) and rejects rather than clamps.

import { MIN_ARROW_LENGTH_PX } from "../boundaries";
import type { NaturalPoint, PlaneSize } from "./camera";
import { clampNaturalPointToCapture } from "./geometry";
import type { NaturalRect } from "./rectangle";

/** An arrow in screenshot-natural CSS pixels: tail, then head. */
export interface NaturalArrow {
  /** The tail: where the arrow is drawn from, and where its badge rides. */
  start: NaturalPoint;
  /** The head: where the arrow points, and what the mark is about. */
  end: NaturalPoint;
}

/** Which endpoint a gesture is moving. */
export type ArrowEndpoint = "start" | "end";

/** True when all four coordinates are finite numbers. */
export function isFiniteArrow(arrow: NaturalArrow): boolean {
  return [arrow.start.x, arrow.start.y, arrow.end.x, arrow.end.y].every((value) =>
    Number.isFinite(value),
  );
}

function requireFiniteArrow(arrow: NaturalArrow, label: string): void {
  if (!isFiniteArrow(arrow)) throw new RangeError(`${label} must have finite values`);
}

/** The straight-line distance from the tail to the head. */
export function arrowLength(arrow: NaturalArrow): number {
  return Math.hypot(arrow.end.x - arrow.start.x, arrow.end.y - arrow.start.y);
}

/** True when the arrow reaches the published minimum length. */
export function meetsMinimumArrowLength(
  arrow: NaturalArrow,
  minimum: number = MIN_ARROW_LENGTH_PX,
): boolean {
  return arrowLength(arrow) >= minimum;
}

/** True when two arrows have identical endpoints. */
export function arrowsEqual(a: NaturalArrow, b: NaturalArrow): boolean {
  return (
    a.start.x === b.start.x &&
    a.start.y === b.start.y &&
    a.end.x === b.end.x &&
    a.end.y === b.end.y
  );
}

/** The smallest box containing both endpoints. It may have zero width or height. */
export function arrowBounds(arrow: NaturalArrow): NaturalRect {
  const x = Math.min(arrow.start.x, arrow.end.x);
  const y = Math.min(arrow.start.y, arrow.end.y);
  return {
    x,
    y,
    width: Math.max(arrow.start.x, arrow.end.x) - x,
    height: Math.max(arrow.start.y, arrow.end.y) - y,
  };
}

/** The middle of the shaft: what a camera centers to show the whole arrow. */
export function arrowMidpoint(arrow: NaturalArrow): NaturalPoint {
  return {
    x: (arrow.start.x + arrow.end.x) / 2,
    y: (arrow.start.y + arrow.end.y) / 2,
  };
}

/**
 * The arrow a drag draws: the press point is the tail and the release point
 * is the head, both clamped to the frame. Direction is the whole point, so
 * the two points are never reordered.
 */
export function arrowFromPoints(
  start: NaturalPoint,
  end: NaturalPoint,
  doc: PlaneSize,
): NaturalArrow {
  return {
    start: clampNaturalPointToCapture(start, doc),
    end: clampNaturalPointToCapture(end, doc),
  };
}

/** The same arrow with both endpoints clamped inside the frame. */
export function clampArrowToCapture(arrow: NaturalArrow, doc: PlaneSize): NaturalArrow {
  requireFiniteArrow(arrow, "arrow");
  return {
    start: clampNaturalPointToCapture(arrow.start, doc),
    end: clampNaturalPointToCapture(arrow.end, doc),
  };
}

/**
 * The whole arrow shifted by `delta` natural pixels: what dragging the shaft
 * does. The shift is reduced until both endpoints are inside the frame, so
 * the arrow keeps its length and direction exactly and slides along the edge
 * instead of being clipped.
 */
export function translateArrow(
  arrow: NaturalArrow,
  delta: NaturalPoint,
  doc: PlaneSize,
): NaturalArrow {
  requireFiniteArrow(arrow, "arrow");
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new RangeError("delta must have finite coordinates");
  }
  const bounds = arrowBounds(arrow);
  // The arrow was inside the frame, so at most one edge can bite per axis.
  const shiftX = Math.min(doc.width - (bounds.x + bounds.width), Math.max(-bounds.x, delta.x));
  const shiftY = Math.min(doc.height - (bounds.y + bounds.height), Math.max(-bounds.y, delta.y));
  return {
    start: { x: arrow.start.x + shiftX, y: arrow.start.y + shiftY },
    end: { x: arrow.end.x + shiftX, y: arrow.end.y + shiftY },
  };
}

/**
 * One endpoint dragged to `point`: the other endpoint stays exactly where it
 * was. The point is clamped to the frame, and an arrow that would fall under
 * `minimum` is pushed back out along its own direction to exactly the
 * minimum; when even that lands outside the frame the arrow is left as it
 * was, so a gesture can never commit geometry the server would reject.
 */
export function dragArrowEndpoint(
  arrow: NaturalArrow,
  endpoint: ArrowEndpoint,
  point: NaturalPoint,
  doc: PlaneSize,
  minimum: number = MIN_ARROW_LENGTH_PX,
): NaturalArrow {
  requireFiniteArrow(arrow, "arrow");
  const fixed = endpoint === "start" ? arrow.end : arrow.start;
  const moved = clampNaturalPointToCapture(point, doc);
  const candidate: NaturalArrow =
    endpoint === "start" ? { start: moved, end: fixed } : { start: fixed, end: moved };
  if (meetsMinimumArrowLength(candidate, minimum)) return candidate;
  // Too short: push the dragged end out to the minimum along the direction
  // it currently has, falling back to the arrow's own direction when the two
  // points coincide.
  const dx = moved.x - fixed.x;
  const dy = moved.y - fixed.y;
  const length = Math.hypot(dx, dy);
  const fallbackX = endpoint === "start" ? arrow.start.x - fixed.x : arrow.end.x - fixed.x;
  const fallbackY = endpoint === "start" ? arrow.start.y - fixed.y : arrow.end.y - fixed.y;
  const fallbackLength = Math.hypot(fallbackX, fallbackY) || 1;
  const unit =
    length > 0
      ? { x: dx / length, y: dy / length }
      : { x: fallbackX / fallbackLength, y: fallbackY / fallbackLength };
  // The push is scaled up by a few ulps until the length the server will
  // take again (the hypot of end minus start) is not under the minimum
  // (D096): along a diagonal, fixed + unit * minimum can land short.
  let reach = minimum;
  let pushed = { x: fixed.x + unit.x * reach, y: fixed.y + unit.y * reach };
  const pushedArrow = (point: NaturalPoint): NaturalArrow =>
    endpoint === "start" ? { start: point, end: fixed } : { start: fixed, end: point };
  for (let step = 0; step < 8 && arrowLength(pushedArrow(pushed)) < minimum; step += 1) {
    reach += minimum * Number.EPSILON * 4;
    pushed = { x: fixed.x + unit.x * reach, y: fixed.y + unit.y * reach };
  }
  if (pushed.x < 0 || pushed.y < 0 || pushed.x > doc.width || pushed.y > doc.height) {
    return arrow;
  }
  return pushedArrow(pushed);
}

/**
 * Distance from a point to the arrow's shaft, measured to the segment rather
 * than to its infinite line, so a point beyond either endpoint measures to
 * that endpoint. This is what selecting an arrow means: an arrow has no
 * interior to be inside of.
 */
export function distanceToArrow(arrow: NaturalArrow, point: NaturalPoint): number {
  const dx = arrow.end.x - arrow.start.x;
  const dy = arrow.end.y - arrow.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - arrow.start.x, point.y - arrow.start.y);
  const along =
    ((point.x - arrow.start.x) * dx + (point.y - arrow.start.y) * dy) / lengthSquared;
  const clamped = Math.min(1, Math.max(0, along));
  return Math.hypot(
    point.x - (arrow.start.x + clamped * dx),
    point.y - (arrow.start.y + clamped * dy),
  );
}

/**
 * Whether a point is close enough to the shaft to count as hitting it. The
 * tolerance is in the same natural pixels as the geometry; the canvas
 * derives it from ARROW_HIT_TOLERANCE_CSS_PX and the live zoom, so the band
 * keeps its screen size without the stored arrow changing.
 */
export function arrowHitsPoint(
  arrow: NaturalArrow,
  point: NaturalPoint,
  tolerance: number,
): boolean {
  if (!isFiniteArrow(arrow) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return false;
  }
  return distanceToArrow(arrow, point) <= tolerance;
}
