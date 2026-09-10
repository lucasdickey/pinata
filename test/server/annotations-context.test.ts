// Pure nearby-context ranking and snapshot derivation (VAL-PIN-003,
// VAL-PIN-008): the deterministic candidate order the draft panel offers —
// containment, distance, smaller relevant area, depth, semantic value, then
// the stable capture-local id tie-break — plus the rule that a persisted
// snapshot is exactly one element of the capture's own immutable manifest,
// never client-authored data.

import { describe, expect, test } from "vitest";
import { NEARBY_CANDIDATES_MAX } from "../../src/lib/boundaries";
import {
  deriveSnapshot,
  rankNearbyCandidates,
  type ContextElement,
} from "../../src/lib/server/annotations/context";

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

describe("rankNearbyCandidates", () => {
  test("a containing element outranks a nearer non-containing one", () => {
    const far = element({ id: "far", rect: { x: 500, y: 500, width: 30, height: 30 } });
    const container = element({ id: "box", rect: { x: 0, y: 0, width: 400, height: 400 } });
    const ranked = rankNearbyCandidates([far, container], { x: 50, y: 50 });
    expect(ranked.map((candidate) => candidate.id)).toEqual(["box", "far"]);
  });

  test("among containers the smaller relevant area wins", () => {
    const outer = element({ id: "outer", rect: { x: 0, y: 0, width: 800, height: 800 } });
    const inner = element({ id: "inner", rect: { x: 10, y: 10, width: 100, height: 100 } });
    const ranked = rankNearbyCandidates([outer, inner], { x: 50, y: 50 });
    expect(ranked.map((candidate) => candidate.id)).toEqual(["inner", "outer"]);
  });

  test("equal-area containers rank the deeper element first", () => {
    const shallow = element({
      id: "shallow",
      path: ["body:0", "p:0"],
      rect: { x: 0, y: 0, width: 100, height: 100 },
    });
    const deep = element({
      id: "deep",
      path: ["body:0", "main:0", "section:1", "p:0"],
      rect: { x: 0, y: 0, width: 100, height: 100 },
    });
    const ranked = rankNearbyCandidates([shallow, deep], { x: 50, y: 50 });
    expect(ranked.map((candidate) => candidate.id)).toEqual(["deep", "shallow"]);
  });

  test("equal geometry ranks the more semantic kind first", () => {
    const plain = element({ id: "plain", kind: "text" });
    const control = element({ id: "control", kind: "control", tag: "button" });
    const ranked = rankNearbyCandidates([plain, control], { x: 150, y: 110 });
    expect(ranked.map((candidate) => candidate.id)).toEqual(["control", "plain"]);
  });

  test("full ties break on the capture-local id, deterministically", () => {
    const b = element({ id: "e2" });
    const a = element({ id: "e10" });
    const c = element({ id: "e1" });
    const first = rankNearbyCandidates([b, a, c], { x: 150, y: 110 });
    const second = rankNearbyCandidates([c, b, a], { x: 150, y: 110 });
    // The tie-break is the capture-local id in plain lexicographic order.
    expect(first.map((candidate) => candidate.id)).toEqual(["e1", "e10", "e2"]);
    expect(second.map((candidate) => candidate.id)).toEqual(["e1", "e10", "e2"]);
  });

  test("non-containing elements rank by distance to the point", () => {
    const near = element({ id: "near", rect: { x: 300, y: 100, width: 20, height: 20 } });
    const far = element({ id: "far", rect: { x: 900, y: 100, width: 20, height: 20 } });
    const ranked = rankNearbyCandidates([far, near], { x: 50, y: 50 });
    expect(ranked.map((candidate) => candidate.id)).toEqual(["near", "far"]);
  });

  test("zero-area and non-finite rectangles are never candidates", () => {
    const zero = element({ id: "zero", rect: { x: 10, y: 10, width: 0, height: 0 } });
    const nan = element({ id: "nan", rect: { x: Number.NaN, y: 0, width: 10, height: 10 } });
    const real = element({ id: "real" });
    const ranked = rankNearbyCandidates([zero, nan, real], { x: 150, y: 110 });
    expect(ranked.map((candidate) => candidate.id)).toEqual(["real"]);
  });

  test("duplicate ids collapse to one candidate and the list is capped", () => {
    const many = Array.from({ length: NEARBY_CANDIDATES_MAX + 4 }, (_, index) =>
      element({ id: `e${index + 1}`, rect: { x: 0, y: index * 1000, width: 10, height: 10 } }),
    );
    many.push(element({ id: "e1", rect: { x: 0, y: 0, width: 10, height: 10 } }));
    const ranked = rankNearbyCandidates(many, { x: 5, y: 5 });
    expect(ranked).toHaveLength(NEARBY_CANDIDATES_MAX);
    expect(new Set(ranked.map((candidate) => candidate.id)).size).toBe(ranked.length);
  });

  test("a non-finite query point yields no candidates", () => {
    expect(
      rankNearbyCandidates([element()], { x: Number.POSITIVE_INFINITY, y: 0 }),
    ).toHaveLength(0);
  });
});

describe("deriveSnapshot", () => {
  test("returns the exact manifest element for a known id", () => {
    const target = element({ id: "cell-7", kind: "table-cell", tag: "td" });
    const snapshot = deriveSnapshot([element({ id: "other" }), target], "cell-7");
    expect(snapshot).toEqual(target);
    // The snapshot is a copy: mutating the manifest list must not move it.
    (target as { text: string }).text = "mutated";
    expect((snapshot as { text: string }).text).toBe("Some copy");
  });

  test("unknown ids and the explicit No element derive nothing", () => {
    const elements = [element()];
    expect(deriveSnapshot(elements, "nope")).toBeNull();
    expect(deriveSnapshot(elements, null)).toBeNull();
    expect(deriveSnapshot([], "e1")).toBeNull();
  });
});
