// The project-wide pin order and the stepping through it (D077): pages in
// submitted order, Desktop before Mobile, older versions before newer, pins
// by number inside a plane; Next and Previous cross planes and wrap only at
// the ends of the project.

import { describe, expect, test } from "vitest";
import type { ProjectPinAnnotationView } from "../src/lib/annotations";
import {
  orderProjectPins,
  planeOrder,
  preferredVariant,
  stepProjectPin,
} from "../src/lib/pin-order";

const project = {
  pages: [
    {
      id: "page-root",
      devices: [
        { variant: "desktop", attempts: [{ id: "root-d2", attempt: 2 }, { id: "root-d1", attempt: 1 }], usable: true },
        { variant: "mobile", attempts: [{ id: "root-m1", attempt: 1 }], usable: true },
      ],
    },
    {
      id: "page-pricing",
      devices: [
        { variant: "desktop", attempts: [{ id: "pricing-d1", attempt: 1 }], usable: false },
        { variant: "mobile", attempts: [{ id: "pricing-m1", attempt: 1 }], usable: true },
      ],
    },
  ],
};

function pin(id: string, captureId: string, number: number): ProjectPinAnnotationView {
  return {
    id,
    captureId,
    kind: "pin",
    number,
    tip: { x: 0, y: 0 },
    body: id,
    elementSnapshot: null,
    revision: 1,
    status: "open",
    unreadReplies: 0,
    createdAt: 0,
    pageId: captureId.startsWith("root") ? "page-root" : "page-pricing",
    normalizedUrl: captureId.startsWith("root") ? "https://chickpea.co/" : "https://chickpea.co/pricing",
    variant: captureId.includes("-d") ? "desktop" : "mobile",
    attempt: Number(captureId.slice(-1)),
  };
}

const planes = planeOrder(project);

describe("planeOrder", () => {
  test("lists pages in order, Desktop then Mobile, older versions first", () => {
    expect(planes).toEqual(["root-d1", "root-d2", "root-m1", "pricing-d1", "pricing-m1"]);
  });
});

describe("orderProjectPins", () => {
  test("sorts by plane, then by number, and leaves the input untouched", () => {
    const input = [
      pin("pm2", "pricing-m1", 2),
      pin("rm1", "root-m1", 1),
      pin("rd2", "root-d2", 1),
      pin("pm1", "pricing-m1", 1),
      pin("rd1b", "root-d1", 2),
      pin("rd1a", "root-d1", 1),
    ];
    const ordered = orderProjectPins(input, planes);
    expect(ordered.map((entry) => entry.id)).toEqual(["rd1a", "rd1b", "rd2", "rm1", "pm1", "pm2"]);
    expect(input[0]!.id).toBe("pm2");
  });

  test("a pin on a capture the project no longer lists sorts last", () => {
    const ordered = orderProjectPins([pin("x", "gone", 1), pin("r", "root-m1", 9)], planes);
    expect(ordered.map((entry) => entry.id)).toEqual(["r", "x"]);
  });
});

describe("stepProjectPin", () => {
  const ordered = orderProjectPins(
    [
      pin("rd1a", "root-d1", 1),
      pin("rd1b", "root-d1", 2),
      pin("rm1", "root-m1", 1),
      pin("pm1", "pricing-m1", 1),
    ],
    planes,
  );

  test("steps to the next pin on the same plane, then onto the next plane", () => {
    const from = { captureId: "root-d1", pinId: "rd1a" };
    expect(stepProjectPin(ordered, planes, from, 1)?.id).toBe("rd1b");
    expect(stepProjectPin(ordered, planes, { ...from, pinId: "rd1b" }, 1)?.id).toBe("rm1");
    expect(stepProjectPin(ordered, planes, { captureId: "root-m1", pinId: "rm1" }, -1)?.id).toBe(
      "rd1b",
    );
  });

  test("wraps only at the project's ends", () => {
    expect(stepProjectPin(ordered, planes, { captureId: "pricing-m1", pinId: "pm1" }, 1)?.id).toBe(
      "rd1a",
    );
    expect(stepProjectPin(ordered, planes, { captureId: "root-d1", pinId: "rd1a" }, -1)?.id).toBe(
      "pm1",
    );
  });

  test("with nothing selected, Next starts on the open plane and Previous ends on it", () => {
    expect(stepProjectPin(ordered, planes, { captureId: "root-d1", pinId: null }, 1)?.id).toBe(
      "rd1a",
    );
    expect(stepProjectPin(ordered, planes, { captureId: "root-d1", pinId: null }, -1)?.id).toBe(
      "rd1b",
    );
    // An open plane with no pins: Next moves on to the next plane that has
    // one, Previous back to the last plane before it that has one.
    expect(stepProjectPin(ordered, planes, { captureId: "root-d2", pinId: null }, 1)?.id).toBe(
      "rm1",
    );
    expect(stepProjectPin(ordered, planes, { captureId: "pricing-d1", pinId: null }, -1)?.id).toBe(
      "rm1",
    );
    // On the last plane, Next still starts with that plane's own first pin.
    expect(stepProjectPin(ordered, planes, { captureId: "pricing-m1", pinId: null }, 1)?.id).toBe(
      "pm1",
    );
    expect(stepProjectPin(ordered, planes, { captureId: null, pinId: null }, 1)?.id).toBe("rd1a");
    expect(stepProjectPin(ordered, planes, { captureId: null, pinId: null }, -1)?.id).toBe("pm1");
  });

  test("a project with no pins steps nowhere", () => {
    expect(stepProjectPin([], planes, { captureId: "root-d1", pinId: null }, 1)).toBeNull();
  });

  test("a selected pin the list no longer holds is treated as no selection", () => {
    expect(stepProjectPin(ordered, planes, { captureId: "root-m1", pinId: "deleted" }, 1)?.id).toBe(
      "rm1",
    );
  });
});

describe("preferredVariant", () => {
  test("Desktop when it is usable, Mobile when only Mobile is, the first device otherwise", () => {
    expect(preferredVariant(project.pages[0]!)).toBe("desktop");
    expect(preferredVariant(project.pages[1]!)).toBe("mobile");
    expect(
      preferredVariant({
        id: "p",
        devices: [
          { variant: "desktop", attempts: [], usable: false },
          { variant: "mobile", attempts: [], usable: false },
        ],
      }),
    ).toBe("desktop");
    expect(preferredVariant({ id: "p", devices: [] })).toBeNull();
  });
});

// Rectangles (D079) sit in the same per-capture sequence as pins, so the
// project order and the stepping treat them by number like any other mark.
describe("boxes in the order and the stepping (D079)", () => {
  function box(id: string, captureId: string, number: number): ProjectPinAnnotationView {
    const base = pin(id, captureId, number);
    if (base.kind !== "pin") throw new Error("the pin fixture makes pins");
    const { tip: _tip, kind: _kind, ...rest } = base;
    return { ...rest, kind: "rectangle", rect: { x: 10, y: 20, width: 30, height: 40 } };
  }

  test("a box takes its place by number among the pins of its plane and across planes", () => {
    const ordered = orderProjectPins(
      [
        pin("rd1-3", "root-d1", 3),
        box("rd1-2", "root-d1", 2),
        pin("rd1-1", "root-d1", 1),
        box("rm1-1", "root-m1", 1),
      ],
      planes,
    );
    expect(ordered.map((mark) => mark.id)).toEqual(["rd1-1", "rd1-2", "rd1-3", "rm1-1"]);
    expect(stepProjectPin(ordered, planes, { captureId: "root-d1", pinId: "rd1-1" }, 1)?.id).toBe(
      "rd1-2",
    );
    expect(stepProjectPin(ordered, planes, { captureId: "root-d1", pinId: "rd1-2" }, 1)?.id).toBe(
      "rd1-3",
    );
    expect(stepProjectPin(ordered, planes, { captureId: "root-d1", pinId: "rd1-3" }, 1)?.id).toBe(
      "rm1-1",
    );
    expect(stepProjectPin(ordered, planes, { captureId: "root-m1", pinId: "rm1-1" }, 1)?.id).toBe(
      "rd1-1",
    );
    expect(stepProjectPin(ordered, planes, { captureId: "root-m1", pinId: null }, -1)?.id).toBe(
      "rm1-1",
    );
  });
});
