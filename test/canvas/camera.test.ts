// Pure camera math for the capture canvas (VAL-CANVAS-002): the three named
// modes — entire capture (the initial contain view), fit width, and natural
// size — plus the flow/screen inverse transforms used to measure rendered
// anchors. These functions are the independent oracle for the browser
// measurements; nothing here reads the DOM or React Flow state.

import { describe, expect, test } from "vitest";
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_PADDING_PX,
  centerCamera,
  clampCanvasZoom,
  containCamera,
  flowToScreen,
  naturalCamera,
  screenToFlow,
  widthFitCamera,
  type CanvasCamera,
} from "../../src/lib/canvas/camera";
import { MAX_DOCUMENT_HEIGHT_PX } from "../../src/lib/boundaries";

/** Every corner of the document lands inside the viewport. */
function cornersVisible(camera: CanvasCamera, doc: { width: number; height: number }, viewport: { width: number; height: number }) {
  const points = [
    { x: 0, y: 0 },
    { x: doc.width, y: 0 },
    { x: 0, y: doc.height },
    { x: doc.width, y: doc.height },
  ].map((p) => flowToScreen(p, camera));
  for (const p of points) {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(viewport.width);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(viewport.height);
  }
}

describe("containCamera (the initial entire-capture view)", () => {
  test("a tall desktop capture fits entirely, centered, with margin", () => {
    const viewport = { width: 1280, height: 720 };
    const doc = { width: 1440, height: 8966 };
    const camera = containCamera(viewport, doc);
    // Height is the binding dimension.
    expect(camera.zoom).toBeCloseTo((viewport.height - 2 * CANVAS_PADDING_PX) / doc.height, 10);
    cornersVisible(camera, doc, viewport);
    // Centered on the axis with slack.
    const topLeft = flowToScreen({ x: 0, y: 0 }, camera);
    expect(topLeft.x).toBeCloseTo((viewport.width - doc.width * camera.zoom) / 2, 10);
    expect(topLeft.y).toBeGreaterThanOrEqual(CANVAS_PADDING_PX - 1e-9);
  });

  test("a narrow tall mobile capture fits height and centers horizontally", () => {
    const viewport = { width: 1000, height: 700 };
    const doc = { width: 390, height: 13_091 };
    const camera = containCamera(viewport, doc);
    cornersVisible(camera, doc, viewport);
    const topLeft = flowToScreen({ x: 0, y: 0 }, camera);
    expect(topLeft.x).toBeGreaterThan(viewport.width / 4);
  });

  test("the tallest published document still fits a minimum-height stage", () => {
    const viewport = { width: 800, height: 384 };
    const doc = { width: 1440, height: MAX_DOCUMENT_HEIGHT_PX };
    const camera = containCamera(viewport, doc);
    expect(camera.zoom).toBeGreaterThanOrEqual(CANVAS_MIN_ZOOM);
    cornersVisible(camera, doc, viewport);
  });

  test("a tiny capture zooms in only up to the published maximum", () => {
    const camera = containCamera({ width: 1280, height: 720 }, { width: 64, height: 40 });
    expect(camera.zoom).toBe(CANVAS_MAX_ZOOM);
    cornersVisible(camera, { width: 64, height: 40 }, { width: 1280, height: 720 });
  });

  test("fractional viewport sizes stay exact", () => {
    const viewport = { width: 1023.5, height: 701.25 };
    const doc = { width: 1440, height: 8966 };
    const camera = containCamera(viewport, doc);
    cornersVisible(camera, doc, viewport);
  });
});

describe("widthFitCamera", () => {
  test("the capture width fills the viewport and the top stays visible", () => {
    const viewport = { width: 1280, height: 720 };
    const doc = { width: 1440, height: 8966 };
    const camera = widthFitCamera(viewport, doc);
    expect(camera.zoom).toBeCloseTo((viewport.width - 2 * CANVAS_PADDING_PX) / doc.width, 10);
    const topLeft = flowToScreen({ x: 0, y: 0 }, camera);
    expect(topLeft.y).toBe(CANVAS_PADDING_PX);
    // Left and right edges are inside or exactly at the padded bounds.
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(flowToScreen({ x: doc.width, y: 0 }, camera).x).toBeLessThanOrEqual(viewport.width);
  });

  test("a narrow mobile capture zooms in and centers", () => {
    const viewport = { width: 1280, height: 720 };
    const doc = { width: 390, height: 13_091 };
    const camera = widthFitCamera(viewport, doc);
    expect(camera.zoom).toBeCloseTo((viewport.width - 2 * CANVAS_PADDING_PX) / 390, 10);
    const topLeft = flowToScreen({ x: 0, y: 0 }, camera);
    expect(topLeft.x).toBeCloseTo((viewport.width - doc.width * camera.zoom) / 2, 10);
    expect(topLeft.y).toBe(CANVAS_PADDING_PX);
  });

  test("a very narrow document clamps at the maximum zoom", () => {
    const camera = widthFitCamera({ width: 1280, height: 720 }, { width: 64, height: 8966 });
    expect(camera.zoom).toBe(CANVAS_MAX_ZOOM);
  });
});

describe("naturalCamera", () => {
  test("renders at exactly 1:1 with the top edge visible", () => {
    const camera = naturalCamera({ width: 1280, height: 720 }, { width: 1440, height: 8966 });
    expect(camera.zoom).toBe(1);
    const topLeft = flowToScreen({ x: 0, y: 0 }, camera);
    expect(topLeft.y).toBe(CANVAS_PADDING_PX);
  });

  test("a capture wider than the viewport anchors left; a narrower one centers", () => {
    const wide = naturalCamera({ width: 1000, height: 700 }, { width: 1440, height: 8966 });
    expect(flowToScreen({ x: 0, y: 0 }, wide).x).toBe(CANVAS_PADDING_PX);
    const narrow = naturalCamera({ width: 1280, height: 700 }, { width: 390, height: 13_091 });
    expect(flowToScreen({ x: 0, y: 0 }, narrow).x).toBeCloseTo((1280 - 390) / 2, 10);
  });
});

describe("zoom bounds", () => {
  test("clampCanvasZoom enforces the published range inclusively", () => {
    expect(clampCanvasZoom(0)).toBe(CANVAS_MIN_ZOOM);
    expect(clampCanvasZoom(100)).toBe(CANVAS_MAX_ZOOM);
    expect(clampCanvasZoom(1)).toBe(1);
    expect(clampCanvasZoom(CANVAS_MIN_ZOOM)).toBe(CANVAS_MIN_ZOOM);
    expect(clampCanvasZoom(CANVAS_MAX_ZOOM)).toBe(CANVAS_MAX_ZOOM);
  });

  test("the maximum supports at least 8x deep zoom", () => {
    expect(CANVAS_MAX_ZOOM).toBeGreaterThanOrEqual(8);
  });
});

describe("invalid input", () => {
  test.each([
    [{ width: 0, height: 720 }, { width: 1440, height: 8966 }],
    [{ width: 1280, height: -1 }, { width: 1440, height: 8966 }],
    [{ width: Number.NaN, height: 720 }, { width: 1440, height: 8966 }],
    [{ width: 1280, height: 720 }, { width: 0, height: 8966 }],
    [{ width: 1280, height: 720 }, { width: Number.POSITIVE_INFINITY, height: 8966 }],
    [{ width: 1280, height: 720 }, { width: 1440, height: Number.NaN }],
  ])("rejects non-positive or non-finite dimensions %#", (viewport, doc) => {
    expect(() => containCamera(viewport, doc)).toThrow(RangeError);
    expect(() => widthFitCamera(viewport, doc)).toThrow(RangeError);
    expect(() => naturalCamera(viewport, doc)).toThrow(RangeError);
  });
});

describe("flow/screen inverse transforms", () => {
  test("round trips under arbitrary finite cameras, including fractional coordinates", () => {
    // Deterministic spread of cameras and points across the working ranges.
    const cameras: CanvasCamera[] = [
      { x: 0, y: 0, zoom: 1 },
      { x: -5120.375, y: -61_204.125, zoom: 8 },
      { x: 12, y: 12, zoom: CANVAS_MIN_ZOOM },
      { x: 401.0667, y: 12, zoom: 0.0776 },
      { x: -0.5, y: -0.25, zoom: 3.2187 },
    ];
    const points = [
      { x: 0, y: 0 },
      { x: 1439.5, y: 8965.75 },
      { x: 720, y: 4483 },
      { x: 0.125, y: 16_383.875 },
      { x: 390, y: 13_091 },
    ];
    for (const camera of cameras) {
      for (const point of points) {
        const roundTrip = screenToFlow(flowToScreen(point, camera), camera);
        // The contract tolerance is one natural pixel; the pure transform is
        // far tighter.
        expect(roundTrip.x).toBeCloseTo(point.x, 9);
        expect(roundTrip.y).toBeCloseTo(point.y, 9);
      }
    }
  });

  test("the initial contain camera inverse-maps the viewport center into the document", () => {
    const viewport = { width: 1280, height: 720 };
    const doc = { width: 1440, height: 8966 };
    const camera = containCamera(viewport, doc);
    const center = screenToFlow({ x: viewport.width / 2, y: viewport.height / 2 }, camera);
    expect(center.x).toBeGreaterThan(0);
    expect(center.x).toBeLessThan(doc.width);
    expect(center.y).toBeGreaterThan(0);
    expect(center.y).toBeLessThan(doc.height);
  });
});

// Bringing a chosen mark into view (D078): the point lands in the middle of
// the viewport and the zoom is kept, within the published range.
describe("centerCamera", () => {
  test("puts the point at the viewport center at the given zoom", () => {
    const viewport = { width: 800, height: 600 };
    for (const zoom of [0.25, 1, 4]) {
      const camera = centerCamera(viewport, { x: 720, y: 4000 }, zoom);
      expect(camera.zoom).toBe(zoom);
      const screen = flowToScreen({ x: 720, y: 4000 }, camera);
      expect(screen.x).toBeCloseTo(400, 9);
      expect(screen.y).toBeCloseTo(300, 9);
    }
  });

  test("clamps the zoom to the published range and rejects a bad point or viewport", () => {
    expect(centerCamera({ width: 800, height: 600 }, { x: 0, y: 0 }, 99).zoom).toBe(CANVAS_MAX_ZOOM);
    expect(centerCamera({ width: 800, height: 600 }, { x: 0, y: 0 }, 0.0001).zoom).toBe(
      CANVAS_MIN_ZOOM,
    );
    expect(() => centerCamera({ width: 800, height: 600 }, { x: Number.NaN, y: 0 }, 1)).toThrow(
      RangeError,
    );
    expect(() => centerCamera({ width: 0, height: 600 }, { x: 0, y: 0 }, 1)).toThrow(RangeError);
  });
});
