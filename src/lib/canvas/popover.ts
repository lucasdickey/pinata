// Screen placement for the pin composer popover (D074).
//
// Pure math: given the draft badge's projected screen point, the popover's
// measured size, and the rectangle it must stay inside, pick the side of the
// badge to open on and clamp the box so it never leaves that rectangle. The
// canvas calls this on every pan, zoom, scroll, and resize; nothing here
// reads the DOM.

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenSize {
  width: number;
  height: number;
}

/** A screen rectangle in client (viewport) coordinates. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type PopoverSide = "right" | "left";

export interface PopoverPlacement {
  left: number;
  top: number;
  /** Which side of the badge the popover opens on. */
  side: PopoverSide;
}

/** Space between the badge and the popover's near edge, in screen px. */
export const POPOVER_GAP_PX = 12;

/** Space kept between the popover and the edge of its bounds, in screen px. */
export const POPOVER_MARGIN_PX = 8;

function clamp(value: number, min: number, max: number): number {
  // When the box is larger than the room it has, pin it to the near edge
  // rather than letting it drift past the far one.
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Where the popover goes. It opens to the right of the badge with its top
 * level with the badge's top; when it would not fit on the right but would
 * on the left, it flips; either way the result is clamped inside `bounds`.
 */
export function placePopover(input: {
  /** The draft tip's screen point. */
  anchor: ScreenPoint;
  /** The badge's on-screen edge length; the badge rises this far above the tip. */
  badge: number;
  size: ScreenSize;
  bounds: ScreenRect;
  gap?: number;
}): PopoverPlacement {
  const { anchor, badge, size, bounds } = input;
  const gap = input.gap ?? POPOVER_GAP_PX;
  const half = badge / 2;
  const rightLeft = anchor.x + half + gap;
  const leftLeft = anchor.x - half - gap - size.width;
  const fitsRight = rightLeft + size.width <= bounds.right;
  const fitsLeft = leftLeft >= bounds.left;
  const side: PopoverSide = fitsRight || !fitsLeft ? "right" : "left";
  const wantedLeft = side === "right" ? rightLeft : leftLeft;
  const wantedTop = anchor.y - badge;
  return {
    side,
    left: clamp(wantedLeft, bounds.left, bounds.right - size.width),
    top: clamp(wantedTop, bounds.top, bounds.bottom - size.height),
  };
}

/** The rectangle two rectangles share, or null when they do not overlap. */
export function intersectRects(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const shared = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  if (shared.right <= shared.left || shared.bottom <= shared.top) return null;
  return shared;
}

function inset(rect: ScreenRect, margin: number): ScreenRect {
  return {
    left: rect.left + margin,
    top: rect.top + margin,
    right: rect.right - margin,
    bottom: rect.bottom - margin,
  };
}

/**
 * The rectangle the popover may occupy: the visible part of the canvas
 * frame when that part is big enough to hold it (so the composer never
 * covers the toolbar or the side panel), otherwise the whole browser
 * viewport (so it is always on screen even when the frame is mostly
 * scrolled away or very small).
 */
export function popoverBounds(
  frame: ScreenRect,
  viewport: ScreenRect,
  size: ScreenSize,
  margin: number = POPOVER_MARGIN_PX,
): ScreenRect {
  const shared = intersectRects(frame, viewport);
  if (
    shared &&
    shared.right - shared.left - 2 * margin >= size.width &&
    shared.bottom - shared.top - 2 * margin >= size.height
  ) {
    return inset(shared, margin);
  }
  return inset(viewport, margin);
}
