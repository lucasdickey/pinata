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
