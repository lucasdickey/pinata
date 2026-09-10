// Domain → React Flow adaptation for the screenshot plane (VAL-CANVAS-001,
// VAL-CANVAS-002). The canonical record is the capture DTO; the React Flow
// node is a throwaway view of it. These tests pin the contract: one fixed,
// unselectable parent at exactly the persisted document dimensions, first in
// every node array, carrying no React Flow runtime state back into the
// domain.

import { describe, expect, test } from "vitest";
import {
  CAPTURE_FRAME_TYPE,
  captureFrameNodeId,
  nodesForCapture,
  type CaptureFrameDomain,
} from "../../src/lib/canvas/flow-model";

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
