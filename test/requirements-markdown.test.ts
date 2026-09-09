// Safety and fidelity contract for the zero-dependency Markdown renderer that
// backs /reqs/*. Raw HTML is disabled: every text node is escaped, link
// targets are allow-listed, and heading anchors are made unique.
import { describe, expect, test } from "vitest";
import { renderMarkdown } from "../src/lib/markdown";

describe("renderMarkdown safe rendering", () => {
  test("escapes raw HTML instead of rendering it", () => {
    const { html } = renderMarkdown(
      '# Title\n\n<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>',
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  test("drops javascript:, data:, and vbscript: link targets but keeps the text", () => {
    const { html } = renderMarkdown(
      "[a](javascript:alert(1)) [b](data:text/html;base64,PGI+) [c](vbscript:x)",
    );
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toMatch(/href="data:/i);
    expect(html).not.toMatch(/href="vbscript:/i);
    expect(html).toContain(">a<");
    expect(html).toContain(">b<");
    expect(html).toContain(">c<");
  });

  test("defeats case and whitespace scheme smuggling", () => {
    const { html } = renderMarkdown(
      "[a](JaVaScRiPt:alert(1)) [b](java\tscript:alert(1)) [c]( //evil.example/x)",
    );
    expect(html).not.toMatch(/href=/);
    expect(html).toContain(">a<");
  });

  test("renders empty and malformed link targets as inert text", () => {
    const { html } = renderMarkdown("[empty]() and [blank](  )");
    expect(html).not.toMatch(/href=/);
    expect(html).toContain(">empty<");
    expect(html).toContain(">blank<");
  });

  test("allows https, http, root-relative, relative, and anchor links", () => {
    const { html } = renderMarkdown(
      "[ext](https://example.com/p) [ext2](http://example.org) [hub](/reqs) [rel](./MORE.md) [up](../UP.md) [sec](#setup)",
    );
    for (const href of [
      "https://example.com/p",
      "http://example.org",
      "/reqs",
      "./MORE.md",
      "../UP.md",
      "#setup",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  test("external links open without a referrer and visibly name their host", () => {
    const { html } = renderMarkdown("[Chickpea](https://chickpea.co/pricing)");
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/rel="[^"]*noreferrer[^"]*"/);
    expect(html).toMatch(/rel="[^"]*noopener[^"]*"/);
    expect(html).toContain("chickpea.co");
  });

  test("internal and anchor links get no external treatment", () => {
    const { html } = renderMarkdown("[hub](/reqs) and [sec](#setup)");
    expect(html).toContain('<a href="/reqs">hub</a>');
    expect(html).toContain('<a href="#setup">sec</a>');
  });

  test("colliding heading anchors are made unique in order", () => {
    const { html, headings } = renderMarkdown("# Setup\n\n## Setup\n\n## Setup");
    expect(headings.map((h) => h.id)).toEqual(["setup", "setup-2", "setup-3"]);
    expect(html).toContain('<h1 id="setup">');
    expect(html).toContain('<h2 id="setup-2">');
    expect(html).toContain('<h2 id="setup-3">');
  });

  test("heading text is stripped of markup for the anchor but rendered inline", () => {
    const { headings } = renderMarkdown("## The `npm run validate` gate");
    expect(headings[0].id).toBe("the-npm-run-validate-gate");
  });
});

describe("renderMarkdown structure and order", () => {
  test("preserves block order across headings, paragraphs, lists, tables, and code", () => {
    const doc = [
      "# Alpha",
      "",
      "First paragraph.",
      "",
      "- one",
      "- two",
      "",
      "| Col | Val |",
      "| --- | --- |",
      "| a | 1 |",
      "",
      "```",
      "const x = 1 < 2;",
      "```",
      "",
      "## Beta",
      "",
      "Last paragraph.",
    ].join("\n");
    const { html } = renderMarkdown(doc);
    const order = [
      html.indexOf('id="alpha"'),
      html.indexOf("First paragraph."),
      html.indexOf("<li>one</li>"),
      html.indexOf("<table>"),
      html.indexOf("const x = 1 &lt; 2;"),
      html.indexOf('id="beta"'),
      html.indexOf("Last paragraph."),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order]).toEqual([...order].sort((a, b) => a - b));
  });

  test("renders tables with thead and tbody cells escaped", () => {
    const { html } = renderMarkdown(
      "| Name | Note |\n| --- | --- |\n| **pin** | <b>bold</b> |",
    );
    expect(html).toContain("<thead>");
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<strong>pin</strong>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  test("renders ordered and unordered lists", () => {
    const { html } = renderMarkdown("- a\n- b\n\n1. first\n2. second");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>second</li>");
  });

  test("wraps multi-line unordered items into a single li", () => {
    const { html } = renderMarkdown(
      "- first line of the item\n  continues on a second line\n- next item",
    );
    expect((html.match(/<ul>/g) ?? []).length).toBe(1);
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
    expect(html).toContain(
      "<li>first line of the item continues on a second line</li>",
    );
    expect(html).toContain("<li>next item</li>");
    expect(html).not.toContain("<p>");
  });

  test("wraps multi-line ordered items into one ol with one li per item", () => {
    const { html } = renderMarkdown(
      "1. Alpha starts here\n   and keeps going.\n2. Beta.\n3. Gamma wraps\n   onto a second line.",
    );
    expect((html.match(/<ol>/g) ?? []).length).toBe(1);
    expect((html.match(/<li>/g) ?? []).length).toBe(3);
    expect(html).toContain("<li>Alpha starts here and keeps going.</li>");
    expect(html).toContain("<li>Gamma wraps onto a second line.</li>");
    expect(html).not.toContain("<p>");
  });

  test("continuation absorption stops at blank lines and block starts", () => {
    const { html } = renderMarkdown(
      "- item\nnot a marker, absorbed\n\nafter the list\n\n- second list\n# heading",
    );
    expect((html.match(/<ul>/g) ?? []).length).toBe(2);
    expect(html).toContain("<li>item not a marker, absorbed</li>");
    expect(html).toContain("<p>after the list</p>");
    expect(html).toContain("<li>second list</li>");
    expect(html).toContain('<h1 id="heading">heading</h1>');
  });

  test("escapes fenced code block contents", () => {
    const { html } = renderMarkdown('```html\n<div onclick="x()">hi</div>\n```');
    expect(html).toContain("<code>");
    expect(html).toContain("&lt;div onclick=&quot;x()&quot;&gt;");
    expect(html).not.toContain("<div");
  });

  // VAL-REQS-006: horizontally scrollable regions must be keyboard-focusable
  // with an accessible name (axe scrollable-region-focusable, WCAG 2.1.1).
  test("fenced code blocks render a focusable, named scroll region", () => {
    const { html } = renderMarkdown("```\nconst x = 1;\n```");
    expect(html).toContain("<pre tabindex=\"0\"");
    expect(html).toMatch(/<pre[^>]*role="group"/);
    expect(html).toMatch(/<pre[^>]*aria-label="[^"]+"/);
  });

  test("wide tables render inside a focusable, named scroll region", () => {
    const { html } = renderMarkdown(
      "| A | B |\n| --- | --- |\n| 1 | 2 |",
    );
    expect(html).toContain('class="table-scroll"');
    expect(html).toContain('tabindex="0"');
    expect(html).toMatch(/<div[^>]*class="table-scroll"[^>]*role="group"/);
    expect(html).toMatch(/<div[^>]*class="table-scroll"[^>]*aria-label="[^"]+"/);
  });

  test("renders inline code, strong, and emphasis with escaping", () => {
    const { html } = renderMarkdown(
      "Use `npm run validate` for **one** *gate* <tag>",
    );
    expect(html).toContain("<code>npm run validate</code>");
    expect(html).toContain("<strong>one</strong>");
    expect(html).toContain("<em>gate</em>");
    expect(html).toContain("&lt;tag&gt;");
  });

  test("renders blockquotes with escaped content", () => {
    const { html } = renderMarkdown("> pin + annotate + at **ya**");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<strong>ya</strong>");
  });
});
