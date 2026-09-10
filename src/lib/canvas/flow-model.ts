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
import { pinHitBox, type PinBox } from "./geometry";
import type { NaturalPoint } from "./camera";

/** Custom node type for the one immutable screenshot frame. */
export const CAPTURE_FRAME_TYPE = "captureFrame";

/** Custom node type for one persisted, numbered pin. */
export const PIN_TYPE = "pin";

/** Custom node type for the one transient, unsaved draft pin. */
export const DRAFT_PIN_TYPE = "draftPin";

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
 * the persisted pins in stable server-number order, then the transient draft
 * pin when one exists. Adapter artifacts (frame, draft) use namespaced ids;
 * a persisted pin's node id IS its server annotation id — the domain record
 * is canonical and raw React Flow state is never persisted.
 */
export function nodesForCapture(
  domain: CaptureFrameDomain,
  pins: CanvasPin[] = [],
  draftTip?: NaturalPoint | null,
  zoom = 1,
): CanvasNode[] {
  const frame = captureFrameNode(domain);
  const ordered = [...pins].sort((a, b) => a.number - b.number);
  const nodes: CanvasNode[] = [
    frame,
    ...ordered.map((pin) => pinNode(domain, pin, zoom)),
  ];
  return draftTip ? [...nodes, draftPinNode(domain, draftTip, zoom)] : nodes;
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
  const label = `Pin ${pin.number} at natural pixel (${Math.round(pin.tip.x)}, ${Math.round(
    pin.tip.y,
  )})`;
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

export type CanvasNode = CaptureFrameNode | PinNode | DraftPinNode;

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
  const label = `Draft pin at natural pixel (${Math.round(tip.x)}, ${Math.round(tip.y)}) — not saved yet`;
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
