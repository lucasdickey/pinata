// Domain → React Flow adaptation for the screenshot plane (VAL-CANVAS-001,
// VAL-CANVAS-002). The canonical record is the capture DTO; the React Flow
// node is a throwaway view of it. These tests pin the contract: one fixed,
// unselectable parent at exactly the persisted document dimensions, first in
// every node array, carrying no React Flow runtime state back into the
// domain.

import { describe, expect, test } from "vitest";
import { MIN_HIT_TARGET_CSS_PX } from "../../src/lib/boundaries";
import {
  CAPTURE_FRAME_TYPE,
  captureFrameNodeId,
  CONTEXT_PREVIEW_TYPE,
  contextPreviewNode,
  contextPreviewNodeId,
  DRAFT_PIN_TYPE,
  draftPinNode,
  draftPinNodeId,
  DRAFT_RECTANGLE_TYPE,
  draftRectangleNode,
  draftRectangleNodeId,
  nodesForCapture,
  nodesForPlane,
  PIN_TYPE,
  pinNode,
  RECTANGLE_TYPE,
  rectangleNode,
  type CanvasPin,
  type CanvasRectangle,
  type CaptureFrameDomain,
} from "../../src/lib/canvas/flow-model";
import { pinHitBox, tipFromPinBox } from "../../src/lib/canvas/geometry";

const domain: CaptureFrameDomain = {
  captureId: "cap-root-desktop-v2",
  assetUrl: "/api/captures/cap-root-desktop-v2/asset",
  name: "Screenshot of https://chickpea.co/ (Desktop, version 2)",
  width: 1440,
  height: 8966,
};

describe("capture frame node", () => {
  test("is a single parent node at the origin with natural document dimensions", () => {
    const nodes = nodesForCapture(domain);
    expect(nodes).toHaveLength(1);
    const frame = nodes[0]!;
    expect(frame.id).toBe(captureFrameNodeId(domain.captureId));
    expect(frame.id).toBe("capture:cap-root-desktop-v2");
    expect(frame.type).toBe(CAPTURE_FRAME_TYPE);
    expect(frame.position).toEqual({ x: 0, y: 0 });
    expect(frame.width).toBe(1440);
    expect(frame.height).toBe(8966);
  });

  test("is inert in the graph: not draggable, selectable, connectable, or deletable", () => {
    const frame = nodesForCapture(domain)[0]!;
    expect(frame.draggable).toBe(false);
    expect(frame.selectable).toBe(false);
    expect(frame.connectable).toBe(false);
    expect(frame.deletable).toBe(false);
  });

  test("carries only domain data: asset route, accessible name, and dimensions", () => {
    const frame = nodesForCapture(domain)[0]!;
    expect(frame.data).toEqual({
      assetUrl: "/api/captures/cap-root-desktop-v2/asset",
      name: "Screenshot of https://chickpea.co/ (Desktop, version 2)",
      width: 1440,
      height: 8966,
    });
    // No React Flow viewport/measurement/selection serialization leaks in or
    // out: the adapter input is the domain record, nothing else.
    expect("positionAbsolute" in frame).toBe(false);
    expect("measured" in frame).toBe(false);
    expect("selected" in frame).toBe(false);
  });

  test("the parent precedes any future annotation children in the node array", () => {
    // pins/marks append after index 0 so parentId resolution always sees the
    // frame first; lock the ordering rule here.
    const nodes = nodesForCapture(domain);
    expect(nodes[0]!.type).toBe(CAPTURE_FRAME_TYPE);
  });

  test("rejects missing or non-finite document dimensions", () => {
    expect(() => nodesForCapture({ ...domain, width: 0 })).toThrow(RangeError);
    expect(() => nodesForCapture({ ...domain, height: Number.NaN })).toThrow(RangeError);
  });
});

describe("draft pin node", () => {
  const tip = { x: 812.25, y: 4231.5 };

  test("appends after the frame, parented to it, with a namespaced deterministic id", () => {
    const nodes = nodesForCapture(domain, [], tip, 1);
    expect(nodes).toHaveLength(2);
    const [frame, draft] = nodes;
    expect(frame!.type).toBe(CAPTURE_FRAME_TYPE);
    expect(draft!.type).toBe(DRAFT_PIN_TYPE);
    expect(draft!.parentId).toBe(captureFrameNodeId(domain.captureId));
    expect(draft!.id).toBe(draftPinNodeId(domain.captureId));
    expect(draft!.id).toBe("draft-pin:cap-root-desktop-v2");
    // The adapter id namespace can never collide with a server annotation id.
    expect(draft!.id.startsWith("draft-pin:")).toBe(true);
    // No parent extent on purpose: React Flow's extent clamp hides pointer
    // overshoot past the frame edge, which strands the re-derived tip one
    // grab offset inside the boundary. Clamping belongs to the pure adapter
    // alone (see draftPinNode's doc comment); the rendered box is always
    // inside the frame by construction.
    expect(draft!.extent).toBeUndefined();
  });

  test("the node box comes from the pure adapter and preserves the canonical tip", () => {
    for (const zoom of [0.01, 1, 8]) {
      const node = draftPinNode(domain, tip, zoom);
      const box = pinHitBox(tip, { width: domain.width, height: domain.height }, zoom);
      expect(node.position).toEqual({ x: box.x, y: box.y });
      expect(node.width).toBe(box.size);
      expect(node.height).toBe(box.size);
      expect(node.data.tipX).toBe(tip.x);
      expect(node.data.tipY).toBe(tip.y);
      // The rendered anchor, recovered from node geometry, is the exact tip.
      const anchor = tipFromPinBox({
        x: node.position.x,
        y: node.position.y,
        size: node.width!,
        tipOffsetX: node.data.tipOffsetX,
        tipOffsetY: node.data.tipOffsetY,
      });
      expect(anchor).toEqual(tip);
    }
  });

  test("the on-screen hit target meets the shared minimum at 1x and 8x", () => {
    for (const zoom of [1, 8]) {
      const node = draftPinNode(domain, tip, zoom);
      expect(node.width! * zoom).toBeGreaterThanOrEqual(MIN_HIT_TARGET_CSS_PX - 1e-9);
    }
  });

  test("is draggable but otherwise inert, and carries no React Flow runtime state", () => {
    const node = draftPinNode(domain, tip, 1);
    expect(node.draggable).toBe(true);
    expect(node.selectable).toBe(false);
    expect(node.connectable).toBe(false);
    expect(node.deletable).toBe(false);
    expect("positionAbsolute" in node).toBe(false);
    expect("measured" in node).toBe(false);
    expect("selected" in node).toBe(false);
  });

  test("is a domain-backed view: no draft at all without a tip", () => {
    expect(nodesForCapture(domain, [], null, 1)).toHaveLength(1);
    expect(nodesForCapture(domain)).toHaveLength(1);
  });

  test("rejects non-finite tips and zooms rather than rendering a corrupt draft", () => {
    expect(() => draftPinNode(domain, { x: Number.NaN, y: 1 }, 1)).toThrow(RangeError);
    expect(() => draftPinNode(domain, tip, 0)).toThrow(RangeError);
  });
});

describe("persisted pin nodes", () => {
  const pins: CanvasPin[] = [
    { id: "ann-uuid-b", number: 2, tip: { x: 40, y: 50 }, selected: false },
    { id: "ann-uuid-a", number: 1, tip: { x: 812.25, y: 4231.5 }, selected: false },
  ];

  test("follow the frame in stable number order, parented to it, with the draft last", () => {
    const nodes = nodesForCapture(domain, pins, { x: 9, y: 9 }, 1);
    expect(nodes.map((node) => node.type)).toEqual([
      CAPTURE_FRAME_TYPE,
      PIN_TYPE,
      PIN_TYPE,
      DRAFT_PIN_TYPE,
    ]);
    const [frame, first, second, draft] = nodes;
    // Number order is the canonical order regardless of input order.
    expect(first!.id).toBe("ann-uuid-a");
    expect(second!.id).toBe("ann-uuid-b");
    // The pin node id IS the server annotation id: the domain record is
    // canonical, and only adapter artifacts (frame, draft) are namespaced.
    expect(first!.parentId).toBe(captureFrameNodeId(domain.captureId));
    expect(second!.parentId).toBe(captureFrameNodeId(domain.captureId));
    expect(draft!.parentId).toBe(frame!.id);
  });

  test("the node box preserves the exact canonical tip at every zoom", () => {
    for (const zoom of [0.01, 1, 8]) {
      const node = pinNode(domain, pins[1]!, zoom);
      const anchor = tipFromPinBox({
        x: node.position.x,
        y: node.position.y,
        size: node.width!,
        tipOffsetX: node.data.tipOffsetX,
        tipOffsetY: node.data.tipOffsetY,
      });
      expect(anchor).toEqual(pins[1]!.tip);
    }
    // The on-screen hit target meets the shared minimum at working zooms; at
    // extreme overview zoom the document itself is the binding constraint
    // (the pure adapter's documented cap), not the badge.
    for (const zoom of [1, 8]) {
      const node = pinNode(domain, pins[1]!, zoom);
      expect(node.width! * zoom).toBeGreaterThanOrEqual(MIN_HIT_TARGET_CSS_PX - 1e-9);
    }
  });

  test("carry only domain facts: number, tip, selection flag, accessible label", () => {
    const node = pinNode(domain, { ...pins[1]!, selected: true }, 4);
    expect(node.data.annotationId).toBe("ann-uuid-a");
    expect(node.data.number).toBe(1);
    expect(node.data.selected).toBe(true);
    expect(node.data.label).toContain("Pin 1");
    expect(node.ariaLabel).toBe(node.data.label);
    expect(node.draggable).toBe(true);
    expect(node.selectable).toBe(false);
    expect(node.connectable).toBe(false);
    expect(node.deletable).toBe(false);
    // No raw React Flow runtime serialization enters or leaves the adapter.
    expect("positionAbsolute" in node).toBe(false);
    expect("measured" in node).toBe(false);
  });

  test("adapter and domain ids can never collide", () => {
    expect(pins.map((pin) => pin.id)).not.toContain(draftPinNodeId(domain.captureId));
    expect(pins.map((pin) => pin.id)).not.toContain(captureFrameNodeId(domain.captureId));
  });

  test("reject non-finite pins rather than rendering a corrupt mark", () => {
    expect(() => pinNode(domain, { ...pins[1]!, tip: { x: 1, y: Number.NaN } }, 1)).toThrow(
      RangeError,
    );
  });
});

describe("context preview node", () => {
  const rect = { x: 808.5, y: 4202.25, width: 216.75, height: 98.5 };
  const pins: CanvasPin[] = [
    { id: "ann-uuid-a", number: 1, tip: { x: 812.25, y: 4231.5 }, selected: false },
  ];

  test("renders the exact natural-pixel rectangle as a child of the frame", () => {
    const node = contextPreviewNode(domain, rect);
    expect(node).not.toBeNull();
    expect(node!.id).toBe(contextPreviewNodeId(domain.captureId));
    expect(node!.id).toBe("context-preview:cap-root-desktop-v2");
    expect(node!.type).toBe(CONTEXT_PREVIEW_TYPE);
    expect(node!.parentId).toBe(captureFrameNodeId(domain.captureId));
    // Position and size ARE the candidate's persisted natural-pixel rect —
    // no rounding, padding, or badge math on a measurement surface.
    expect(node!.position).toEqual({ x: rect.x, y: rect.y });
    expect(node!.width).toBe(rect.width);
    expect(node!.height).toBe(rect.height);
    expect(node!.data.rectX).toBe(rect.x);
    expect(node!.data.rectY).toBe(rect.y);
    expect(node!.data.rectWidth).toBe(rect.width);
    expect(node!.data.rectHeight).toBe(rect.height);
  });

  test("is fully inert: no drag, selection, connection, deletion, or pointer events", () => {
    const node = contextPreviewNode(domain, rect)!;
    expect(node.draggable).toBe(false);
    expect(node.selectable).toBe(false);
    expect(node.connectable).toBe(false);
    expect(node.deletable).toBe(false);
    expect(node.focusable).toBe(false);
    // React Flow 12.11 ignores Node.pointerEvents and derives the wrapper's
    // pointer-events from interactivity (the canvas's onNodeClick would make
    // it "all"); node.style spreads after that derivation, so the inline
    // style is the load-bearing pointer-transparency.
    expect(node.style).toEqual({ pointerEvents: "none" });
    // No raw React Flow runtime serialization enters or leaves the adapter.
    expect("positionAbsolute" in node).toBe(false);
    expect("measured" in node).toBe(false);
    expect("selected" in node).toBe(false);
  });

  test("sits right after the frame so pins and the draft stack above it", () => {
    const nodes = nodesForCapture(domain, pins, { x: 9, y: 9 }, 1, rect);
    expect(nodes.map((node) => node.type)).toEqual([
      CAPTURE_FRAME_TYPE,
      CONTEXT_PREVIEW_TYPE,
      PIN_TYPE,
      DRAFT_PIN_TYPE,
    ]);
  });

  test("is absent without a preview rect, and never confused with a domain record", () => {
    expect(nodesForCapture(domain, pins, null, 1, null).map((node) => node.type)).toEqual([
      CAPTURE_FRAME_TYPE,
      PIN_TYPE,
    ]);
    // The namespaced adapter id can never collide with an annotation id.
    expect(pins.map((pin) => pin.id)).not.toContain(contextPreviewNodeId(domain.captureId));
  });

  test("zero-area, negative, and non-finite rectangles produce no node", () => {
    expect(contextPreviewNode(domain, { ...rect, width: 0 })).toBeNull();
    expect(contextPreviewNode(domain, { ...rect, height: -4 })).toBeNull();
    expect(contextPreviewNode(domain, { ...rect, x: Number.NaN })).toBeNull();
    expect(contextPreviewNode(domain, { ...rect, y: Number.POSITIVE_INFINITY })).toBeNull();
    // The array builder skips a corrupt preview rather than corrupting the plane.
    expect(
      nodesForCapture(domain, [], null, 1, { x: 0, y: 0, width: 0, height: 10 }),
    ).toHaveLength(1);
  });
});

describe("rectangle nodes (D079)", () => {
  const rectangle: CanvasRectangle = {
    id: "ann-uuid-box",
    number: 2,
    rect: { x: 100.5, y: 200.25, width: 300, height: 150.75 },
    selected: false,
  };
  const pins: CanvasPin[] = [
    { id: "ann-uuid-a", number: 1, tip: { x: 812.25, y: 4231.5 }, selected: false },
    { id: "ann-uuid-c", number: 3, tip: { x: 40, y: 50 }, selected: false },
  ];

  test("position and size are exactly the persisted natural-pixel box, parented to the frame", () => {
    for (const zoom of [0.01, 1, 8]) {
      const node = rectangleNode(domain, rectangle, zoom);
      expect(node.type).toBe(RECTANGLE_TYPE);
      expect(node.id).toBe("ann-uuid-box");
      expect(node.parentId).toBe(captureFrameNodeId(domain.captureId));
      expect(node.position).toEqual({ x: 100.5, y: 200.25 });
      expect(node.width).toBe(300);
      expect(node.height).toBe(150.75);
      expect(node.data.rectX).toBe(100.5);
      expect(node.data.rectWidth).toBe(300);
      // The chrome scales inversely with the zoom so it stays screen-sized.
      expect(node.data.strokeWidth * zoom).toBeCloseTo(2, 9);
      expect(node.data.handleSize * zoom).toBeGreaterThanOrEqual(MIN_HIT_TARGET_CSS_PX - 1e-9);
    }
  });

  test("is draggable with handles on an editable plane, neither on a read-only one", () => {
    const editable = rectangleNode(domain, rectangle, 1);
    expect(editable.draggable).toBe(true);
    expect(editable.data.handles).toBe(true);
    expect(editable.selectable).toBe(false);
    expect(editable.connectable).toBe(false);
    expect(editable.deletable).toBe(false);
    expect(editable.extent).toBeUndefined();
    // The wrapper lets the pointer through; the stroke and badge opt back in.
    expect(editable.style).toEqual({ pointerEvents: "none" });
    const readOnly = rectangleNode(domain, rectangle, 1, { readOnly: true });
    expect(readOnly.draggable).toBe(false);
    expect(readOnly.data.handles).toBe(false);
    expect("positionAbsolute" in editable).toBe(false);
    expect("measured" in editable).toBe(false);
  });

  test("the draft rectangle is namespaced, draggable, and loses its handles while being drawn", () => {
    const rect = { x: 10, y: 20, width: 30, height: 40 };
    const draft = draftRectangleNode(domain, rect, 2);
    expect(draft.type).toBe(DRAFT_RECTANGLE_TYPE);
    expect(draft.id).toBe(draftRectangleNodeId(domain.captureId));
    expect(draft.id).toBe("draft-rectangle:cap-root-desktop-v2");
    expect(draft.position).toEqual({ x: 10, y: 20 });
    expect(draft.width).toBe(30);
    expect(draft.height).toBe(40);
    expect(draft.draggable).toBe(true);
    expect(draft.data.handles).toBe(true);
    expect(draft.data.number).toBeNull();
    const drawing = draftRectangleNode(domain, rect, 2, { drawing: true });
    expect(drawing.draggable).toBe(false);
    expect(drawing.data.handles).toBe(false);
    expect(drawing.data.drawing).toBe(true);
  });

  test("nodesForPlane interleaves pins and rectangles in one number order, draft last", () => {
    const nodes = nodesForPlane(domain, {
      pins,
      rectangles: [rectangle],
      draft: { kind: "rectangle", rect: { x: 0, y: 0, width: 8, height: 8 } },
      zoom: 1,
    });
    expect(nodes.map((node) => node.type)).toEqual([
      CAPTURE_FRAME_TYPE,
      PIN_TYPE,
      RECTANGLE_TYPE,
      PIN_TYPE,
      DRAFT_RECTANGLE_TYPE,
    ]);
    expect(nodes.map((node) => node.id).slice(1, 4)).toEqual([
      "ann-uuid-a",
      "ann-uuid-box",
      "ann-uuid-c",
    ]);
    // A pin draft still renders last, and the pin-only builder is unchanged.
    const pinDraft = nodesForPlane(domain, { pins, draft: { kind: "pin", tip: { x: 1, y: 1 } } });
    expect(pinDraft.at(-1)!.type).toBe(DRAFT_PIN_TYPE);
    expect(nodesForCapture(domain, pins, { x: 1, y: 1 }, 1).map((node) => node.type)).toEqual(
      pinDraft.map((node) => node.type),
    );
  });

  test("rejects non-finite or negative boxes and bad zooms rather than rendering a corrupt mark", () => {
    expect(() =>
      rectangleNode(domain, { ...rectangle, rect: { ...rectangle.rect, width: -1 } }, 1),
    ).toThrow(RangeError);
    expect(() =>
      draftRectangleNode(domain, { x: Number.NaN, y: 0, width: 10, height: 10 }, 1),
    ).toThrow(RangeError);
    expect(() => rectangleNode(domain, rectangle, 0)).toThrow(RangeError);
  });
});
