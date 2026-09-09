// @vitest-environment jsdom
// The decisions route must render straight from docs/decisions/decisions.json,
// preserving every schema field, source order, provenance quote, artifact, and
// supersession link — with no second decision dataset anywhere in the app.
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DecisionsCatalog } from "../src/components/decisions-catalog";
import { DECISIONS_SOURCE } from "../src/lib/decisions";

const ROOT = process.cwd();

describe("DecisionsCatalog", () => {
  test("renders every record exactly once, in source order", () => {
    const { container } = render(<DecisionsCatalog />);
    const articles = container.querySelectorAll("article[data-decision-id]");
    expect(articles.length).toBe(DECISIONS_SOURCE.decisions.length);
    const rendered = [...articles].map((a) => a.getAttribute("data-decision-id"));
    expect(rendered).toEqual(DECISIONS_SOURCE.decisions.map((d) => d.id));
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  test("each card carries id, date, phase, title, status, and origin label", () => {
    const { container } = render(<DecisionsCatalog />);
    const first = container.querySelector('article[data-decision-id="D001"]');
    expect(first).not.toBeNull();
    const card = within(first as HTMLElement);
    card.getByRole("heading", { name: /Name the project/ });
    card.getByText("2026-09-04");
    card.getByText("setup");
    card.getByText("accepted");
    card.getByText("Human directed");
  });

  test("preserves problem, decision, rationale, and consequences", () => {
    const { container } = render(<DecisionsCatalog />);
    const first = within(container.querySelector('article[data-decision-id="D001"]') as HTMLElement);
    first.getByText(/needed a name before a repository could be created/);
    expect(first.getAllByText(/portmanteau/).length).toBeGreaterThan(0);
    first.getByText(/pun encodes the product thesis/);
    first.getByText(/IPFS pinning service Pinata/);
  });

  test("quotes provenance transcripts verbatim without relabeling", () => {
    const { container } = render(<DecisionsCatalog />);
    const directed = within(container.querySelector('article[data-decision-id="D001"]') as HTMLElement);
    directed.getByText(/createa new directory here init a github repo/);
    const proposed = within(container.querySelector('article[data-decision-id="D009"]') as HTMLElement);
    proposed.getByText("Agent proposed, human approved");
    proposed.getByText(/Rename the GitHub default branch from master to main\?/);
    proposed.getByText(/“Rename to main”/);
    const autonomous = within(container.querySelector('article[data-decision-id="D005"]') as HTMLElement);
    autonomous.getByText("Agent decided alone");
  });

  test("renders alternatives with their rejection reasons", () => {
    const { container } = render(<DecisionsCatalog />);
    const card = within(container.querySelector('article[data-decision-id="D009"]') as HTMLElement);
    card.getByText("Keep `master`");
    card.getByText(/Rejected by the human/);
  });

  test("links supersession pointers between cards", () => {
    const { container } = render(<DecisionsCatalog />);
    const superseded = container.querySelector('article[data-decision-id="D003"]');
    const link = superseded?.querySelector('a[href="#D009"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("D009");
    const successor = container.querySelector('article[data-decision-id="D009"]');
    expect(successor?.querySelector('a[href="#D003"]')).not.toBeNull();
  });

  test("renders artifacts with captions and safe links", () => {
    const { container } = render(<DecisionsCatalog />);
    const card = container.querySelector('article[data-decision-id="D002"]');
    const link = card?.querySelector('a[href="https://github.com/lucasdickey/pinata"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("rel")).toContain("noreferrer");
    expect(link?.textContent).toContain("The repository");
    const file = container.querySelector('article[data-decision-id="D005"]');
    expect(file?.textContent).toContain("scripts/build-docs.mjs");
  });

  test("external artifact links visibly name their HTTPS destination host", () => {
    // VAL-REQS-004: the Markdown renderer already appends a visible
    // (host) suffix to external links; decision artifact links must match.
    const { container } = render(<DecisionsCatalog />);
    const cases: Array<[string, string, string]> = [
      ["D002", "https://github.com/lucasdickey/pinata", "github.com"],
      ["D012", "https://app.factory.ai/sessions/901210d4-da5a-462c-b63b-07301719d17f", "app.factory.ai"],
      ["D040", "https://vercel.com/docs/vercel-blob/public-storage", "vercel.com"],
    ];
    for (const [id, href, host] of cases) {
      const card = container.querySelector(`article[data-decision-id="${id}"]`);
      const link = card?.querySelector(`a[href="${href}"]`);
      expect(link, `${id} artifact link`).not.toBeNull();
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toContain("noreferrer");
      const suffix = link?.parentElement?.querySelector("span.external-host");
      expect(suffix?.textContent, `${id} host suffix`).toBe(`(${host})`);
    }
  });

  test("card titles are h2 and in-card headings never skip a level", () => {
    // VAL-REQS-006 heading-order: the page h1 must be followed by h2 card
    // titles, with h3 sub-sections — no h1 -> h3 or h2 -> h4 skips.
    const { container } = render(<DecisionsCatalog />);
    const articles = container.querySelectorAll("article[data-decision-id]");
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      const id = article.getAttribute("data-decision-id");
      const headings = [...article.querySelectorAll("h1, h2, h3, h4, h5, h6")];
      expect(headings[0]?.tagName, `${id} title level`).toBe("H2");
      let previous = 1; // the page h1 precedes every card
      for (const heading of headings) {
        const level = Number(heading.tagName.slice(1));
        expect(level - previous, `${id} heading order ${heading.textContent}`).toBeLessThanOrEqual(1);
        previous = level;
      }
    }
  });

  test("repeated region landmarks are labeled uniquely per decision", () => {
    // VAL-REQS-006 landmark-unique: Artifacts/Provenance/Alternatives/
    // Consequences sections repeat across cards, so each label carries the
    // decision ID.
    const { container } = render(<DecisionsCatalog />);
    const regions = [...container.querySelectorAll("section[aria-label]")];
    expect(regions.length).toBeGreaterThan(0);
    const labels = regions.map((r) => r.getAttribute("aria-label"));
    expect(new Set(labels).size).toBe(labels.length);
    for (const region of regions) {
      const card = region.closest("article[data-decision-id]");
      expect(region.getAttribute("aria-label")).toContain(card?.getAttribute("data-decision-id"));
    }
  });

  test("renders transcript text as escaped text, never markup", () => {
    render(<DecisionsCatalog />);
    // D011's request contains a typo ("wiht"); it must survive verbatim.
    expect(screen.getAllByText(/especially wiht key decisions/).length).toBeGreaterThan(0);
  });
});

describe("decision data single-source enforcement", () => {
  test("the decisions route imports the shared JSON and no generated copy", () => {
    const page = readFileSync(join(ROOT, "app/reqs/decisions/page.tsx"), "utf8");
    const lib = readFileSync(join(ROOT, "src/lib/decisions.ts"), "utf8");
    const catalog = readFileSync(join(ROOT, "src/components/decisions-catalog.tsx"), "utf8");
    const combined = `${page}\n${lib}\n${catalog}`;
    expect(combined).toContain("docs/decisions/decisions.json");
    expect(combined).not.toContain("decisions-data");
  });
});
