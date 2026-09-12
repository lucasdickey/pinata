// Domain → React Flow adaptation for the screenshot plane.
//
// The canonical record is the capture (id, asset route, accessible name,
// persisted document dimensions). The React Flow node produced here is a
// disposable view of that record — raw React Flow state (viewport, measured
// boxes, selection, `toObject()` output) is never persisted, and nothing the
// canvas measures flows back into a domain write.
//
// Ordering rule: the screenshot parent is always index 0 of the node array
// so annotation children (added by later pin/mark features) always resolve
// their `parentId` against a frame that precedes them.

import type { Node } from "@xyflow/react";
import { MIN_HIT_TARGET_CSS_PX } from "../boundaries";
import { pinHitBox, type PinBox } from "./geometry";
import type { NaturalPoint } from "./camera";
import { markLabel, type DraftMark, type MarkElementSource } from "./marks";
import { isFiniteRect, type NaturalRect } from "./rectangle";

/** Custom node type for the one immutable screenshot frame. */
export const CAPTURE_FRAME_TYPE = "captureFrame";

/** Custom node type for one persisted, numbered pin. */
export const PIN_TYPE = "pin";

/** Custom node type for the one transient, unsaved draft pin. */
export const DRAFT_PIN_TYPE = "draftPin";

/** Custom node type for the transient nearby-candidate highlight box. */
export const CONTEXT_PREVIEW_TYPE = "contextPreview";

/** Custom node type for one persisted, numbered rectangle (D079). */
export const RECTANGLE_TYPE = "rectangle";

/** Custom node type for the one transient, unsaved draft rectangle. */
export const DRAFT_RECTANGLE_TYPE = "draftRectangle";

/** The domain facts a capture frame renders from. */
export interface CaptureFrameDomain {
  captureId: string;
  /** Authorized same-origin asset route; never a public or provider URL. */
  assetUrl: string;
  /** Accessible name for the rendered image. */
  name: string;
  /** Persisted natural document dimensions in CSS pixels. */
  width: number;
  height: number;
}

export interface CaptureFrameData extends Record<string, unknown> {
  assetUrl: string;
  name: string;
  width: number;
  height: number;
}

export type CaptureFrameNode = Node<CaptureFrameData, typeof CAPTURE_FRAME_TYPE>;

/** Namespaced so adapter node ids can never collide with annotation ids. */
export function captureFrameNodeId(captureId: string): string {
  return `capture:${captureId}`;
}

function requirePositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

/**
 * The one fixed, unselectable screenshot parent node. Its domain is exactly
 * `document_width × document_height`: no padding, crop, border, or
 * object-fit distortion — the rendered image is the document plane.
 */
export function captureFrameNode(domain: CaptureFrameDomain): CaptureFrameNode {
  requirePositiveFinite(domain.width, "document width");
  requirePositiveFinite(domain.height, "document height");
  return {
    id: captureFrameNodeId(domain.captureId),
    type: CAPTURE_FRAME_TYPE,
    position: { x: 0, y: 0 },
    width: domain.width,
    height: domain.height,
    data: {
      assetUrl: domain.assetUrl,
      name: domain.name,
      width: domain.width,
      height: domain.height,
    },
    draggable: false,
    selectable: false,
    connectable: false,
    deletable: false,
  };
}

/**
 * The controlled node array for one active capture: parent frame first, then
 * the transient context preview highlight when one exists, then the
 * persisted pins in stable server-number order, then the transient draft pin
 * when one exists. Adapter artifacts (frame, preview, draft) use namespaced
 * ids; a persisted pin's node id IS its server annotation id — the domain
 * record is canonical and raw React Flow state is never persisted.
 *
 * Pins only; see nodesForPlane for a plane that also carries rectangles.
 */
export function nodesForCapture(
  domain: CaptureFrameDomain,
  pins: CanvasPin[] = [],
  draftTip?: NaturalPoint | null,
  zoom = 1,
  preview?: ContextRect | null,
): CanvasNode[] {
  return nodesForPlane(domain, {
    pins,
    draft: draftTip ? { kind: "pin", tip: draftTip } : null,
    zoom,
    preview: preview ?? null,
  });
}

/** Everything a plane renders besides its frame. */
export interface PlaneMarks {
  pins?: CanvasPin[];
  rectangles?: CanvasRectangle[];
  /** The one transient draft (pin or rectangle), or null. */
  draft?: DraftMark | null;
  /**
   * A draft rectangle still being drawn: it renders without handles and
   * carries a marker so the composer waits for the release.
   */
  drawing?: boolean;
  zoom?: number;
  preview?: ContextRect | null;
  /**
   * The founder's read-only plane: rectangles render with no handles and
   * no drag. Pins keep their own read-only handling in the canvas.
   */
  readOnly?: boolean;
}

/**
 * The controlled node array for one plane with both mark kinds (D079):
 * frame, then the preview highlight, then every persisted pin and rectangle
 * in one stable number order (the shared sequence), then the draft. Node
 * ids for persisted marks are their server annotation ids.
 */
export function nodesForPlane(domain: CaptureFrameDomain, marks: PlaneMarks): CanvasNode[] {
  const zoom = marks.zoom ?? 1;
  const frame = captureFrameNode(domain);
  const highlight = marks.preview ? contextPreviewNode(domain, marks.preview) : null;
  const ordered: (CanvasPin | CanvasRectangle)[] = [
    ...(marks.pins ?? []),
    ...(marks.rectangles ?? []),
  ].sort((a, b) => a.number - b.number);
  const nodes: CanvasNode[] = [frame, ...(highlight ? [highlight] : [])];
  for (const mark of ordered) {
    nodes.push(
      "rect" in mark
        ? rectangleNode(domain, mark, zoom, { readOnly: marks.readOnly ?? false })
        : pinNode(domain, mark, zoom),
    );
  }
  const draft = marks.draft ?? null;
  if (draft?.kind === "pin") nodes.push(draftPinNode(domain, draft.tip, zoom));
  if (draft?.kind === "rectangle") {
    nodes.push(draftRectangleNode(domain, draft.rect, zoom, { drawing: marks.drawing ?? false }));
  }
  return nodes;
}

/** The domain facts one persisted pin renders from. */
export interface CanvasPin {
  /** Server annotation id; the React Flow node id is exactly this. */
  id: string;
  /** Server-assigned monotonic per-capture number. */
  number: number;
  /** Canonical tip in screenshot-natural pixels. */
  tip: NaturalPoint;
  /** Whether the workspace panel currently shows this pin. */
  selected: boolean;
  /** The comment and attached element, when known: they name the node (D078). */
  body?: string;
  elementSnapshot?: MarkElementSource | null;
}

export interface PinData extends Record<string, unknown> {
  annotationId: string;
  number: number;
  /** Canonical tip in screenshot-natural pixels; the only domain geometry. */
  tipX: number;
  tipY: number;
  /** Hit-box edge and tip offsets from the pure adapter (PinBox). */
  size: number;
  tipOffsetX: number;
  tipOffsetY: number;
  /** Whether the panel selection is on this pin (badge styling only). */
  selected: boolean;
  /** Accessible name for the pin node. */
  label: string;
}

export type PinNode = Node<PinData, typeof PIN_TYPE>;

/**
 * One persisted numbered pin as a child of the screenshot frame. Identical
 * anchoring to the draft: the node box is the zoom-aware hit area and the
 * canonical tip is `position + (tipOffsetX, tipOffsetY)`. Dragging re-derives
 * the clamped tip through the same pure adapter, and the commit at drag end
 * is the only write — intermediate frames move local state only.
 */
export function pinNode(domain: CaptureFrameDomain, pin: CanvasPin, zoom: number): PinNode {
  const box: PinBox = pinHitBox(pin.tip, { width: domain.width, height: domain.height }, zoom);
  // The node is named the way every list names the mark: by its comment
  // and element, never by its coordinates (D078).
  const label = markLabel({
    kind: "pin",
    number: pin.number,
    body: pin.body ?? "",
    elementSnapshot: pin.elementSnapshot ?? null,
  });
  return {
    id: pin.id,
    type: PIN_TYPE,
    parentId: captureFrameNodeId(domain.captureId),
    position: { x: box.x, y: box.y },
    width: box.size,
    height: box.size,
    data: {
      annotationId: pin.id,
      number: pin.number,
      tipX: pin.tip.x,
      tipY: pin.tip.y,
      size: box.size,
      tipOffsetX: box.tipOffsetX,
      tipOffsetY: box.tipOffsetY,
      selected: pin.selected,
      label,
    },
    ariaLabel: label,
    draggable: true,
    selectable: false,
    connectable: false,
    deletable: false,
  };
}

export interface DraftPinData extends Record<string, unknown> {
  /** Canonical tip in screenshot-natural pixels; the only domain fact. */
  tipX: number;
  tipY: number;
  /** Hit-box edge and tip offsets from the pure adapter (PinBox). */
  size: number;
  tipOffsetX: number;
  tipOffsetY: number;
  /** Accessible name for the draft node. */
  label: string;
}

export type DraftPinNode = Node<DraftPinData, typeof DRAFT_PIN_TYPE>;

/**
 * A nearby-candidate bounding rectangle in screenshot-natural CSS pixels —
 * exactly the persisted manifest element's rect, never a measured or
 * CSS-scaled box.
 */
export interface ContextRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContextPreviewData extends Record<string, unknown> {
  rectX: number;
  rectY: number;
  rectWidth: number;
  rectHeight: number;
  /** Accessible name (the box itself is aria-hidden decoration). */
  label: string;
}

export type ContextPreviewNode = Node<ContextPreviewData, typeof CONTEXT_PREVIEW_TYPE>;

export type CanvasNode =
  | CaptureFrameNode
  | PinNode
  | DraftPinNode
  | ContextPreviewNode
  | RectangleNode
  | DraftRectangleNode;

/**
 * The preview node id is a deterministic namespaced derivative of the
 * capture id: at most one highlight exists per plane, and it can never
 * collide with a server-assigned annotation id.
 */
export function contextPreviewNodeId(captureId: string): string {
  return `context-preview:${captureId}`;
}

/**
 * The transient nearby-candidate highlight as a child of the screenshot
 * frame (VAL-PIN-004, VAL-PIN-010). Its position and size are exactly the
 * candidate's persisted natural-pixel rect, so the box inverse-transforms to
 * the manifest rectangle within one natural pixel at any zoom. The preview
 * is decoration over local UI state: it is never draggable, selectable,
 * persisted, numbered, or listed as an annotation, it ignores all pointer
 * events, and it vanishes on choice, blur, cancel, save, and plane switch.
 *
 * Unlike pins, an invalid rect yields no node instead of a throw: a corrupt
 * highlight must never take the whole plane down.
 */
export function contextPreviewNode(
  domain: CaptureFrameDomain,
  rect: ContextRect,
): ContextPreviewNode | null {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (
    !values.every((value) => typeof value === "number" && Number.isFinite(value)) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }
  return {
    id: contextPreviewNodeId(domain.captureId),
    type: CONTEXT_PREVIEW_TYPE,
    parentId: captureFrameNodeId(domain.captureId),
    position: { x: rect.x, y: rect.y },
    width: rect.width,
    height: rect.height,
    data: {
      rectX: rect.x,
      rectY: rect.y,
      rectWidth: rect.width,
      rectHeight: rect.height,
      label: "Highlighted nearby element",
    },
    ariaLabel: "Highlighted nearby element",
    draggable: false,
    selectable: false,
    connectable: false,
    deletable: false,
    focusable: false,
    // React Flow 12.11 computes the wrapper's pointer-events from
    // interactivity (selectable/draggable/handlers) and ignores the Node
    // pointerEvents field; node.style spreads AFTER that computed value, so
    // this inline style is what actually keeps the box pointer-transparent.
    style: { pointerEvents: "none" },
  };
}

/**
 * The draft pin node id is a deterministic namespaced derivative of the
 * capture id: it can never collide with a server-assigned annotation id,
 * and there is at most one draft per plane.
 */
export function draftPinNodeId(captureId: string): string {
  return `draft-pin:${captureId}`;
}

/**
 * The transient draft pin as a child of the screenshot frame. The node box
 * is the zoom-aware hit area from the pure adapter; the canonical tip is
 * `position + (tipOffsetX, tipOffsetY)` and never moves when the box is
 * recomputed for a new zoom. A draft is local UI state: it is never
 * persisted, numbered, or listed as an annotation.
 *
 * Deliberately no `extent: "parent"`: React Flow's parent-extent clamp
 * rewrites the emitted drag position to the frame edge and thereby hides
 * how far past the edge the pointer is. Re-deriving the tip from that
 * pre-clamped box plus the grab offset leaves the tip stranded one grab
 * offset inside the frame instead of on the boundary. The pure adapter is
 * the single clamping authority (`dragPinBox` clamps the candidate tip
 * inclusively, `pinHitBox` keeps the box inside the frame), so the rendered
 * node can never leave the frame even without a React Flow extent.
 */
export function draftPinNode(
  domain: CaptureFrameDomain,
  tip: NaturalPoint,
  zoom: number,
): DraftPinNode {
  const box: PinBox = pinHitBox(tip, { width: domain.width, height: domain.height }, zoom);
  const label = "New pin, not saved yet";
  return {
    id: draftPinNodeId(domain.captureId),
    type: DRAFT_PIN_TYPE,
    parentId: captureFrameNodeId(domain.captureId),
    position: { x: box.x, y: box.y },
    width: box.size,
    height: box.size,
    data: {
      tipX: tip.x,
      tipY: tip.y,
      size: box.size,
      tipOffsetX: box.tipOffsetX,
      tipOffsetY: box.tipOffsetY,
      label,
    },
    ariaLabel: label,
    draggable: true,
    selectable: false,
    connectable: false,
    deletable: false,
  };
}

/** The domain facts one persisted rectangle renders from (D079). */
export interface CanvasRectangle {
  /** Server annotation id; the React Flow node id is exactly this. */
  id: string;
  /** Server-assigned monotonic per-capture number (shared with pins). */
  number: number;
  /** Canonical box in screenshot-natural pixels. */
  rect: NaturalRect;
  /** Whether the workspace panel currently shows this rectangle. */
  selected: boolean;
  /** The comment and attached element, when known: they name the node (D078). */
  body?: string;
  elementSnapshot?: MarkElementSource | null;
}

/** On-screen sizes the rectangle chrome keeps constant across zoom. */
export const RECTANGLE_STROKE_SCREEN_PX = 2;
export const RECTANGLE_GRAB_SCREEN_PX = 14;
export const RECTANGLE_HANDLE_DOT_SCREEN_PX = 10;

export interface RectangleData extends Record<string, unknown> {
  /** The annotation id for saved rectangles; the namespaced id for a draft. */
  annotationId: string;
  /** The server number, or null for a draft. */
  number: number | null;
  /** Canonical box in screenshot-natural pixels; the only domain geometry. */
  rectX: number;
  rectY: number;
  rectWidth: number;
  rectHeight: number;
  /** Whether this is the transient draft. */
  draft: boolean;
  /** Whether the draft is still being drawn (no handles, no composer yet). */
  drawing: boolean;
  /** Whether the panel selection is on this rectangle (styling only). */
  selected: boolean;
  /** Whether the eight resize handles render (never on a read-only plane). */
  handles: boolean;
  /** Natural-pixel sizes derived from the zoom so the chrome stays screen-sized. */
  strokeWidth: number;
  grabWidth: number;
  badgeSize: number;
  handleSize: number;
  handleDotSize: number;
  /** Accessible name for the node. */
  label: string;
}

export type RectangleNode = Node<RectangleData, typeof RECTANGLE_TYPE>;
export type DraftRectangleNode = Node<RectangleData, typeof DRAFT_RECTANGLE_TYPE>;

function requireRect(rect: NaturalRect, label: string): void {
  if (!isFiniteRect(rect) || rect.width < 0 || rect.height < 0) {
    throw new RangeError(`${label} must be a finite box with non-negative size`);
  }
}

/** The zoom-derived natural-pixel sizes of the rectangle chrome. */
function rectangleChrome(doc: { width: number; height: number }, zoom: number) {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError("zoom must be a positive finite number");
  }
  return {
    strokeWidth: RECTANGLE_STROKE_SCREEN_PX / zoom,
    grabWidth: RECTANGLE_GRAB_SCREEN_PX / zoom,
    badgeSize: Math.min(Math.min(doc.width, doc.height), MIN_HIT_TARGET_CSS_PX / zoom),
    handleSize: MIN_HIT_TARGET_CSS_PX / zoom,
    handleDotSize: RECTANGLE_HANDLE_DOT_SCREEN_PX / zoom,
  };
}

/**
 * One persisted numbered rectangle as a child of the screenshot frame
 * (D079). Its position and size ARE the persisted natural-pixel box: no
 * padding, no hit-box math, so the rendered edge inverse-transforms to the
 * stored geometry within one natural pixel at any zoom. The wrapper itself
 * is pointer-transparent (a click inside a box still lands on the
 * screenshot, so a pin can be dropped there); its stroke, badge, and
 * handles take the pointer. Dragging the stroke or badge moves the box and
 * commits one revisioned write at drag end; the handles resize it the same
 * way. A read-only plane renders no handles and no drag.
 *
 * Deliberately no `extent: "parent"`, for the same reason as pins: the
 * pure adapter (moveRect, resizeRect) is the single clamping authority.
 */
export function rectangleNode(
  domain: CaptureFrameDomain,
  rectangle: CanvasRectangle,
  zoom: number,
  options: { readOnly?: boolean } = {},
): RectangleNode {
  requireRect(rectangle.rect, "rect");
  const chrome = rectangleChrome(domain, zoom);
  const label = markLabel({
    kind: "rectangle",
    number: rectangle.number,
    body: rectangle.body ?? "",
    elementSnapshot: rectangle.elementSnapshot ?? null,
  });
  const readOnly = options.readOnly ?? false;
  return {
    id: rectangle.id,
    type: RECTANGLE_TYPE,
    parentId: captureFrameNodeId(domain.captureId),
    position: { x: rectangle.rect.x, y: rectangle.rect.y },
    width: rectangle.rect.width,
    height: rectangle.rect.height,
    data: {
      annotationId: rectangle.id,
      number: rectangle.number,
      rectX: rectangle.rect.x,
      rectY: rectangle.rect.y,
      rectWidth: rectangle.rect.width,
      rectHeight: rectangle.rect.height,
      draft: false,
      drawing: false,
      selected: rectangle.selected,
      handles: !readOnly,
      ...chrome,
      label,
    },
    ariaLabel: label,
    draggable: !readOnly,
    selectable: false,
    connectable: false,
    deletable: false,
    // See contextPreviewNode: only node.style reliably sets the wrapper's
    // pointer-events. The children opt back in.
    style: { pointerEvents: "none" },
  };
}

/**
 * The draft rectangle node id is a deterministic namespaced derivative of
 * the capture id: it can never collide with a server-assigned annotation
 * id, and there is at most one draft per plane.
 */
export function draftRectangleNodeId(captureId: string): string {
  return `draft-rectangle:${captureId}`;
}

/**
 * The transient draft rectangle as a child of the screenshot frame: the box
 * being drawn (no handles yet) or the drawn box awaiting its comment
 * (draggable and resizable). A draft is local UI state: never persisted,
 * numbered, or listed as an annotation.
 */
export function draftRectangleNode(
  domain: CaptureFrameDomain,
  rect: NaturalRect,
  zoom: number,
  options: { drawing?: boolean } = {},
): DraftRectangleNode {
  requireRect(rect, "rect");
  const chrome = rectangleChrome(domain, zoom);
  const drawing = options.drawing ?? false;
  const label = "New box, not saved yet";
  return {
    id: draftRectangleNodeId(domain.captureId),
    type: DRAFT_RECTANGLE_TYPE,
    parentId: captureFrameNodeId(domain.captureId),
    position: { x: rect.x, y: rect.y },
    width: rect.width,
    height: rect.height,
    data: {
      annotationId: draftRectangleNodeId(domain.captureId),
      number: null,
      rectX: rect.x,
      rectY: rect.y,
      rectWidth: rect.width,
      rectHeight: rect.height,
      draft: true,
      drawing,
      selected: false,
      handles: !drawing,
      ...chrome,
      label,
    },
    ariaLabel: label,
    draggable: !drawing,
    selectable: false,
    connectable: false,
    deletable: false,
    style: { pointerEvents: "none" },
  };
}
