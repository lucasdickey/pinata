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
