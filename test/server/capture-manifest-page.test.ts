// @vitest-environment jsdom
//
// The in-page manifest pass, executed as the exact source text Browserless
// runs, against a real DOM (VAL-CAPTURE-005, VAL-CAPTURE-006).
//
// Grep tests can prove the source never *mentions* `document.cookie`. Only
// running it can prove that a collapsed mobile menu, a closed `<details>`, a
// clipped drawer, and a `display:none` sentinel inside a visible paragraph all
// stay out of the manifest while their visible siblings stay in — and that a
// page full of hostile strings and impossible rectangles produces bounded
// inert data rather than an escape.
//
// jsdom has no layout engine, so rectangles are declared per element with
// `data-rect="x y w h"` and served by a stubbed `getBoundingClientRect`.
// Everything else — the cascade, `details.open`, shadow roots, `:scope`
// selectors — is jsdom's own behaviour.

import { beforeEach, describe, expect, test } from "vitest";
import {
  MANIFEST_ACCESSIBLE_NAME_MAX_CHARS,
  MANIFEST_ELEMENT_KEYS,
  MANIFEST_ELEMENT_KINDS,
  MANIFEST_HINT_KEYS,
  MANIFEST_HINT_MAX_CHARS,
  MANIFEST_MAX_CLASSES,
  MANIFEST_PATH_MAX_DEPTH,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_TEXT_MAX_CHARS,
  MAX_MANIFEST_BYTES,
  MAX_MANIFEST_ELEMENTS,
} from "../../src/lib/boundaries";
import { captureFunctionLimits } from "../../src/lib/server/captures/execute";
import { MANIFEST_INSPECT_SOURCE } from "../../src/lib/server/captures/manifest-source";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ManifestElement {
  id: string;
  kind: string;
  tag: string;
  role: string;
  text: string;
  accessibleName: string;
  hints: { id: string; classes: string[]; alt: string; title: string; testId: string };
  path: string[];
  rect: Rect;
}

interface Inspection {
  viewport: Record<string, unknown>;
  document: { width: number; height: number; title: string; scrollX: number; scrollY: number };
  manifest: { schemaVersion: number; truncated: boolean; elements: ManifestElement[] };
}

const LAYOUT_NONCE = "layout_0badc0de0badc0de";

// The exact text the provider executes, evaluated here as a function.
const inspect = new Function(`return (${MANIFEST_INSPECT_SOURCE});`)() as (
  context: unknown,
) => Inspection;

/** A generously sized default so only declared rects clip or vanish. */
const DEFAULT_RECT: Rect = { x: 0, y: 0, width: 1440, height: 9000 };

function declaredRect(element: Element): Rect {
  const raw = element.getAttribute("data-rect");
  if (!raw) return DEFAULT_RECT;
  const parts = raw.trim().split(/\s+/).map(Number);
  return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! };
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  // jsdom implements no media queries; the inspection only reports them.
  window.matchMedia = ((query: string) => ({ matches: false, media: query })) as never;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const rect = declaredRect(this);
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => rect,
    } as DOMRect;
  };
});

function run(): Inspection {
  return inspect({ layoutNonce: LAYOUT_NONCE, limits: captureFunctionLimits() });
}

/** Append the capture's own nonce overlay the way stabilization does. */
function addNonceOverlay(): void {
  const overlay = document.createElement("div");
  overlay.setAttribute("data-pinata-capture", "overlay");
  const nonce = document.createElement("div");
  nonce.setAttribute("data-pinata-capture", "nonce");
  nonce.setAttribute("data-rect", "0 0 148 20");
  nonce.textContent = LAYOUT_NONCE;
  overlay.append(nonce);
  document.body.append(overlay);
}

const json = (inspection: Inspection): string => JSON.stringify(inspection.manifest);
const texts = (inspection: Inspection): string =>
  inspection.manifest.elements.map((e) => `${e.text} ${e.accessibleName}`).join("\n");
const byHintId = (inspection: Inspection, id: string): ManifestElement | undefined =>
  inspection.manifest.elements.find((e) => e.hints.id === id);

describe("visible semantic elements", () => {
  test("are described with the exact key set, bounded fields, and document-space rects", () => {
    document.body.innerHTML = `
      <main data-rect="0 0 1440 600">
        <h1 id="title" class="hero big" data-rect="24 40 800 48">Pinata pricing</h1>
        <p id="lede" data-rect="24 100 800 60">Directional feedback on public pages.</p>
        <a id="cta" href="https://example.com/secret-path?token=SENTINEL-HREF"
           data-rect="24 180 200 40">See the docs at example.com/docs</a>
        <img id="shot" alt="A captured page" src="https://cdn.example/SENTINEL-SRC.png"
             srcset="https://cdn.example/SENTINEL-SRCSET.png 2x" data-rect="24 240 320 200" />
      </main>`;
    const inspection = run();
    const heading = byHintId(inspection, "title")!;

    expect(Object.keys(heading)).toEqual([...MANIFEST_ELEMENT_KEYS]);
    expect(Object.keys(heading.hints)).toEqual([...MANIFEST_HINT_KEYS]);
    expect(MANIFEST_ELEMENT_KINDS).toContain(heading.kind);
    expect(heading).toMatchObject({
      kind: "heading",
      tag: "h1",
      text: "Pinata pricing",
      rect: { x: 24, y: 40, width: 800, height: 48 },
    });
    expect(heading.hints.classes).toEqual(["hero", "big"]);
    expect(heading.path).toEqual(["html:1", "body:1", "main:1", "h1:1"]);

    // Visible URL *text* is kept; the URL-bearing attributes are not read.
    expect(byHintId(inspection, "cta")!.text).toBe("See the docs at example.com/docs");
    expect(byHintId(inspection, "shot")!.accessibleName).toBe("A captured page");
    for (const sentinel of ["SENTINEL-HREF", "SENTINEL-SRC", "SENTINEL-SRCSET", "secret-path"]) {
      expect(json(inspection), sentinel).not.toContain(sentinel);
    }
  });

  test("the manifest is versioned, uniquely identified, and JSON round-trips", () => {
    document.body.innerHTML = `
      <h1 data-rect="0 0 400 40">One</h1><p data-rect="0 40 400 40">Two</p>`;
    addNonceOverlay();
    const inspection = run();
    expect(inspection.manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    const ids = inspection.manifest.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.parse(json(inspection))).toEqual(inspection.manifest);
  });
});

describe("effectively invisible content is absent", () => {
  test.each([
    ["display-none", `<p id="s" style="display:none" data-rect="0 0 300 20">SENTINEL</p>`],
    ["visibility-hidden", `<p id="s" style="visibility:hidden" data-rect="0 0 300 20">SENTINEL</p>`],
    ["opacity-zero", `<div style="opacity:0"><p id="s" data-rect="0 0 300 20">SENTINEL</p></div>`],
    ["hidden-attribute", `<p id="s" hidden data-rect="0 0 300 20">SENTINEL</p>`],
    ["aria-hidden-ancestor", `<div aria-hidden="true"><p id="s" data-rect="0 0 300 20">SENTINEL</p></div>`],
    ["inert-ancestor", `<div inert><p id="s" data-rect="0 0 300 20">SENTINEL</p></div>`],
    ["zero-area", `<p id="s" data-rect="10 10 0 0">SENTINEL</p>`],
    ["sub-pixel-area", `<p id="s" data-rect="10 10 0.4 0.4">SENTINEL</p>`],
    [
      "clipped-by-collapsed-ancestor",
      `<nav style="overflow:hidden" data-rect="0 0 390 0">
         <a id="s" href="#x" data-rect="0 0 390 44">SENTINEL</a>
       </nav>`,
    ],
    [
      "clipped-outside-scroll-container",
      `<div style="overflow:hidden" data-rect="0 0 390 200">
         <p id="s" data-rect="0 600 390 40">SENTINEL</p>
       </div>`,
    ],
    ["off-canvas-drawer", `<aside data-rect="-390 0 390 800"><a id="s" href="#x" data-rect="-390 0 390 44">SENTINEL</a></aside>`],
    ["closed-dialog", `<dialog data-rect="0 0 300 200"><p id="s" data-rect="0 0 300 40">SENTINEL</p></dialog>`],
    ["clip-path-inset", `<p id="s" style="clip-path: inset(50%)" data-rect="0 0 300 20">SENTINEL</p>`],
    // The legacy `clip: rect(0 0 0 0)` pattern is covered by the real-browser
    // fixture instead: jsdom computes `clip` as "auto" even when set inline.
  ])("%s", (_label, markup) => {
    document.body.innerHTML = `${markup}<p id="visible" data-rect="0 900 300 20">Sibling stays</p>`;
    const inspection = run();
    expect(json(inspection)).not.toContain("SENTINEL");
    expect(byHintId(inspection, "s")).toBeUndefined();
    expect(byHintId(inspection, "visible")!.text).toBe("Sibling stays");
  });

  test("a closed details keeps its summary and drops its panel", () => {
    document.body.innerHTML = `
      <details id="menu" data-rect="0 0 390 44">
        <summary id="menu-button" data-rect="0 0 390 44">Menu</summary>
        <nav id="menu-panel" data-rect="0 44 390 400">
          <a id="menu-link" href="#a" data-rect="0 44 390 44">SENTINEL-CLOSED-MENU</a>
        </nav>
      </details>`;
    const closed = run();
    expect(json(closed)).not.toContain("SENTINEL-CLOSED-MENU");
    expect(byHintId(closed, "menu-button")!.text).toBe("Menu");
    expect(byHintId(closed, "menu-panel")).toBeUndefined();
    // The details element itself is a visible candidate, and its own text
    // must not smuggle the closed panel's contents out.
    expect(byHintId(closed, "menu")!.text).toBe("Menu");

    document.querySelector<HTMLDetailsElement>("#menu")!.open = true;
    const open = run();
    expect(byHintId(open, "menu-link")!.text).toBe("SENTINEL-CLOSED-MENU");
  });

  test("hidden descendant text never rides out inside a visible parent", () => {
    document.body.innerHTML = `
      <p id="para" data-rect="0 0 600 40">
        Visible copy
        <span style="display:none">SENTINEL-HIDDEN-TEXT</span>
        <span class="sr-only" data-rect="0 0 0 0">SENTINEL-SR-ONLY</span>
        <span hidden>SENTINEL-HIDDEN-ATTR</span>
        <span data-rect="0 0 80 20">and more</span>
      </p>`;
    const inspection = run();
    expect(byHintId(inspection, "para")!.text).toBe("Visible copy and more");
    expect(json(inspection)).not.toContain("SENTINEL");
  });
});

describe("sensitive sources are never read", () => {
  test("scripts, styles, templates, frames, shadow roots, and form values stay out", () => {
    document.cookie = "session=SENTINEL-COOKIE";
    // Storage is unavailable on jsdom's opaque origin in some run modes; the
    // assertion is that the source never reads it, not that it exists.
    try {
      window.localStorage?.setItem?.("k", "SENTINEL-LOCALSTORAGE");
      window.sessionStorage?.setItem?.("k", "SENTINEL-SESSIONSTORAGE");
    } catch {
      /* opaque origin */
    }
    document.title = "Fixture title";
    document.body.innerHTML = `
      <main data-rect="0 0 1440 800">
        <h1 data-rect="0 0 400 40">Visible heading</h1>
        <script>const leak = "SENTINEL-SCRIPT";</script>
        <style>.x::after { content: "SENTINEL-STYLE"; }</style>
        <template><p>SENTINEL-TEMPLATE</p></template>
        <noscript><p>SENTINEL-NOSCRIPT</p></noscript>
        <iframe data-rect="0 100 400 300" title="SENTINEL-IFRAME-TITLE"></iframe>
        <form id="signup" action="https://example.com/SENTINEL-ACTION" data-rect="0 400 400 200">
          <input id="email" name="email" value="SENTINEL-FORM-VALUE"
                 placeholder="SENTINEL-PLACEHOLDER" data-rect="0 400 300 40" />
          <button id="go" formaction="https://example.com/SENTINEL-FORMACTION"
                  data-secret="SENTINEL-DATA-ATTRIBUTE" data-rect="0 450 120 40">Sign up</button>
        </form>
        <div id="host" data-rect="0 700 400 40"></div>
      </main>`;
    document
      .querySelector("#host")!
      .attachShadow({ mode: "open" }).innerHTML = `<p>SENTINEL-SHADOW-ROOT</p>`;

    const inspection = run();
    const serialized = json(inspection);
    for (const sentinel of [
      "SENTINEL-COOKIE",
      "SENTINEL-LOCALSTORAGE",
      "SENTINEL-SESSIONSTORAGE",
      "SENTINEL-SCRIPT",
      "SENTINEL-STYLE",
      "SENTINEL-TEMPLATE",
      "SENTINEL-NOSCRIPT",
      "SENTINEL-IFRAME-TITLE",
      "SENTINEL-ACTION",
      "SENTINEL-FORM-VALUE",
      "SENTINEL-PLACEHOLDER",
      "SENTINEL-FORMACTION",
      "SENTINEL-DATA-ATTRIBUTE",
      "SENTINEL-SHADOW-ROOT",
    ]) {
      expect(serialized, sentinel).not.toContain(sentinel);
    }
    // The visible semantic siblings survive all of that.
    expect(texts(inspection)).toContain("Visible heading");
    expect(byHintId(inspection, "go")!.text).toBe("Sign up");
    expect(byHintId(inspection, "email")!.kind).toBe("control");
    // The page title is kept as bounded inert text on the document, not markup.
    expect(inspection.document.title).toBe("Fixture title");
    expect(serialized).not.toContain("<");
  });
});

describe("hostile values cannot escape their boundaries", () => {
  const CONTROLS = "a\u0000b\u0007c\u001bd\u007fe\u0085f";
  const BIDI = "start\u202egnirts desrever\u202c\u2066iso\u2069\u200b\u200e\ufeff end";
  const SEPARATORS = "line\u2028para\u2029done";
  const ZALGO = `z${"\u0301".repeat(200)}algo`;

  beforeEach(() => {
    document.body.innerHTML = `
      <main data-rect="0 0 1440 400">
        <h1 id="controls" title="${CONTROLS}" data-rect="0 0 600 40">${CONTROLS}</h1>
        <p id="bidi" data-rect="0 40 600 40">${BIDI}</p>
        <p id="separators" data-rect="0 80 600 40">${SEPARATORS}</p>
        <p id="zalgo" data-rect="0 120 600 40">${ZALGO}</p>
        <p id="markup" data-rect="0 160 600 40">&lt;script&gt;alert(1)&lt;/script&gt; &amp; "quotes"</p>
        <p id="long" class="${"c".repeat(400)} ${Array.from({ length: 40 }, (_, i) => `k${i}`).join(" ")}"
           data-rect="0 200 600 40">${"L".repeat(5000)}</p>
        <p id="emoji" data-rect="0 240 600 40">${"👩‍👩‍👧‍👦🎉".repeat(200)}</p>
      </main>`;
  });

  test("control, bidi, separator, and invisible characters are stripped", () => {
    const inspection = run();
    const serialized = json(inspection);
    expect(serialized).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/);
    expect(serialized).not.toMatch(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/);
    expect(serialized).not.toMatch(/[\u2028\u2029]/);
    // Escaped forms must not appear either: the characters are gone, not encoded.
    expect(serialized).not.toContain("\\u2028");
    expect(serialized).not.toContain("\\u202e");
    expect(byHintId(inspection, "controls")!.text).toBe("abcdef");
    expect(byHintId(inspection, "separators")!.text).toBe("lineparadone");
  });

  test("stacked combining marks are capped and surrogate pairs are never split", () => {
    const inspection = run();
    const zalgo = byHintId(inspection, "zalgo")!.text;
    expect(zalgo.startsWith("z")).toBe(true);
    expect(zalgo.match(/\u0301/g)!.length).toBeLessThanOrEqual(8);
    expect(zalgo.endsWith("algo")).toBe(true);

    const emoji = byHintId(inspection, "emoji")!.text;
    expect(emoji.length).toBeLessThanOrEqual(MANIFEST_TEXT_MAX_CHARS);
    // A split pair would leave a lone surrogate, which cannot survive UTF-8.
    expect(Buffer.from(emoji, "utf8").toString("utf8")).toBe(emoji);
    expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(emoji).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });

  test("every bounded field respects its published cap", () => {
    const inspection = run();
    for (const element of inspection.manifest.elements) {
      expect(element.text.length).toBeLessThanOrEqual(MANIFEST_TEXT_MAX_CHARS);
      expect(element.accessibleName.length).toBeLessThanOrEqual(
        MANIFEST_ACCESSIBLE_NAME_MAX_CHARS,
      );
      expect(element.hints.classes.length).toBeLessThanOrEqual(MANIFEST_MAX_CLASSES);
      for (const value of element.hints.classes) {
        expect(value.length).toBeLessThanOrEqual(MANIFEST_HINT_MAX_CHARS);
      }
      expect(element.path.length).toBeLessThanOrEqual(MANIFEST_PATH_MAX_DEPTH);
      for (const segment of element.path) expect(segment).toMatch(/^[a-z][a-z0-9-]*:\d+$/);
    }
  });

  test("markup-like text stays inert data rather than markup", () => {
    const inspection = run();
    const markup = byHintId(inspection, "markup")!;
    // The page rendered escaped entities, so the visible text is literal.
    expect(markup.text).toBe('<script>alert(1)</script> & "quotes"');
    expect(JSON.parse(json(inspection))).toEqual(inspection.manifest);
  });

  test("impossible rectangles drop their element and keep the rest", () => {
    document.body.innerHTML = `
      <p id="huge" data-rect="0 0 900000 40">SENTINEL-HUGE</p>
      <p id="infinite" data-rect="0 0 Infinity 40">SENTINEL-INFINITE</p>
      <p id="nan" data-rect="NaN 0 300 40">SENTINEL-NAN</p>
      <p id="fine" data-rect="0 200 300 40">Real content</p>`;
    const inspection = run();
    expect(json(inspection)).not.toContain("SENTINEL");
    expect(byHintId(inspection, "fine")!.rect).toEqual({ x: 0, y: 200, width: 300, height: 40 });
    for (const element of inspection.manifest.elements) {
      for (const value of Object.values(element.rect)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value)).toBeLessThanOrEqual(100_000);
      }
    }
  });

  test("rect coordinates keep the published precision", () => {
    document.body.innerHTML = `<p id="fractional" data-rect="10.123456 20.987654 300.5 40.25">x</p>`;
    const element = byHintId(run(), "fractional")!;
    expect(element.rect).toEqual({ x: 10.12, y: 20.99, width: 300.5, height: 40.25 });
  });
});

describe("bounded truncation keeps deterministic coverage", () => {
  // 60 px rows keep even a 1,600-row page inside the published rectangle
  // bound, so only the manifest caps — not the rect bound — do the dropping.
  function tallPage(count: number, textLength: number): void {
    const rows = Array.from(
      { length: count },
      (_, i) =>
        `<p id="row-${i}" data-rect="0 ${i * 60} 800 40">row-${i} ${"x".repeat(textLength)}</p>`,
    ).join("");
    document.body.innerHTML = `<main data-rect="0 0 1440 ${count * 60}">${rows}</main>`;
    addNonceOverlay();
  }

  const rowIndex = (element: ManifestElement): number =>
    Number(element.hints.id.replace("row-", ""));

  test("the element cap holds and top, middle, and bottom all survive", () => {
    const rows = 1_600;
    tallPage(rows, 4);
    const inspection = run();
    const elements = inspection.manifest.elements;

    expect(inspection.manifest.truncated).toBe(true);
    expect(elements.length).toBe(MAX_MANIFEST_ELEMENTS);
    expect(new Set(elements.map((e) => e.id)).size).toBe(elements.length);

    const indexes = elements.filter((e) => e.hints.id.startsWith("row-")).map(rowIndex);
    // The first sampled slot is the page's top landmark (main), so the first
    // kept row is near — not necessarily exactly — the top; the last row of
    // the page is always kept.
    expect(Math.min(...indexes)).toBeLessThanOrEqual(4);
    expect(Math.max(...indexes)).toBe(rows - 1);
    const third = rows / 3;
    for (const [label, band] of [
      ["top", indexes.filter((i) => i < third)],
      ["middle", indexes.filter((i) => i >= third && i < third * 2)],
      ["bottom", indexes.filter((i) => i >= third * 2)],
    ] as const) {
      expect(band.length, label).toBeGreaterThan(100);
    }
    // Rendered top to bottom, the kept rows are still in document order.
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  test("the byte cap holds, and the capture keeps a useful spread", () => {
    tallPage(900, MANIFEST_TEXT_MAX_CHARS);
    const inspection = run();
    const bytes = Buffer.byteLength(json(inspection), "utf8");

    expect(bytes).toBeLessThanOrEqual(MAX_MANIFEST_BYTES);
    expect(inspection.manifest.truncated).toBe(true);
    expect(inspection.manifest.elements.length).toBeGreaterThan(10);
    const indexes = inspection.manifest.elements
      .filter((e) => e.hints.id.startsWith("row-"))
      .map(rowIndex);
    expect(Math.min(...indexes)).toBeLessThanOrEqual(4);
    expect(Math.max(...indexes)).toBe(899);
  });

  test("the nonce overlay survives truncation and stays correlatable", () => {
    tallPage(1_600, 4);
    const inspection = run();
    const nonce = inspection.manifest.elements.find((e) => e.text === LAYOUT_NONCE)!;
    expect(nonce.id).toBe("nonce");
    expect(inspection.manifest.elements[0]).toBe(nonce);
    expect(nonce.rect).toEqual({ x: 0, y: 0, width: 148, height: 20 });
    // The overlay's own machinery is not otherwise described.
    expect(inspection.manifest.elements.filter((e) => e.text === LAYOUT_NONCE)).toHaveLength(1);
  });

  test("an untruncated page reports truncated false", () => {
    tallPage(10, 4);
    const inspection = run();
    expect(inspection.manifest.truncated).toBe(false);
    // 10 rows + the main landmark + the nonce overlay.
    expect(inspection.manifest.elements).toHaveLength(12);
  });

  test("two passes over the same DOM produce identical manifests", () => {
    tallPage(1_600, 4);
    expect(json(run())).toBe(json(run()));
  });
});
