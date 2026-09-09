// Route/source alignment for the requirements hub: the four Markdown sources
// exist and carry the mandated content, the route table maps one source per
// route, and the dogfood URL array is a single exported constant in the exact
// contract order. Duplicated literals between runtime code and tests are a
// defect, so these tests import the same constants the pages use.
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DECISIONS_SOURCE_PATH,
  DOGFOOD_URLS,
  REQUIREMENTS_NAV,
  REQUIREMENTS_SOURCES,
} from "../src/lib/requirements";
import { renderMarkdown } from "../src/lib/markdown";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("requirements source documents", () => {
  test("every mapped Markdown source exists and is non-empty", () => {
    expect(REQUIREMENTS_SOURCES.length).toBe(4);
    for (const source of REQUIREMENTS_SOURCES) {
      expect(existsSync(join(ROOT, source.sourcePath)), source.sourcePath).toBe(true);
      expect(read(source.sourcePath).trim().length).toBeGreaterThan(0);
    }
  });

  test("the decision source of truth is the shared JSON, not a copy", () => {
    expect(DECISIONS_SOURCE_PATH).toBe("docs/decisions/decisions.json");
    expect(existsSync(join(ROOT, DECISIONS_SOURCE_PATH))).toBe(true);
  });

  test("REQUIREMENTS.md tells the exact naming story", () => {
    const doc = read("docs/REQUIREMENTS.md");
    expect(doc).toContain("pin + annotate + at ya");
    expect(doc).toMatch(/annotation/);
  });

  test("REQUIREMENTS.md states scope and non-goals without promising edits or AI", () => {
    const doc = read("docs/REQUIREMENTS.md");
    expect(doc).toMatch(/non-goals/i);
    expect(doc).toMatch(/static/i);
    expect(doc).toMatch(/no crawling|never crawls|does not crawl/i);
    expect(doc).toMatch(/runtime AI/i);
    expect(doc).toMatch(/source edit|source-editing|editing tool/i);
  });

  test("REQUIREMENTS.md names the Chickpea target and its explicit URL array", () => {
    const doc = read("docs/REQUIREMENTS.md");
    for (const url of [
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
      "https://chickpea.co/privacy",
    ]) {
      expect(doc).toContain(url);
    }
  });

  test("REQUIREMENTS.md lists the dogfood URL array in the contract order", () => {
    const doc = read("docs/REQUIREMENTS.md");
    expect(DOGFOOD_URLS).toEqual([
      "/reqs",
      "/reqs/architecture",
      "/reqs/milestones",
      "/reqs/decisions",
      "/reqs/evals",
    ]);
    const positions = DOGFOOD_URLS.map((u) => doc.indexOf(u));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
  });

  test("every rendered source document has unique heading anchors", () => {
    for (const source of REQUIREMENTS_SOURCES) {
      const { headings } = renderMarkdown(read(source.sourcePath));
      const ids = headings.map((h) => h.id);
      expect(new Set(ids).size, source.sourcePath).toBe(ids.length);
    }
  });

  // Independent structural model of the real sources: every wrapped list
  // continuation must land inside its <li>, never in a stray <p>, and every
  // list group must render as exactly one <ul>/<ol>. This is the systemic
  // guard for the milestone-1 scrutiny defect (80 severed continuations)
  // that synthetic single-line fixtures could not catch.
  function expectedStructure(md: string) {
    const lines = md.replace(/\r\n/g, "\n").split("\n");
    const startsBlock = (l: string) =>
      /^```/.test(l) ||
      /^#{1,6}\s/.test(l) ||
      /^>\s?/.test(l) ||
      /^\s*[-*]\s+/.test(l) ||
      /^\s*\d+\.\s+/.test(l) ||
      /^\s*(-{3,}|\*{3,})\s*$/.test(l);
    const isTableSeparator = (l: string) =>
      /^\|?[\s:|-]*-[\s:|-]*$/.test(l.trim()) && l.includes("-");
    const counts = { p: 0, blockquote: 0, ul: 0, ol: 0, li: 0 };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        i++;
        continue;
      }
      if (/^```/.test(line)) {
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) i++;
        i++;
        continue;
      }
      if (/^#{1,6}\s/.test(line) || /^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        i++;
        continue;
      }
      if (/^>\s?/.test(line)) {
        counts.blockquote++;
        while (i < lines.length && /^>\s?/.test(lines[i])) i++;
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        i += 2;
        while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") i++;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        const marker = /^\s*\d+\.\s+/.test(line) ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
        if (marker.source.startsWith("^\\s*\\d")) counts.ol++;
        else counts.ul++;
        while (i < lines.length && marker.test(lines[i])) {
          counts.li++;
          i++;
          while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines[i])) i++;
        }
        continue;
      }
      counts.p++;
      while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines[i])) i++;
    }
    return counts;
  }

  test("real source docs render lists with zero severed continuations", () => {
    const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
    for (const source of REQUIREMENTS_SOURCES) {
      const md = read(source.sourcePath);
      const { html } = renderMarkdown(md);
      const expected = expectedStructure(md);
      const label = source.sourcePath;
      expect(count(html, /<ul>/g), `${label} <ul>`).toBe(expected.ul);
      expect(count(html, /<ol>/g), `${label} <ol>`).toBe(expected.ol);
      expect(count(html, /<li>/g), `${label} <li>`).toBe(expected.li);
      expect(count(html, /<blockquote>/g), `${label} <blockquote>`).toBe(
        expected.blockquote,
      );
      // Blockquotes contribute one <p> each; the rest must be real paragraphs.
      expect(count(html, /<p>/g) - expected.blockquote, `${label} <p>`).toBe(
        expected.p,
      );
    }
  });

  test("REQUIREMENTS.md functional requirements render as one ordered list of eight", () => {
    const doc = read("docs/REQUIREMENTS.md");
    const start = doc.indexOf("## Functional requirements");
    expect(start).toBeGreaterThan(-1);
    const rest = doc.slice(start);
    const end = rest.indexOf("\n## ", 1);
    const { html } = renderMarkdown(end === -1 ? rest : rest.slice(0, end));
    expect((html.match(/<ol>/g) ?? []).length).toBe(1);
    expect((html.match(/<li>/g) ?? []).length).toBe(8);
    expect(html).not.toContain("<p>");
    // Continuation text must live inside the first item, not a stray <p>.
    expect(html).toContain("navigation links — never crawls, ever.</li>");
  });
});

describe("requirements route table", () => {
  test("the hub exposes exactly the five contract routes in order", () => {
    expect(REQUIREMENTS_NAV.map((r) => r.route)).toEqual([...DOGFOOD_URLS]);
  });

  test("every route identifies its authoritative source path", () => {
    for (const route of REQUIREMENTS_NAV) {
      expect(route.sourcePath.startsWith("docs/")).toBe(true);
    }
  });

  test("routes are unique and rooted at /reqs", () => {
    const routes = REQUIREMENTS_NAV.map((r) => r.route);
    expect(new Set(routes).size).toBe(routes.length);
    for (const route of routes) expect(route.startsWith("/reqs")).toBe(true);
  });
});
