// Natural-pixel geometry for rectangle marks (D079, VAL-MARK-002,
// VAL-CANVAS-001, VAL-CANVAS-003).
//
// This is the pure, named boundary for rectangles, beside geometry.ts for
// pins: the box a drag draws, the clamp that keeps a box inside the frame,
// the minimum size a box must reach, and the move and resize math the
// canvas applies while a gesture is in flight. Nothing here reads the DOM
// or React Flow state. The server applies the same two rules (inside the
// document, at least MIN_SHAPE_SIZE_PX) and rejects rather than clamps.

import { MIN_SHAPE_SIZE_PX } from "../boundaries";
import type { NaturalPoint, PlaneSize } from "./camera";
import { clampNaturalPointToCapture } from "./geometry";

/** A box in screenshot-natural CSS pixels: top-left corner and size. */
export interface NaturalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when all four values are finite numbers. */
export function isFiniteRect(rect: NaturalRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every((value) => Number.isFinite(value));
}

function requireFiniteRect(rect: NaturalRect, label: string): void {
  if (!isFiniteRect(rect)) throw new RangeError(`${label} must have finite values`);
}

/** True when the box reaches the published minimum in both dimensions. */
export function meetsMinimumSize(rect: NaturalRect, minimum: number = MIN_SHAPE_SIZE_PX): boolean {
  return rect.width >= minimum && rect.height >= minimum;
}

/** True when two boxes have identical values. */
export function rectsEqual(a: NaturalRect, b: NaturalRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * The box between two corners, normalized (positive size) and clamped to
 * the frame inclusively. The corners are clamped first, so a drag that
 * starts or ends outside the screenshot still draws up to the edge.
 */
export function rectFromCorners(a: NaturalPoint, b: NaturalPoint, doc: PlaneSize): NaturalRect {
  const first = clampNaturalPointToCapture(a, doc);
  const second = clampNaturalPointToCapture(b, doc);
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  return {
    x,
    y,
    width: Math.max(first.x, second.x) - x,
    height: Math.max(first.y, second.y) - y,
  };
}

/**
 * The same box kept inside the frame: a box larger than the document
 * shrinks to it; otherwise its size is preserved and only its corner moves.
 */
export function clampRectToCapture(rect: NaturalRect, doc: PlaneSize): NaturalRect {
  requireFiniteRect(rect, "rect");
  const width = Math.min(Math.max(0, rect.width), doc.width);
  const height = Math.min(Math.max(0, rect.height), doc.height);
  return {
    x: Math.min(doc.width - width, Math.max(0, rect.x)),
    y: Math.min(doc.height - height, Math.max(0, rect.y)),
    width,
    height,
  };
}

/**
 * A box moved so its top-left corner sits at `position` (what React Flow
 * emits during a node drag), clamped to the frame with its size intact.
 */
export function moveRect(rect: NaturalRect, position: NaturalPoint, doc: PlaneSize): NaturalRect {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new RangeError("position must have finite coordinates");
  }
  return clampRectToCapture({ ...rect, x: position.x, y: position.y }, doc);
}

/** The eight resize handles, named by the edge or corner they move. */
export const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/**
 * The box after dragging one handle by `delta` natural pixels from where the
 * gesture started. Only the edges the handle names move; the opposite edges
 * stay fixed. Each moving edge is clamped to the frame and may never cross
 * its opposite edge closer than the minimum size, so the result is always
 * inside the frame and at least `minimum` in both dimensions (as long as
 * the starting box was).
 */
export function resizeRect(
  start: NaturalRect,
  handle: ResizeHandle,
  delta: NaturalPoint,
  doc: PlaneSize,
  minimum: number = MIN_SHAPE_SIZE_PX,
): NaturalRect {
  requireFiniteRect(start, "start");
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new RangeError("delta must have finite coordinates");
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("w")) left = Math.min(Math.max(0, start.x + delta.x), right - minimum);
  if (handle.includes("e")) {
    right = Math.max(Math.min(doc.width, start.x + start.width + delta.x), left + minimum);
  }
  if (handle.includes("n")) top = Math.min(Math.max(0, start.y + delta.y), bottom - minimum);
  if (handle.includes("s")) {
    bottom = Math.max(Math.min(doc.height, start.y + start.height + delta.y), top + minimum);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The handle's place on the box, as fractions of its width and height. */
export function handleAnchor(handle: ResizeHandle): { x: number; y: number } {
  return {
    x: handle.includes("w") ? 0 : handle.includes("e") ? 1 : 0.5,
    y: handle.includes("n") ? 0 : handle.includes("s") ? 1 : 0.5,
  };
}

/** The CSS cursor for one handle. */
export function handleCursor(handle: ResizeHandle): string {
  return `${handle}-resize`;
}
