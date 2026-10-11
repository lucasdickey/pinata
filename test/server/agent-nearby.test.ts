// Nearby elements for the agent brief (D136): the manifest elements around a
// mark, ranked as the composer ranks them, minus the mark's own elements and
// anything with nothing to read, capped.

import { describe, expect, test } from "vitest";
import {
  AGENT_BRIEF_NEARBY_MAX,
  nearbyElementsForMark,
} from "../../src/lib/server/agent/nearby";
import type { ContextElement } from "../../src/lib/server/annotations/context";

function element(overrides: Partial<ContextElement> = {}): ContextElement {
  return {
    id: "e1",
    kind: "text",
    tag: "p",
    role: "",
    text: "Some copy",
    accessibleName: "",
    hints: { id: "", classes: [], alt: "", title: "", testId: "" },
    path: ["body:0", "main:0", "p:0"],
    rect: { x: 100, y: 100, width: 200, height: 40 },
    ...overrides,
  };
}

const heading = element({
  id: "heading",
  kind: "heading",
  tag: "h2",
  text: "Pricing",
  rect: { x: 100, y: 1000, width: 400, height: 48 },
});
const copy = element({
  id: "copy",
  text: "Three plans, one price each.",
  rect: { x: 100, y: 1060, width: 400, height: 60 },
});
const button = element({
  id: "button",
  kind: "control",
  tag: "button",
  text: "Start free",
  rect: { x: 100, y: 1140, width: 160, height: 44 },
});
const wrapper = element({
  id: "wrapper",
  kind: "landmark",
  tag: "section",
  text: "",
  rect: { x: 0, y: 900, width: 1440, height: 600 },
});
const footer = element({
  id: "footer",
  text: "© Pinata",
  rect: { x: 100, y: 9000, width: 400, height: 30 },
});

const manifest = [footer, wrapper, button, copy, heading];

describe("nearbyElementsForMark", () => {
  test("a pin's neighbours are the nearest readable elements, not the one it is attached to", () => {
    const near = nearbyElementsForMark(manifest, {
      kind: "pin",
      tip: { x: 120, y: 1020 },
      elementSnapshot: heading,
    });
    expect(near.map((e) => e.id)).toEqual(["copy", "button", "footer"]);
  });

  test("an element with no text, name, or alt is left out", () => {
    const near = nearbyElementsForMark(manifest, {
      kind: "pin",
      tip: { x: 120, y: 1020 },
      elementSnapshot: null,
    });
    expect(near.map((e) => e.id)).not.toContain("wrapper");
    expect(near[0]?.id).toBe("heading");
  });

  test("an image with alt text counts as readable", () => {
    const image = element({
      id: "image",
      kind: "image",
      tag: "img",
      text: "",
      hints: { id: "", classes: [], alt: "A piñata", title: "", testId: "" },
      rect: { x: 600, y: 1000, width: 300, height: 200 },
    });
    const near = nearbyElementsForMark([image, wrapper], {
      kind: "pin",
      tip: { x: 650, y: 1050 },
      elementSnapshot: null,
    });
    expect(near.map((e) => e.id)).toEqual(["image"]);
  });

  test("a box's neighbours leave out every element it is attached to (D125)", () => {
    const near = nearbyElementsForMark(manifest, {
      kind: "rectangle",
      rect: { x: 90, y: 990, width: 420, height: 140 },
      elementSnapshot: heading,
      alsoElements: [copy],
    });
    expect(near.map((e) => e.id)).toEqual(["button", "footer"]);
  });

  test("an arrow ranks from its head", () => {
    const near = nearbyElementsForMark(manifest, {
      kind: "arrow",
      arrow: { start: { x: 120, y: 9010 }, end: { x: 120, y: 1150 } },
      elementSnapshot: null,
    });
    expect(near[0]?.id).toBe("button");
  });

  test("a circle ranks by overlap with its bounding square", () => {
    const near = nearbyElementsForMark(manifest, {
      kind: "circle",
      circle: { x: 80, y: 1120, size: 80 },
      elementSnapshot: null,
    });
    expect(near[0]?.id).toBe("button");
  });

  test("is capped and keeps ranking order", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      element({
        id: `t${i}`,
        text: `Line ${i}`,
        rect: { x: 100, y: 100 + i * 50, width: 200, height: 40 },
      }),
    );
    const near = nearbyElementsForMark(many, {
      kind: "pin",
      tip: { x: 110, y: 110 },
      elementSnapshot: null,
    });
    expect(near).toHaveLength(AGENT_BRIEF_NEARBY_MAX);
    expect(near.map((e) => e.id)).toEqual(["t0", "t1", "t2", "t3"]);
    expect(nearbyElementsForMark(many, { kind: "pin", tip: { x: 110, y: 110 }, elementSnapshot: null }, 2)).toHaveLength(2);
  });

  test("an empty manifest yields nothing", () => {
    expect(
      nearbyElementsForMark([], { kind: "pin", tip: { x: 1, y: 1 }, elementSnapshot: null }),
    ).toEqual([]);
  });
});
