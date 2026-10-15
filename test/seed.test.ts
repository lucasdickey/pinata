// @vitest-environment jsdom
// The demo seed (scripts/seed/) stays the landing's example (D140, D142):
// the same project, page, marks, notes, and founder replies as
// src/lib/example-capture.ts, so the filmed video, the still example, and
// the pin table under it all tell one story. The seed's page has every
// element its marks name, and the element lookup the replay uses picks the
// one under the mark.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EXAMPLE_CAPTURE } from "../src/lib/example-capture";
import { findElement, STAGES } from "../scripts/seed/apply.mjs";

interface SeedMark {
  key: string;
  page: string;
  variant: string;
  kind: string;
  tip?: { x: number; y: number };
  rect?: { x: number; y: number; width: number; height: number };
  circle?: { x: number; y: number; size: number };
  arrow?: { start: { x: number; y: number }; end: { x: number; y: number } };
  element: { tag: string; text: string };
  body: string;
  replies: { author: string; body: string }[];
}

const SEED_DIR = join(process.cwd(), "scripts", "seed");
const seed = JSON.parse(readFileSync(join(SEED_DIR, "chickpea.json"), "utf8")) as {
  project: { title: string };
  pages: { key: string; url: string; site: string; variants: string[] }[];
  marks: SeedMark[];
};

describe("the Chickpea seed", () => {
  test("is the landing's example: project, page, and each mark's kind, place, note, and replies", () => {
    expect(seed.project.title).toBe(EXAMPLE_CAPTURE.projectTitle);
    expect(seed.pages.map((page) => page.url)).toEqual([EXAMPLE_CAPTURE.pageUrl]);
    expect(seed.marks).toHaveLength(EXAMPLE_CAPTURE.marks.length);
    seed.marks.forEach((mark, index) => {
      const example = EXAMPLE_CAPTURE.marks[index]!;
      expect(mark.kind).toBe(example.kind);
      expect(mark.body).toBe(example.body);
      const geometry =
        example.kind === "pin"
          ? { tip: example.tip }
          : example.kind === "rectangle"
            ? { rect: example.rect }
            : example.kind === "circle"
              ? { circle: example.circle }
              : { arrow: example.arrow };
      expect(mark).toMatchObject(geometry);
      expect(mark.replies).toEqual(
        example.thread.filter((entry) => entry.author === "founder").map(({ author, body }) => ({ author, body })),
      );
    });
  });

  test("its page has every element the marks name", () => {
    const html = readFileSync(join(SEED_DIR, seed.pages[0]!.site), "utf8");
    const document = new DOMParser().parseFromString(html, "text/html");
    for (const mark of seed.marks) {
      const found = [...document.querySelectorAll(mark.element.tag)].some(
        (element) => element.textContent!.replace(/\s+/g, "") === mark.element.text.replace(/\s+/g, ""),
      );
      expect(found, `<${mark.element.tag}> “${mark.element.text}” is not on the page`).toBe(true);
    }
  });

  test("starts from a stage the replay knows", () => {
    expect(STAGES[0]).toBe("empty");
    expect(STAGES).toEqual(["empty", "captured", "marked", "shared", "replied", "handed-off"]);
  });
});

describe("finding a mark's element", () => {
  const element = (id: string, x: number, y: number) => ({
    id,
    kind: "link",
    tag: "a",
    role: "",
    text: "Start free",
    accessibleName: "",
    hints: { id: "", classes: [], alt: "", title: "", testId: "" },
    path: [],
    rect: { x, y, width: 300, height: 52 },
  });
  const manifest = { elements: [element("e10", 1200, 76), element("e21", 178, 770), element("e33", 958, 770)] };

  test("among elements with the same text, it picks the one under the mark", () => {
    const mark = {
      key: "pro-cta",
      kind: "rectangle",
      rect: { x: 944, y: 758, width: 332, height: 76 },
      element: { tag: "a", text: "Start free" },
    };
    expect(findElement(manifest, mark).id).toBe("e33");
  });

  test("a mark naming an element the capture lacks fails loudly", () => {
    const mark = { key: "missing", kind: "pin", tip: { x: 1, y: 1 }, element: { tag: "a", text: "Nope" } };
    expect(() => findElement(manifest, mark)).toThrow(/does not have/);
  });
});
