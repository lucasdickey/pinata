// User-testing round 2 (2026-09-10): in natural-size mode a wide Desktop
// capture (1440 CSS px) overflowed the stage to the right and neither the
// region nor the page scrolled horizontally, so the capture was unviewable.
// Root cause: flex/grid items default to min-width auto, so the scroll
// container and its ancestors refused to shrink below the image's intrinsic
// width and overflow:auto never engaged. These structural guards lock the
// fix: the natural-size scroll region stays bounded in BOTH width and
// height so it pans the unscaled image on both axes, and the document never
// overflows horizontally. Fit view is unaffected (the image is contained,
// nothing scrolls).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

/** The declarations block of a simple single-selector rule. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`rule ${selector} not found in app/globals.css`);
  return match[1];
}

describe("capture stage natural-size scroll bounds", () => {
  test("the scroll region scrolls on both axes and is bounded in both dimensions", () => {
    const block = rule(".capture-stage-scroll");
    expect(block).toMatch(/overflow:\s*auto/);
    // Bounded in height …
    expect(block).toMatch(/max-height:/);
    // … and in width: as a flex item it must be allowed to shrink below the
    // image's intrinsic width, otherwise it overflows instead of scrolling.
    expect(block).toMatch(/min-width:\s*0/);
  });

  test("the workspace detail column can shrink below the capture's intrinsic width", () => {
    // minmax(0, 1fr): a bare 1fr track is minmax(auto, 1fr), which pins the
    // track to the natural-size image's max-content width and pushes the
    // document horizontally.
    expect(rule(".workspace")).toMatch(
      /grid-template-columns:\s*minmax\(16rem,\s*22rem\)\s*minmax\(0,\s*1fr\)/,
    );
    // The grid item itself must also be allowed to shrink below its content.
    expect(rule(".workspace-detail")).toMatch(/min-width:\s*0/);
  });

  test("the narrow single-column layout is shrinkable too", () => {
    const narrow = css.match(
      /@media\s*\(max-width:\s*48rem\)\s*\{\s*\.workspace\s*\{([^}]*)\}/,
    );
    if (!narrow) throw new Error("narrow .workspace media rule not found");
    expect(narrow[1]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  test("fit view still constrains the image instead of scrolling", () => {
    const block = rule(".capture-stage-fit .capture-stage-image");
    expect(block).toMatch(/max-width:\s*100%/);
    expect(block).toMatch(/max-height:/);
  });
});
