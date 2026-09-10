// Natural-pixel coordinate adapter for annotation geometry (VAL-CANVAS-001,
// VAL-CANVAS-003, VAL-CANVAS-008).
//
// This is the pure, named boundary between domain geometry (screenshot-natural
// CSS pixels) and what the React Flow adapter renders. Centralized here:
// finite-value and capture-bound validation, the inclusive canonical clamps,
// and the pin hit-box math that keeps the shared minimum screen hit target
// (MIN_HIT_TARGET_CSS_PX) at every zoom without ever moving the canonical
// pin tip.
//
// Nothing here reads the DOM, React Flow measured state, or rounded display
// strings. Canonicalization happens only at these documented boundaries.

import { MIN_HIT_TARGET_CSS_PX } from "../boundaries";
import type { NaturalPoint, PlaneSize } from "./camera";

/**
 * Pointer travel, in screen px, below which a pointer press/release pair is a
 * deliberate placement tap rather than a drag. Only used in placement mode,
 * where panning is disabled, so a slow small wobble still places exactly one
 * draft at the release point.
 */
export const PLACEMENT_SLOP_SCREEN_PX = 6;

/** True when both coordinates are finite numbers. */
export function isFiniteNaturalPoint(point: NaturalPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function requireFinitePoint(point: NaturalPoint, label: string): void {
  if (!isFiniteNaturalPoint(point)) {
    throw new RangeError(`${label} must have finite coordinates`);
  }
}

function requirePositiveFiniteSize(size: PlaneSize, label: string): void {
  for (const [key, value] of Object.entries(size)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${label}.${key} must be a positive finite number`);
    }
  }
}

/**
 * The canonical capture-bound clamp: inclusive on every edge, so a pin tip
 * may sit exactly on `0`, `document_width`, or `document_height`. Non-finite
 * input is rejected rather than silently clamped.
 */
export function clampNaturalPointToCapture(
  point: NaturalPoint,
  doc: PlaneSize,
): NaturalPoint {
  requireFinitePoint(point, "point");
  requirePositiveFiniteSize(doc, "document");
  return {
    x: Math.min(doc.width, Math.max(0, point.x)),
    y: Math.min(doc.height, Math.max(0, point.y)),
  };
}

/**
 * A pin's React Flow node box in parent-local natural pixels. The node box is
 * only the hit area and badge anchor: it is sized so its on-screen extent is
 * at least MIN_HIT_TARGET_CSS_PX at the current zoom, and it is clamped into
 * the frame so React Flow's parent extent never engages. The canonical tip is
 * always recoverable as `x + tipOffsetX, y + tipOffsetY` — the box moves
 * around the tip, never the reverse.
 */
export interface PinBox {
  x: number;
  y: number;
  /** Square hit-box edge length in natural px. */
  size: number;
  /** Tip offset from the box's top-left, in natural px. */
  tipOffsetX: number;
  tipOffsetY: number;
}

/**
 * The hit box for a pin tip at a zoom. `size * zoom` is at least
 * MIN_HIT_TARGET_CSS_PX whenever the document is large enough, so the
 * pointer/touch target never shrinks below the shared minimum at deep zoom
 * and never grows past the document at overview zoom. The tip sits at the
 * bottom-center of the box unless the box had to be clamped into the frame,
 * in which case the recorded offsets keep the tip exact.
 */
export function pinHitBox(tip: NaturalPoint, doc: PlaneSize, zoom: number): PinBox {
  requireFinitePoint(tip, "tip");
  requirePositiveFiniteSize(doc, "document");
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError("zoom must be a positive finite number");
  }
  const size = Math.min(Math.min(doc.width, doc.height), MIN_HIT_TARGET_CSS_PX / zoom);
  const x = Math.min(doc.width - size, Math.max(0, tip.x - size / 2));
  const y = Math.min(doc.height - size, Math.max(0, tip.y - size));
  return { x, y, size, tipOffsetX: tip.x - x, tipOffsetY: tip.y - y };
}

/** The canonical tip a pin box anchors: the exact inverse of the offsets. */
export function tipFromPinBox(box: PinBox): NaturalPoint {
  return { x: box.x + box.tipOffsetX, y: box.y + box.tipOffsetY };
}

/**
 * Re-derive the hit box after a drag moved the node's top-left to
 * `position`. The candidate tip is the dragged position plus the offsets of
 * the box the drag started from (the pointer's grab offset is preserved by
 * React Flow's drag delta; only the canonical clamp bites, at the frame
 * edges). The returned box always re-anchors on the clamped tip, so the
 * rendered badge and any later commit agree exactly.
 */
export function dragPinBox(
  position: NaturalPoint,
  grab: Pick<PinBox, "tipOffsetX" | "tipOffsetY">,
  doc: PlaneSize,
  zoom: number,
): PinBox {
  requireFinitePoint(position, "position");
  const candidate = {
    x: position.x + grab.tipOffsetX,
    y: position.y + grab.tipOffsetY,
  };
  return pinHitBox(clampNaturalPointToCapture(candidate, doc), doc, zoom);
}
