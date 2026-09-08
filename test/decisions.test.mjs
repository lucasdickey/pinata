// Unit tests for the decision-log rules. These encode AGENTS.md section 2.3:
// the provenance tagging is the deliverable, so the rules that keep it honest
// are the rules worth testing.

import { test, describe } from "vitest";
import assert from "node:assert/strict";
import {
  validate,
  renderMarkdown,
  renderDataIsland,
  anchor,
  asOf,
  screenshotPaths,
} from "../scripts/lib/decisions.mjs";

const ORIGINS = {
  "user-directed": { label: "Human directed", description: "", color: "#2f6feb" },
  "agent-proposed-user-approved": { label: "Agent proposed, human approved", description: "", color: "#8957e5" },
  "agent-autonomous": { label: "Agent decided alone", description: "", color: "#bf8700" },
  "user-deferred": { label: "Raised and deferred", description: "", color: "#6e7781" },
};

function decision(overrides = {}) {
  return {
    id: "D001",
    date: "2026-09-04",
    phase: "setup",
    title: "A decision",
    origin: "agent-autonomous",
    status: "accepted",
    problem: "p",
    decision: "d",
    rationale: "r",
    alternatives: [],
    consequences: [],
    transcript: {},
    artifacts: [],
    supersedes: null,
    superseded_by: null,
    ...overrides,
  };
}

function doc(decisions) {
  return {
    project: "pinata",
    tagline: "pin + annotation + at ya",
    assignment: "test",
    timebox_hours: 4,
    origins: ORIGINS,
    decisions,
  };
}

describe("validate: structure", () => {
  test("accepts a minimal well-formed document", () => {
    assert.deepEqual(validate(doc([decision()])), []);
  });

  test("rejects a missing decisions array", () => {
    const errors = validate({ origins: ORIGINS });
    assert.ok(errors.some((e) => e.includes("`decisions` must be an array")));
  });

  test("rejects an empty origins map", () => {
    const errors = validate({ origins: {}, decisions: [] });
    assert.ok(errors.some((e) => e.includes("`origins` map is missing or empty")));
  });

  for (const field of ["title", "problem", "decision", "rationale", "date", "phase", "status"]) {
    test(`rejects a record missing ${field}`, () => {
      const errors = validate(doc([decision({ [field]: "" })]));
      assert.ok(
        errors.some((e) => e.includes(`missing required field \`${field}\``)),
        `expected a missing-field error for ${field}, got ${JSON.stringify(errors)}`,
      );
    });
  }

  test("rejects duplicate ids", () => {
    const errors = validate(doc([decision(), decision()]));
    assert.ok(errors.some((e) => e.includes("duplicate id")));
  });

  test("rejects malformed ids", () => {
    const errors = validate(doc([decision({ id: "7" })]));
    assert.ok(errors.some((e) => e.includes("id must look like D001")));
  });

  test("rejects a malformed date", () => {
    const errors = validate(doc([decision({ date: "Sep 4 2026" })]));
    assert.ok(errors.some((e) => e.includes("date must be YYYY-MM-DD")));
  });

  test("rejects unknown origin, status and phase", () => {
    const errors = validate(
      doc([decision({ origin: "vibes", status: "maybe", phase: "someday" })]),
    );
    assert.ok(errors.some((e) => e.includes("unknown origin")));
    assert.ok(errors.some((e) => e.includes("unknown status")));
    assert.ok(errors.some((e) => e.includes("unknown phase")));
  });
});

describe("validate: provenance evidence", () => {
  test("user-directed requires a verbatim human instruction", () => {
    const errors = validate(doc([decision({ origin: "user-directed", transcript: {} })]));
    assert.ok(errors.some((e) => e.includes("transcript.request is empty")));
  });

  test("user-directed passes with a request quote", () => {
    const errors = validate(
      doc([decision({ origin: "user-directed", transcript: { request: "do the thing" } })]),
    );
    assert.deepEqual(errors, []);
  });

  test("agent-proposed-user-approved requires the proposal AND the approval", () => {
    const onlyProposal = validate(
      doc([
        decision({
          origin: "agent-proposed-user-approved",
          transcript: { proposal: "shall I?" },
        }),
      ]),
    );
    assert.ok(onlyProposal.some((e) => e.includes("needs both proposal and approval")));

    const onlyApproval = validate(
      doc([
        decision({
          origin: "agent-proposed-user-approved",
          transcript: { approval: "yes" },
        }),
      ]),
    );
    assert.ok(onlyApproval.some((e) => e.includes("needs both proposal and approval")));

    const both = validate(
      doc([
        decision({
          origin: "agent-proposed-user-approved",
          transcript: { proposal: "shall I?", approval: "yes" },
        }),
      ]),
    );
    assert.deepEqual(both, []);
  });

  test("agent-autonomous needs no quotes, since nobody was asked", () => {
    assert.deepEqual(validate(doc([decision({ origin: "agent-autonomous" })])), []);
  });

  test("user-deferred stays pending while the question is open", () => {
    assert.deepEqual(validate(doc([decision({ origin: "user-deferred", status: "pending" })])), []);
  });

  test("user-deferred cannot be marked accepted, which would read as settled", () => {
    const errors = validate(doc([decision({ origin: "user-deferred", status: "accepted" })]));
    assert.ok(errors.some((e) => e.includes("stay status=pending")));
  });

  test("an answered deferral becomes superseded by whatever answered it", () => {
    const errors = validate(
      doc([
        decision({
          id: "D001",
          origin: "user-deferred",
          status: "superseded",
          superseded_by: "D002",
        }),
        decision({ id: "D002", supersedes: "D001" }),
      ]),
    );
    assert.deepEqual(errors, []);
  });
});

describe("validate: reversals", () => {
  test("rejects a dangling supersedes pointer", () => {
    const errors = validate(doc([decision({ supersedes: "D999" })]));
    assert.ok(errors.some((e) => e.includes("`supersedes` points at unknown id `D999`")));
  });

  test("rejects a self-referential pointer", () => {
    const errors = validate(doc([decision({ id: "D001", supersedes: "D001" })]));
    assert.ok(errors.some((e) => e.includes("points at itself")));
  });

  test("superseded_by forces status=superseded", () => {
    const bad = validate(
      doc([decision({ id: "D001", superseded_by: "D002", status: "accepted" }), decision({ id: "D002" })]),
    );
    assert.ok(bad.some((e) => e.includes("expected superseded")));

    const good = validate(
      doc([
        decision({ id: "D001", superseded_by: "D002", status: "superseded" }),
        decision({ id: "D002", supersedes: "D001" }),
      ]),
    );
    assert.deepEqual(good, []);
  });
});

describe("validate: nested shapes", () => {
  test("rejects an alternative missing its reason", () => {
    const errors = validate(doc([decision({ alternatives: [{ option: "other way" }] })]));
    assert.ok(errors.some((e) => e.includes("needs both option and why_not")));
  });

  test("rejects artifacts with the wrong shape", () => {
    const errors = validate(
      doc([
        decision({
          artifacts: [{ type: "link" }, { type: "screenshot" }, { type: "interpretive-dance" }],
        }),
      ]),
    );
    assert.ok(errors.some((e) => e.includes("link artifacts need a url")));
    assert.ok(errors.some((e) => e.includes("screenshot artifacts need a path")));
    assert.ok(errors.some((e) => e.includes("type must be screenshot, file, or link")));
  });
});

describe("rendering", () => {
  test("anchors match GitHub heading slugs", () => {
    assert.equal(
      anchor({ id: "D001", title: 'Name the project "pinata"' }),
      "d001--name-the-project-pinata",
    );
    assert.equal(
      anchor({ id: "D012", title: "Use SQLite, not Postgres" }),
      "d012--use-sqlite-not-postgres",
    );
    // A character sitting between two spaces leaves two spaces behind once it is
    // stripped, and GitHub maps each to its own hyphen rather than collapsing.
    assert.equal(
      anchor({ id: "D013", title: "Node & friends" }),
      "d013--node--friends",
    );
  });

  test("every index link resolves to a heading in the same document", () => {
    const data = doc([
      decision({ id: "D001", title: 'Name the project "pinata"' }),
      decision({ id: "D002", title: "Pick a stack: Node & friends" }),
      decision({ id: "D003", title: "Ship it — finally" }),
    ]);
    const md = renderMarkdown(data, { sourceHash: "abc" });

    const linked = [...md.matchAll(/\| \[(D\d+)\]\(#([^)]+)\)/g)].map((m) => m[2]);
    assert.equal(linked.length, 3);

    // Deliberately an independent implementation of GitHub's slug rules, so a
    // change to the library's version cannot make this test vacuously pass.
    const headings = [...md.matchAll(/^## (.+)$/gm)]
      .map((m) => m[1].trim().toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-"));

    for (const target of linked) {
      assert.ok(headings.includes(target), `index link #${target} has no matching heading`);
    }
  });

  test("markdown escapes pipes so the index table survives", () => {
    const md = renderMarkdown(doc([decision({ title: "A | B" })]), { sourceHash: "abc" });
    assert.ok(md.includes("A \\| B"));
  });

  test("markdown surfaces provenance quotes with attribution", () => {
    const md = renderMarkdown(
      doc([
        decision({
          origin: "agent-proposed-user-approved",
          transcript: { proposal: "shall I?", approval: "go ahead" },
        }),
      ]),
      { sourceHash: "abc" },
    );
    assert.ok(md.includes("Agent asked:"));
    assert.ok(md.includes("> shall I?"));
    assert.ok(md.includes("Human approved:"));
    assert.ok(md.includes("> go ahead"));
  });

  test("provenance summary counts every origin, including the empty ones", () => {
    const md = renderMarkdown(
      doc([decision({ id: "D001", origin: "user-directed", transcript: { request: "x" } })]),
      { sourceHash: "abc" },
    );
    assert.ok(md.includes("| Human directed | 1 | D001 |"));
    assert.ok(md.includes("| Agent proposed, human approved | 0 | — |"));
    assert.ok(md.includes("| **Total** | **1** | |"));
  });

  test("rendering is deterministic for identical input", () => {
    const data = doc([decision()]);
    assert.equal(
      renderMarkdown(data, { sourceHash: "abc" }),
      renderMarkdown(data, { sourceHash: "abc" }),
    );
    assert.equal(
      renderDataIsland(data, { sourceHash: "abc" }),
      renderDataIsland(data, { sourceHash: "abc" }),
    );
  });

  test("the data island is executable JS that assigns window.PINATA", () => {
    const js = renderDataIsland(doc([decision()]), { sourceHash: "abc" });
    const sandbox = { window: {} };
    new Function("window", js)(sandbox.window);
    assert.equal(sandbox.window.PINATA.decisions.length, 1);
    assert.equal(sandbox.window.PINATA.source_hash, "abc");
    assert.equal(sandbox.window.PINATA.as_of, "2026-09-04");
  });

  test("asOf reports the latest decision date", () => {
    const data = doc([
      decision({ id: "D001", date: "2026-09-04" }),
      decision({ id: "D002", date: "2026-09-06" }),
      decision({ id: "D003", date: "2026-09-05" }),
    ]);
    assert.equal(asOf(data), "2026-09-06");
  });

  test("screenshotPaths finds only screenshots", () => {
    const data = doc([
      decision({
        artifacts: [
          { type: "screenshot", path: "screenshots/a.png" },
          { type: "file", path: "src/x.ts" },
          { type: "link", url: "https://example.com" },
        ],
      }),
    ]);
    assert.deepEqual(screenshotPaths(data), ["screenshots/a.png"]);
  });
});
