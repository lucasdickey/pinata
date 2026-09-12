// The Markdown a capture's pins are copied as (D071). The point of the
// export is that an agentic IDE can act on it without seeing the screenshot,
// so these tests pin down the two things that make that possible: every pin
// carries its captured element context, and the comment body survives
// verbatim.

import { describe, expect, test } from "vitest";
import type { PinAnnotationView, PinElementSnapshot } from "../src/lib/annotations";
import {
  formatPinsAsMarkdown,
  pinPosition,
  snapshotPath,
  snapshotSummary,
} from "../src/lib/pin-export";

const element: PinElementSnapshot = {
  id: "el-1",
  kind: "button",
  tag: "button",
  role: "switch",
  text: "Annual (save 20%)",
  accessibleName: "Annual (save 20%)",
  hints: { id: "", classes: ["billing-toggle"], alt: "", title: "", testId: "" },
  path: ["main", "section.pricing", "div.billing-toggle"],
  rect: { x: 380, y: 372, width: 176.4, height: 44.2 },
};

function pin(overrides: Partial<PinAnnotationView> = {}): PinAnnotationView {
  return {
    id: "a1",
    captureId: "cap-1",
    kind: "pin",
    number: 1,
    tip: { x: 392.4, y: 386.6 },
    body: "This billing toggle reads the same in both states.",
    elementSnapshot: element,
    revision: 1,
    status: "open",
    unreadReplies: 0,
    createdAt: 0,
    ...overrides,
  };
}

const context = { pageUrl: "https://chickpea.co/pricing", variant: "Desktop", attempt: 2 };

describe("snapshot helpers", () => {
  test("the path is one readable trail, and blank steps are dropped", () => {
    expect(snapshotPath(element)).toBe("main > section.pricing > div.billing-toggle");
    expect(snapshotPath({ ...element, path: ["main", "  ", "div"] })).toBe("main > div");
  });

  test("an explicit no-element decision has no path and says so", () => {
    expect(snapshotPath(null)).toBeNull();
    expect(snapshotSummary(null)).toBe("No element");
  });

  test("the summary carries tag, role, and text", () => {
    expect(snapshotSummary(element)).toBe('<button> role=switch “Annual (save 20%)”');
  });

  test("an element with no role or text degrades to the tag alone", () => {
    expect(snapshotSummary({ ...element, role: "", text: "", accessibleName: "" })).toBe(
      "<button>",
    );
  });

  test("positions are rounded natural pixels", () => {
    expect(pinPosition(pin())).toBe("392, 387");
  });
});

describe("formatPinsAsMarkdown", () => {
  test("heads the block with the page, device, version, and pin count", () => {
    const markdown = formatPinsAsMarkdown([pin()], context);
    expect(markdown).toContain("# Pinata pins — https://chickpea.co/pricing");
    expect(markdown).toContain("Desktop · version 2 · 1 pin");
  });

  test("an unknown attempt drops the version rather than printing null", () => {
    const markdown = formatPinsAsMarkdown([pin()], { ...context, attempt: null });
    expect(markdown).toContain("Desktop · 1 pin");
    expect(markdown).not.toContain("version");
  });

  test("every pin carries its number, position, element, path, and bounds", () => {
    const markdown = formatPinsAsMarkdown([pin()], context);
    expect(markdown).toContain("## Pin 1 — at (392, 387)");
    expect(markdown).toContain("- Element: <button> role=switch “Annual (save 20%)”");
    expect(markdown).toContain("- Path: `main > section.pricing > div.billing-toggle`");
    expect(markdown).toContain("- Bounds: 176 × 44 px natural");
  });

  test("every pin carries its lifecycle status (D075)", () => {
    expect(formatPinsAsMarkdown([pin()], context)).toContain("- Status: Open");
    expect(formatPinsAsMarkdown([pin({ status: "replied" })], context)).toContain(
      "- Status: Replied",
    );
    const resolved = formatPinsAsMarkdown([pin({ status: "resolved" })], context);
    expect(resolved).toContain("- Status: Resolved");
    // The status line sits between the heading and the element context.
    expect(resolved.indexOf("- Status:")).toBeLessThan(resolved.indexOf("- Element:"));
  });

  test("a no-element pin says so and emits no path or bounds line", () => {
    const markdown = formatPinsAsMarkdown([pin({ elementSnapshot: null })], context);
    expect(markdown).toContain("- Element: No element");
    expect(markdown).not.toContain("- Path:");
    expect(markdown).not.toContain("- Bounds:");
  });

  test("the comment is quoted verbatim, including its own line breaks", () => {
    // The body is the note the agent has to act on; escaping or re-wrapping
    // it would corrupt exactly the content that matters.
    const markdown = formatPinsAsMarkdown(
      [pin({ body: "Line one\nLine two `with code` and **stars**" })],
      context,
    );
    expect(markdown).toContain("> Line one\n> Line two `with code` and **stars**");
  });

  test("pins are emitted in the order given", () => {
    const markdown = formatPinsAsMarkdown(
      [pin(), pin({ id: "a2", number: 2, tip: { x: 10, y: 20 }, body: "Second." })],
      context,
    );
    expect(markdown.indexOf("## Pin 1")).toBeLessThan(markdown.indexOf("## Pin 2"));
    expect(markdown).toContain("2 pins");
  });

  test("an empty capture produces a readable block, not an empty string", () => {
    const markdown = formatPinsAsMarkdown([], context);
    expect(markdown).toContain("0 pins");
    expect(markdown).toContain("_No pins on this capture._");
  });

  test("the block never ends in blank lines", () => {
    expect(formatPinsAsMarkdown([pin()], context)).not.toMatch(/\n\s*$/);
  });
});
