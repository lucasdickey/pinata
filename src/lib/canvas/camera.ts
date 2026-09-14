// Camera math for the capture canvas (VAL-CANVAS-002).
//
// The canvas viewport transform is `(x, y, zoom)` in the same sense React
// Flow uses: a screenshot-natural (flow) point p renders at screen point
// `p * zoom + (x, y)`. These pure functions are the single source for the
// three named camera modes and for the inverse transform the tests and
// browser measurements use. Camera state is local UI state only — it is
// computed from the viewport and the capture's persisted document
// dimensions, and it is never persisted or derived from React Flow's
// measured state.

/** Deepest supported zoom: the published 8x floor for dense detail. */
export const CANVAS_MAX_ZOOM = 8;

/**
 * Shallowest supported zoom. 0.01 fits the tallest published document
 * (MAX_DOCUMENT_HEIGHT_PX) into a minimum-height stage with room to spare,
 * so the entire-capture overview is always reachable.
 */
export const CANVAS_MIN_ZOOM = 0.01;

/** Screen-pixel margin the named modes keep around the capture. */
export const CANVAS_PADDING_PX = 12;

export interface PlaneSize {
  width: number;
  height: number;
}

/** A React Flow viewport transform: screen = flow * zoom + (x, y). */
export interface CanvasCamera {
  x: number;
  y: number;
  zoom: number;
}

export interface NaturalPoint {
  x: number;
  y: number;
}

function requirePositiveFinite(size: PlaneSize, label: string): void {
  for (const [key, value] of Object.entries(size)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${label}.${key} must be a positive finite number`);
    }
  }
}

/** Inclusive clamp to the published zoom range. */
export function clampCanvasZoom(zoom: number): number {
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, zoom));
}

/** The zoom-usable viewport after the mode margin. */
function usable(viewport: PlaneSize): PlaneSize {
  return {
    width: Math.max(1, viewport.width - 2 * CANVAS_PADDING_PX),
    height: Math.max(1, viewport.height - 2 * CANVAS_PADDING_PX),
  };
}

/**
 * Entire-capture view (the initial camera): the whole document is contained
 * in the viewport, centered, with the mode margin. Overview of a long page
 * is exactly this mode — all four corners are visible at once.
 */
export function containCamera(viewport: PlaneSize, doc: PlaneSize): CanvasCamera {
  requirePositiveFinite(viewport, "viewport");
  requirePositiveFinite(doc, "document");
  const area = usable(viewport);
  const zoom = clampCanvasZoom(Math.min(area.width / doc.width, area.height / doc.height));
  return {
    x: (viewport.width - doc.width * zoom) / 2,
    y: (viewport.height - doc.height * zoom) / 2,
    zoom,
  };
}

/**
 * Fit-width view: the document fills the viewport horizontally and its top
 * edge sits at the top margin, so a long page reads downward from the top.
 */
export function widthFitCamera(viewport: PlaneSize, doc: PlaneSize): CanvasCamera {
  requirePositiveFinite(viewport, "viewport");
  requirePositiveFinite(doc, "document");
  const area = usable(viewport);
  const zoom = clampCanvasZoom(area.width / doc.width);
  return {
    x: (viewport.width - doc.width * zoom) / 2,
    y: CANVAS_PADDING_PX,
    zoom,
  };
}

/**
 * Natural-size view: exactly 1:1 screenshot-natural pixels, top edge
 * visible. A capture narrower than the viewport centers; a wider one anchors
 * at the left margin so horizontal panning reads naturally.
 */
export function naturalCamera(viewport: PlaneSize, doc: PlaneSize): CanvasCamera {
  requirePositiveFinite(viewport, "viewport");
  requirePositiveFinite(doc, "document");
  return {
    x: doc.width <= viewport.width ? (viewport.width - doc.width) / 2 : CANVAS_PADDING_PX,
    y: CANVAS_PADDING_PX,
    zoom: clampCanvasZoom(1),
  };
}

/**
 * A camera that puts one screenshot-natural point in the middle of the
 * viewport at the given zoom (D078): how the canvas brings a chosen mark
 * into view without changing how far in the reader was.
 */
export function centerCamera(viewport: PlaneSize, point: NaturalPoint, zoom: number): CanvasCamera {
  requirePositiveFinite(viewport, "viewport");
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("point must be finite");
  }
  const clamped = clampCanvasZoom(zoom);
  return {
    x: viewport.width / 2 - point.x * clamped,
    y: viewport.height / 2 - point.y * clamped,
    zoom: clamped,
  };
}

/** Project a screenshot-natural point to its screen point under a camera. */
export function flowToScreen(point: NaturalPoint, camera: CanvasCamera): NaturalPoint {
  return {
    x: point.x * camera.zoom + camera.x,
    y: point.y * camera.zoom + camera.y,
  };
}

/** Inverse of {@link flowToScreen}: the natural pixel under a screen point. */
export function screenToFlow(point: NaturalPoint, camera: CanvasCamera): NaturalPoint {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}
