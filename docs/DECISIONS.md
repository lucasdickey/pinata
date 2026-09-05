<!-- GENERATED FILE. Do not edit.
     Source: docs/decisions/decisions.json
     Regenerate: npm run docs -->

# Decision log

**pinata** — pin + annotation + at ya  
Factory candidate assignment: build a small MVP using AI tooling  
Timebox: ~4h

Every record is tagged with its **origin**, which separates what the human
directed from what the agent proposed and the human approved. See `AGENTS.md`
section 2.3 for the taxonomy and the evidence each origin requires.

## Provenance at a glance

| Origin | Count | Decisions |
| --- | --: | --- |
| Human directed | 4 | D001, D002, D004, D007 |
| Agent proposed, human approved | 0 | — |
| Agent decided alone | 3 | D005, D006, D008 |
| Raised and deferred | 1 | D003 |
| **Total** | **8** | |

## Index

| ID | Phase | Decision | Origin | Status |
| --- | --- | --- | --- | --- |
| [D001](#d001--name-the-project-pinata) | setup | Name the project "pinata" | Human directed | accepted |
| [D002](#d002--public-github-repository-under-the-lucasdickey-account) | setup | Public GitHub repository under the lucasdickey account | Human directed | accepted |
| [D003](#d003--default-branch-left-as-master-pending-a-call) | setup | Default branch left as master pending a call | Raised and deferred | pending |
| [D004](#d004--treat-the-decision-trail-as-a-shipped-deliverable) | setup | Treat the decision trail as a shipped deliverable | Human directed | accepted |
| [D005](#d005--one-json-source-of-truth-both-human-readable-artifacts-generated) | setup | One JSON source of truth, both human-readable artifacts generated | Agent decided alone | accepted |
| [D006](#d006--build-the-scaffolding-before-fixing-the-product-concept) | concept | Build the scaffolding before fixing the product concept | Agent decided alone | accepted |
| [D007](#d007--one-command-is-the-quality-gate-npm-run-validate) | validate | One command is the quality gate: npm run validate | Human directed | accepted |
| [D008](#d008--test-the-provenance-rules-not-just-the-code-that-renders-them) | validate | Test the provenance rules, not just the code that renders them | Agent decided alone | accepted |

---

## D001 — Name the project "pinata"

*2026-09-04 · phase: setup · origin: **Human directed** · status: **accepted***

**Problem**

The project needed a name before a repository could be created, and the name would signal the product concept.

**Decision**

Name it `pinata`, read as a portmanteau of **pin** + **anno**tation + at **ya**.

**Rationale**

Specified by the human with the gloss already attached. The pun encodes the product thesis — annotations that get pinned somewhere and then come back at you — which is a useful constraint to design against.

**Consequences**

- The name sets an expectation that the MVP involves pinning annotations to something and resurfacing them.
- `pinata` collides with the well-known IPFS pinning service Pinata; not a problem for an interview artifact, would matter for anything public-facing.

**Provenance evidence**

Human instruction:

> createa new directory here init a github repo and call it pinata (a portmanteau for pin attotation at ya) this is a public github repo in the lucasdickey account

---

## D002 — Public GitHub repository under the lucasdickey account

*2026-09-04 · phase: setup · origin: **Human directed** · status: **accepted***

**Problem**

Repository visibility and ownership had to be chosen at creation time, and visibility is awkward to reason about after secrets or history exist.

**Decision**

Create `github.com/lucasdickey/pinata` as a public repository from the outset.

**Alternatives considered**

- *Private repository, opened up later* — Not requested, and it would make the build history harder for a reviewer to inspect.

**Rationale**

Specified by the human. Public from the first commit also means the full commit history is reviewable evidence that the work was built new for this assignment.

**Consequences**

- No credentials, tokens, or client data may ever enter this repository, including in the screenshots attached to decision records.
- The commit graph is part of the deliverable, so commits should be legible rather than squashed into one.

**Provenance evidence**

Human instruction:

> this is a public github repo in the lucasdickey account

**Artifacts**

- [The repository](https://github.com/lucasdickey/pinata)

---

## D003 — Default branch left as master pending a call

*2026-09-04 · phase: setup · origin: **Raised and deferred** · status: **pending***

**Problem**

The local git config defaults to `master`, so the pushed repository has `master` as its default branch. Renaming is trivial now and annoying once branches and CI exist.

**Decision**

Left as `master` for the moment. Flagged to the human rather than renamed silently.

**Alternatives considered**

- *Rename to `main` unilaterally* — Cosmetic but visible on a repository that will be reviewed by others; not the agent's call to make without asking.

**Rationale**

A one-word question is cheaper than an unrequested change to something the human will see in the GitHub UI.

**Consequences**

- If this is left as `master`, any CI configuration and branch protection must reference `master` consistently.

**Provenance evidence**

Agent asked:

> One note: your local git defaults to `master`, so that's the default branch on GitHub. Say the word if you want it renamed to `main`.

---

## D004 — Treat the decision trail as a shipped deliverable

*2026-09-04 · phase: setup · origin: **Human directed** · status: **accepted***

**Problem**

The assignment is graded partly on "ability to explain your process and decisions." Reconstructing that narrative at the end of a four-hour build produces a sanitized story that omits the reversals, which are the interesting part.

**Decision**

Document decisions continuously as the build proceeds, in three forms: agent rules encoded in `AGENTS.md`, a plain-text Markdown log for reading afterwards, and an HTML dashboard that opens in a browser and can carry screenshots. Each decision is explicitly tagged with whether the human requested it or the agent proposed it and the human approved.

**Alternatives considered**

- *Write a retrospective at the end of the build* — Hindsight flattens the trail. Dead ends get quietly dropped and every choice looks inevitable.
- *Rely on the git log and the Factory session transcript* — Both record what happened but not why, and neither distinguishes a human instruction from an agent suggestion that was rubber-stamped.

**Rationale**

Requested by the human. The provenance split is the load-bearing part: it makes the division of labor between human and agent auditable instead of asserted, which is precisely what an agent-driven-development interview is probing.

**Consequences**

- Documentation upkeep consumes part of the 4-hour timebox and must be counted honestly in the session log.
- Every material choice from here forward carries a small logging tax.
- The agent must ask for approval more explicitly than usual, because approvals are now evidence.

**Provenance evidence**

Human instruction:

> We will be performing the exercise request within, but I want us to set our project work up to reflect the ultimate outcome being requested. Let's document our work as I go. Let's identify decisions that we made that were critical as we go. In particular, let's identify those that I requested versus those that I approved that you asked for approval on. Set up our agents.md file or our Claude.md file to reflect that this is what we want and that we want something like a plain text Markdown file to review afterwards. I also like the idea of us constructing an HTML file that loads in the browser and shows decisions as we progress, and this can include helpful screenshots as well.

**Artifacts**

- ![The dashboard on first render: provenance counters across the top, origin and phase filters, two records expanded](dashboard/screenshots/D004-dashboard.png) — The dashboard on first render: provenance counters across the top, origin and phase filters, two records expanded
- `AGENTS.md` — The protocol the agent is now bound by

---

## D005 — One JSON source of truth, both human-readable artifacts generated

*2026-09-04 · phase: setup · origin: **Agent decided alone** · status: **accepted***

**Problem**

The human asked for two views of the same decision trail: a Markdown file and an HTML dashboard. Maintaining both by hand guarantees they drift, and drift in the artifact that is supposed to prove rigor is worse than having one view.

**Decision**

Hand-edit `docs/decisions/decisions.json` only. Generate `docs/DECISIONS.md` and `docs/dashboard/decisions-data.js` from it with `node scripts/build-docs.mjs`. Ship the dashboard as a static page that reads a generated JS data island so it opens over `file://` with no server and no dependencies.

**Alternatives considered**

- *Hand-write DECISIONS.md and have the dashboard parse the Markdown* — Markdown parsing in the browser needs a dependency, and freeform prose is a fragile schema for the provenance tagging that is the whole point.
- *Have the dashboard `fetch()` decisions.json directly* — Browsers block `fetch` against `file://` origins, so the page would require a local web server. A reviewer should be able to double-click the file.
- *Static site generator* — Dependency install, build step, and lock file, all to render roughly twenty records inside a four-hour timebox.

**Rationale**

Chosen unilaterally because it is an implementation detail of a deliverable the human had already specified, it is fully reversible, and it adds no dependencies. Labeling it `agent-autonomous` rather than approved is the honest call: the human asked for the two artifacts, not for this mechanism.

**Consequences**

- `docs/DECISIONS.md` and `docs/dashboard/decisions-data.js` must never be hand-edited.
- The generator has to be run before every commit or the repository ships stale docs.
- A malformed `decisions.json` breaks both views at once, so the generator validates required fields and fails loudly.

**Artifacts**

- `scripts/build-docs.mjs` — The generator

---

## D006 — Build the scaffolding before fixing the product concept

*2026-09-04 · phase: concept · origin: **Agent decided alone** · status: **accepted***

**Problem**

The human asked to get the holistic structure in place and then start building, but the product concept was not yet stated beyond what the name implies. Guessing the concept risked building the wrong thing; waiting risked burning the turn on nothing.

**Decision**

Build the documentation apparatus first, deliberately concept-agnostic, and surface the product-direction question for the human to answer before any application code is written.

**Alternatives considered**

- *Infer the concept from the name and start building* — "Pinned annotations" admits several very different products. Building the wrong one costs more than one question does, against a 4-hour budget.
- *Ask first and build nothing this turn* — The scaffolding was already fully specified and does not depend on the concept, so it was free to do in parallel.

**Rationale**

The scaffolding has no coupling to the product, so doing it first is pure parallelism. The concept question is the one place where a wrong guess is expensive, so it is the one place worth blocking on.

**Consequences**

- `src/` stays empty until the concept is settled.
- The first product decision record will be `user-directed` or `agent-proposed-user-approved`, never `agent-autonomous`.

**Provenance evidence**

Human instruction:

> Once we have our holistic structure placed together, let's go ahead and get started.

---

## D007 — One command is the quality gate: npm run validate

*2026-09-04 · phase: validate · origin: **Human directed** · status: **accepted***

**Problem**

Factory refused to start a Mission here, warning that the folder was not a git repository and that Missions need strong validation capability or they will incorrectly infer how to QA the application. Two separate faults sat behind one warning. First, `/missions` was being run from `~/Documents/code`, which is a plain directory, while the actual repository is the `pinata` subdirectory. Second, and more seriously, the project genuinely had no way to tell a good change from a bad one: no tests, no lint, no build, nothing an autonomous agent could run to check its own work.

**Decision**

Run Missions from inside `pinata/`, and give the repository a real validation contract before any Mission touches it. `npm run validate` is the single gate, chaining `lint` then `docs:check` then `test`. It is documented in `AGENTS.md` section 3 as the authoritative answer to "how do I know a change is good?", and CI runs the identical command so local green and CI green mean the same thing.

**Alternatives considered**

- *Proceed and accept the warning's risk* — The warning is accurate. An agent with no validation signal optimizes for looking finished, and the failure surfaces later as confidently broken output.
- *Add a test framework such as Vitest or Jest* — Node 20 ships `node:test`, which covers this need exactly. A framework would break the zero-dependency rule that keeps the docs artifacts working with no install step.
- *Wait until product code exists before adding tests* — The documentation apparatus is already the largest thing in the repo and is itself a graded deliverable. It needed covering regardless, and having the gate in place first means product code inherits it.
- *Init a git repo in the parent directory to silence the warning* — That directory holds dozens of unrelated projects. It would hand a Mission a working tree of other people's work to reason about.

**Rationale**

Requested by the human as an explicit precondition to running a Mission. The design principle chosen inside that request: validation has to be one command, dependency-free, and deterministic, because a gate that is slow, flaky, or awkward to run does not get run. Determinism specifically forced generated artifacts to embed a source hash rather than a wall-clock timestamp, since otherwise every build differs from the last and a staleness check can never pass.

**Consequences**

- `npm run validate` must pass before any work is called finished, by a human or an agent.
- Generated output must stay a pure function of `decisions.json`; no timestamps, no environment-dependent content.
- Product code landing in `src/` adds its tests to the same `test/` directory rather than introducing a second runner.
- The test suite is now load-bearing documentation: it encodes the provenance rules from `AGENTS.md` 2.3 as executable assertions, so the protocol cannot quietly rot.
- Missions must be launched from `pinata/`, not from the parent directory.

**Provenance evidence**

Human instruction:

> let's do this first before we run /missions: You are about to run a Mission on a folder that is not a git repository, so we cannot evaluate its agent readiness. Missions can only run effectively when there are strong validation capabilities built into the project. By proceeding, you are claiming that these capabilities exist or taking the risk that the Mission will incorrectly infer how to QA your application.

**Artifacts**

- `AGENTS.md` — Section 3 states the validation contract a Mission should read
- `.github/workflows/validate.yml` — CI runs the same single command

---

## D008 — Test the provenance rules, not just the code that renders them

*2026-09-04 · phase: validate · origin: **Agent decided alone** · status: **accepted***

**Problem**

The decision log's value rests entirely on the provenance tags being trustworthy. Nothing stopped a future agent, including me, from tagging a choice `user-directed` with no quote behind it, or from quietly relabelling something it had decided alone as something the human approved. A convention written in prose in `AGENTS.md` is a convention that erodes.

**Decision**

Encode the section 2.3 rules as executable assertions. The validator rejects `user-directed` without `transcript.request`, rejects `agent-proposed-user-approved` unless both the proposal and the approval are quoted, holds `user-deferred` at `status: pending`, and refuses dangling or self-referential supersession pointers. `npm run validate` therefore fails on a dishonest record, not merely a malformed one. The suite also checks the real repository: gapless ids, screenshots that actually exist on disk, generated files that are not stale, and a dashboard that reads no field the generator stopped emitting.

**Alternatives considered**

- *Trust the convention as documented prose* — Unenforced conventions decay, and this one decays in the direction of flattering the agent.
- *Only test the pure render functions* — That catches template bugs while missing the failure that matters: a committed record with no evidence behind its claim.

**Rationale**

Decided without asking because it is a strictly stronger version of a protocol the human had already specified, and it constrains the agent rather than the human. Worth its own record because it earned its keep immediately: the suite caught a real bug where slugs collapsed runs of spaces into one hyphen while GitHub emits one per space, which would have silently broken every index link in `DECISIONS.md` for any title containing an em dash or an ampersand.

**Consequences**

- Adding a decision record now requires its evidence, or the build fails.
- Screenshots must be committed alongside the record that references them.
- `githubSlug` is pinned by tests with an independent second implementation as the oracle, so the two cannot drift into agreeing on the wrong answer.

**Artifacts**

- `test/decisions.test.mjs` — The provenance rules as executable assertions
- `test/artifacts.test.mjs` — Integrity checks against the real repository contents

---

<sub>Generated from 8 record(s) as of 2026-09-04 · source `e88d02b99c1f`</sub>
