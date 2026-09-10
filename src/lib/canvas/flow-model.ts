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

/** Custom node type for the one immutable screenshot frame. */
export const CAPTURE_FRAME_TYPE = "captureFrame";

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
 * any annotation children (none yet — pins land with the pins feature).
 */
export function nodesForCapture(domain: CaptureFrameDomain): CaptureFrameNode[] {
  return [captureFrameNode(domain)];
}
