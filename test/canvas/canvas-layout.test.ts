// Structural guards for the canvas workspace layout (VAL-CANVAS-002).
//
// The canvas replaces the old natural-size scroll region (user-testing
// rounds 1–2: a 1440px-wide capture overflowed the stage and could not be
// scrolled into view). Pan/zoom inside a bounded React Flow frame is the
// mechanism now, so these tests lock the properties that mechanism needs:
// the canvas column can shrink below the capture's intrinsic width, the
// canvas frame is bounded in both dimensions, and the selection/metadata
// panel is screen-fixed (sticky) rather than part of the transformed
// canvas.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

/** The declarations block of a standalone single-selector rule (line-anchored
    so `.capture-stage` never matches `.workspace-body > .capture-stage`). */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`rule ${selector} not found in app/globals.css`);
  return match[1];
}

describe("canvas frame bounds", () => {
  test("the canvas is bounded in both dimensions so the page never scrolls for it", () => {
    const block = rule(".capture-canvas");
    expect(block).toMatch(/height:\s*min\(76vh/);
    expect(block).toMatch(/min-height:/);
    expect(block).toMatch(/overflow:\s*hidden/);
  });

  test("the React Flow root is explicitly sized — it ships no sizing of its own", () => {
    // React Flow 12's stylesheet sets only variables on .react-flow; without
    // this rule the pane is 0×0 and the camera transform never applies.
    const sized = css.match(/\.capture-canvas\s+\.react-flow\s*\{([^}]*)\}/);
    if (!sized) throw new Error("rule .capture-canvas .react-flow not found");
    expect(sized[1]).toMatch(/width:\s*100%/);
    expect(sized[1]).toMatch(/height:\s*100%/);
  });

  test("the canvas column can shrink below the capture's intrinsic width", () => {
    // minmax(0, 1fr) on the grid track plus min-width 0 on the flex item:
    // without both, a natural-size capture pins the layout to its intrinsic
    // width and pushes the document horizontally (the round-2 bug).
    expect(rule(".workspace")).toMatch(
      /grid-template-columns:\s*minmax\(16rem,\s*22rem\)\s*minmax\(0,\s*1fr\)/,
    );
    expect(rule(".workspace-detail")).toMatch(/min-width:\s*0/);
    const column = css.match(/\.workspace-body\s*>\s*\.capture-stage\s*\{([^}]*)\}/);
    if (!column) throw new Error("rule .workspace-body > .capture-stage not found");
    expect(column[1]).toMatch(/min-width:\s*0/);
  });

  test("the narrow single-column layout is shrinkable too", () => {
    const narrow = css.match(
      /@media\s*\(max-width:\s*48rem\)\s*\{\s*\.workspace\s*\{([^}]*)\}/,
    );
    if (!narrow) throw new Error("narrow .workspace media rule not found");
    expect(narrow[1]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  test("the editor shell is wide, not the landing reading column", () => {
    // Without this the workspace inherits the 46rem reading column and the
    // canvas collapses to a few pixels next to the sidebar and panel. Since
    // the split (D069) the workspace has its own route and its own shell,
    // so the width is unconditional rather than a :has() override.
    const wide = css.match(/\.pins-main\s*\{([^}]*)\}/);
    if (!wide) throw new Error(".pins-main shell rule not found");
    expect(wide[1]).toMatch(/max-width:\s*min\(/);
  });
});

describe("screen-fixed panel", () => {
  test("the selection/metadata panel is sticky layout chrome, not canvas content", () => {
    const block = rule(".workspace-panel");
    expect(block).toMatch(/position:\s*sticky/);
    expect(block).toMatch(/top:/);
  });

  test("the panel stacks statically on narrow layouts", () => {
    const narrow = css.match(
      /@media\s*\(max-width:\s*64rem\)\s*\{[^]*?\.workspace-panel\s*\{([^}]*)\}/,
    );
    if (!narrow) throw new Error("narrow .workspace-panel media rule not found");
    expect(narrow[1]).toMatch(/position:\s*static/);
  });
});

describe("camera controls", () => {
  test("the pressed named mode is visibly distinct", () => {
    const pressed = css.match(/\.capture-camera\s+button\[aria-pressed="true"\]\s*\{([^}]*)\}/);
    if (!pressed) throw new Error("pressed camera-mode rule not found");
    expect(pressed[1]).toMatch(/border-color:\s*var\(--accent\)/);
  });

  test("the named non-ready state placeholder still exists", () => {
    expect(rule(".capture-stage")).toMatch(/border:/);
  });
});
