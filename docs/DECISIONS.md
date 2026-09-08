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
| Human directed | 7 | D001, D002, D004, D007, D011, D012, D013 |
| Agent proposed, human approved | 9 | D009, D010, D014, D015, D016, D017, D018, D019, D020 |
| Agent decided alone | 3 | D005, D006, D008 |
| Raised and deferred | 1 | D003 |
| **Total** | **20** | |

## Index

| ID | Phase | Decision | Origin | Status |
| --- | --- | --- | --- | --- |
| [D001](#d001--name-the-project-pinata) | setup | Name the project "pinata" | Human directed | accepted |
| [D002](#d002--public-github-repository-under-the-lucasdickey-account) | setup | Public GitHub repository under the lucasdickey account | Human directed | accepted |
| [D003](#d003--default-branch-left-as-master-pending-a-call) | setup | Default branch left as master pending a call | Raised and deferred | superseded |
| [D004](#d004--treat-the-decision-trail-as-a-shipped-deliverable) | setup | Treat the decision trail as a shipped deliverable | Human directed | accepted |
| [D005](#d005--one-json-source-of-truth-both-human-readable-artifacts-generated) | setup | One JSON source of truth, both human-readable artifacts generated | Agent decided alone | accepted |
| [D006](#d006--build-the-scaffolding-before-fixing-the-product-concept) | concept | Build the scaffolding before fixing the product concept | Agent decided alone | accepted |
| [D007](#d007--one-command-is-the-quality-gate-npm-run-validate) | validate | One command is the quality gate: npm run validate | Human directed | accepted |
| [D008](#d008--test-the-provenance-rules-not-just-the-code-that-renders-them) | validate | Test the provenance rules, not just the code that renders them | Agent decided alone | accepted |
| [D009](#d009--rename-the-default-branch-to-main) | setup | Rename the default branch to main | Agent proposed, human approved | accepted |
| [D010](#d010--commit-straight-to-main-with-ci-as-the-only-gate) | setup | Commit straight to main, with CI as the only gate | Agent proposed, human approved | accepted |
| [D011](#d011--commit-and-push-early-and-often-especially-at-decision-points) | setup | Commit and push early and often, especially at decision points | Human directed | accepted |
| [D012](#d012--define-the-product-directional-feedback-on-friends-public-websites) | concept | Define the product: directional feedback on friends' public websites | Human directed | accepted |
| [D013](#d013--chickpea-is-the-canonical-real-world-test-target) | concept | Chickpea is the canonical real-world test target | Human directed | accepted |
| [D014](#d014--nextjs--react--typescript-on-vercel-is-the-application-stack) | design | Next.js + React + TypeScript on Vercel is the application stack | Agent proposed, human approved | accepted |
| [D015](#d015--mit-react-flow-is-the-canvas-foundation) | design | MIT React Flow is the canvas foundation | Agent proposed, human approved | accepted |
| [D016](#d016--browserless-captures-screenshots-and-dom-manifests-in-one-session) | design | Browserless captures screenshots and DOM manifests in one session | Agent proposed, human approved | accepted |
| [D017](#d017--private-vercel-blob-for-images-tursolibsql--drizzle-for-metadata) | design | Private Vercel Blob for images, Turso/libSQL + Drizzle for metadata | Agent proposed, human approved | accepted |
| [D018](#d018--editor-password-prompt-persistent-founder-capability-links-append-only-threads) | design | Editor password prompt, persistent founder capability links, append-only threads | Agent proposed, human approved | accepted |
| [D019](#d019--standardize-on-node-24-across-app-ci-and-vercel) | setup | Standardize on Node 24 across app, CI, and Vercel | Agent proposed, human approved | accepted |
| [D020](#d020--product-stack-transition-vitest-and-playwright-join-the-single-validate-gate) | validate | Product-stack transition: Vitest and Playwright join the single validate gate | Agent proposed, human approved | accepted |

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

*2026-09-04 · phase: setup · origin: **Raised and deferred** · status: **superseded***
*Superseded by D009.*

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

## D009 — Rename the default branch to main

*2026-09-04 · phase: setup · origin: **Agent proposed, human approved** · status: **accepted***
*Supersedes D003.*

**Problem**

`D003` deferred this. The local git default produced a `master` branch, which stayed the default on a public repository that will be reviewed. Leaving it deferred meant CI had to trigger on two branch names and the answer would get more expensive the longer branches and history accumulated.

**Decision**

Rename to `main`. Done as a pointer move at the same commit — `git branch -m`, push `main`, set the GitHub default, delete the remote `master` — so no history was rewritten and the SHA is unchanged. CI now triggers on `main` only.

**Alternatives considered**

- *Keep `master`* — Rejected by the human. It also meant carrying a two-name CI trigger indefinitely to cover a question nobody had answered.
- *Defer again until the product concept lands* — The cost of renaming only grows. Doing it while the repo is two commits deep and has no open branches is the cheapest this will ever be.

**Rationale**

The agent raised it, twice, and the human chose. Recorded as `agent-proposed-user-approved` rather than `user-directed` because the human never asked for a rename; they answered a question the agent put to them. The distinction is exactly what the origin field exists to preserve.

**Consequences**

- Anyone with an existing clone needs `git branch -m master main` and a new upstream, or a fresh clone.
- `master` no longer exists on the remote; references to it are dead.
- The CI trigger list is now a single branch, so a future rename would need the workflow updated too.

**Provenance evidence**

Agent asked:

> Rename the GitHub default branch from master to main? Still unresolved (D003); CI currently triggers on both.

Human approved:

> Rename to main

**Artifacts**

- `.github/workflows/validate.yml` — Trigger list reduced to main

---

## D010 — Commit straight to main, with CI as the only gate

*2026-09-04 · phase: setup · origin: **Agent proposed, human approved** · status: **accepted***

**Problem**

The first chunk of work went through a branch and a pull request, which produced a reviewable narrative but cost a round trip on a solo project inside a 4-hour timebox. The question was whether to keep paying that.

**Decision**

Commit directly to `main` from here on. No feature branches, no pull requests. `npm run validate` before every commit stays mandatory, and CI runs the same command on every push, so the gate is unchanged — only the ceremony is gone.

**Alternatives considered**

- *Keep a branch and PR per chunk* — Rejected by the human. On a single-author project with nobody to review, the PR adds latency without adding a reviewer.
- *Run a Mission from inside pinata/* — Not chosen now. It remains available, and `D007` put the validation contract in place precisely so it would be safe when it is.

**Rationale**

The agent offered the options and the human picked. Worth recording because it removes a safety net: with no PR, the pre-commit `validate` run and CI are the only things standing between a bad change and the default branch. That trade is acceptable only because the gate is fast, deterministic, and dependency-free.

**Consequences**

- `main` is no longer protected by review, so a broken commit lands on the default branch before CI reports.
- `npm run validate` must pass locally before every commit, not merely before every merge.
- PR #1 remains the one place where the reasoning is narrated in review form; later reasoning lives only in the decision log and the session log, which raises the stakes on keeping both current.

**Provenance evidence**

Agent asked:

> Now that CI is green, how should we work from here? Feature branch + PR per chunk, like this one / Commit straight to the default branch / Run a Mission from inside pinata/

Human approved:

> Commit straight to the default branch

---

## D011 — Commit and push early and often, especially at decision points

*2026-09-08 · phase: setup · origin: **Human directed** · status: **accepted***

**Problem**

Work from Session 01 and afterward sat uncommitted in the working tree: a .gitignore update, a vendored agent skill, and a brand asset. The commit graph is itself part of the graded deliverable (D002), so progress that exists only locally is invisible to a reviewer and one accident away from being lost.

**Decision**

Commit and push to the remote frequently rather than batching — at minimum whenever a decision is recorded or implemented. Reversal is cheap with git, so the bias is toward publishing small commits early.

**Alternatives considered**

- *Commit in large batches at natural milestones* — Batching hides the build narrative the assignment asks us to surface, and leaves work sitting locally where it can be lost.
- *Commit locally and push at milestones* — The remote repository is the review surface; unpushed work may as well not exist for the reviewer.

**Rationale**

Directed by the human, with the reasoning supplied: reversing a commit is easy, so there is no upside to sitting on uncommitted work. This also reinforces D002's consequence that the commit history is reviewable evidence the work was built new for this assignment. Complements D010 (no PR ceremony) with the push-frequency half of the same hygiene rule. Originally drafted as D009 in a session whose tree pre-dated the published D009/D010; renumbered on merge, which is itself recorded in Session 03.

**Consequences**

- The existing regenerate-docs-before-committing rule now applies at a higher frequency.
- Every push is immediately public, so staged content must be checked for secrets and client data each time, not just at milestones.
- Commits stay small and their bodies name the decision IDs they implement.

**Provenance evidence**

Human instruction:

> please be sure to commit and push to remote as we make decisions, so we don't sit with an empty git repository. i'd rather commit and push often, given the ease of reversing with git source control. and especially wiht key decisions we've decided on.

**Artifacts**

- `AGENTS.md` — Section 4 commit-hygiene rule updated to require frequent pushes

---

## D012 — Define the product: directional feedback on friends' public websites

*2026-09-08 · phase: concept · origin: **Human directed** · status: **accepted***

**Problem**

D006 left the product concept deliberately open, blocking all application code. The human stated the problem in their own words at the start of Mission planning (2026-09-06); recorded here on 2026-09-08 along with the rest of the planning decisions.

**Decision**

Pinata is a lightweight, Figma-like web workspace for giving directional feedback on friends' public SaaS, product, pricing, and documentation pages. Static full-page captures, pinned annotations with comments, and a simple founder reply loop. Explicitly out of scope: deterministic copy/style edits (the founder owns the edits), interaction or animation capture, and runtime AI — feedback stays human-authored and directional.

**Alternatives considered**

- *A deterministic editing tool that applies copy/style changes directly* — Explicitly rejected by the human: "We're not making an IDE." Directional suggestions, not pedantic instructions.
- *Runtime AI to generate or transform feedback* — Rejected unless a compelling reason emerges; token consumption needs justification, and the product thesis is human-authored feedback.

**Rationale**

Stated directly by the human in the mission brief, resolving D006 exactly as D006 predicted: the first product decision is user-directed. The concept matches the name thesis from D001 — annotations pinned to a page, coming back at the founder.

**Consequences**

- `src/` can now be built against a fixed concept.
- No AI provider keys are needed at runtime; the constraint can only be revisited with explicit justification.
- Feature requests for deterministic edits or interaction capture are out of scope by definition.
- The decision, session-log, and dashboard protocol from D004/D005 remains the record-keeping contract for everything that follows.

**Provenance evidence**

Human instruction:

> Solution: Figma-like, but much lighter weight. Easy to input/create feedback, from any computer I might have access to, targeting any friends website. [...] I do not wish to deterministicaly make copy edits, change colors/styles, etc. That is responsibility of the founder friend, I just ant to give directional feedback for things to consider or try, rather than pedantic/deterministic instructions. We're not making an IDE. [...] I'd prefer that we limit the use of AI/token consumption for this software as it operates unless there is a REALLY good reason to consider otherwise

**Artifacts**

- [The Factory Mission session where the brief was given and planned](https://app.factory.ai/sessions/901210d4-da5a-462c-b63b-07301719d17f)

---

## D013 — Chickpea is the canonical real-world test target

*2026-09-08 · phase: concept · origin: **Human directed** · status: **accepted***

**Problem**

Evals against synthetic fixtures would not surface the failure modes that matter — lazy-loaded content, dense pricing tables, real CSS. And the product has a real first user with a real deadline behind it.

**Decision**

Use `https://chickpea.co/` plus the explicit URL array `/pricing`, `/about`, `/privacy` as the primary validation target throughout the build. The first real project is feedback for Chickpea's founder. Captures are internal test/demo material with source attribution, not reusable marketing assets.

**Alternatives considered**

- *A local fixture site for capture testing* — A fixture cannot reproduce lazy loading, cookie banners, or dense real-world layout; the capture pipeline must handle a real production site from day one.

**Rationale**

Directed by the human, who needs to send feedback to Chickpea's founder soon. This makes the eval target and the first real use case the same thing, which is the strongest kind of eval.

**Consequences**

- The validation contract asserts against live Chickpea pages, so tests inherit that site's uptime and content drift as a managed risk.
- URL arrays are explicit: no crawling or link discovery.
- Desktop and mobile captures of the same URLs are both required, so geometry alignment between viewports is a first-class concern.

**Provenance evidence**

Human instruction:

> i want to use this site for our core test: http://chickpea.co/ - as it's the one we're using for real-world inspiration as I need to provide feedback to Pejman ("founder") ASAP

---

## D014 — Next.js + React + TypeScript on Vercel is the application stack

*2026-09-08 · phase: design · origin: **Agent proposed, human approved** · status: **accepted***

**Problem**

The product needed a stack that ships an MVP fast, integrates natively with the chosen storage services, and keeps authorization server-side without standing up a separate API.

**Decision**

Build the app with Next.js + React + TypeScript, deployed to Vercel. Server routes and actions authenticate actors, enforce role permissions, validate URLs and payloads, and mediate all storage access. Local development runs on `127.0.0.1:3100`; port 3000 and all pre-existing local processes are off-limits (approved separately).

**Rationale**

Proposed by the agent as part of the binding architecture and approved wholesale by the human. Next.js on Vercel collapses hosting, server-side authz, and the Blob/Turso integrations into one deploy target, which matters against a 4-hour-flavored budget even though the mission is allowed to run longer.

**Consequences**

- The password prompt is client-visible but credential checks are always server-side; no secret ships in browser code.
- All Blob and Turso access passes through authorized application routes — the browser never holds storage credentials.
- Port 3100 is reserved for Pinata; start/stop/health checks hardcode it.
- GitHub Actions runs the same validation command as local development.

**Provenance evidence**

Agent asked:

> My proposed binding architecture is: Next.js + TypeScript on Vercel; MIT React Flow for the canvas; Browserless Function API for aligned screenshot and DOM-manifest capture; Private Vercel Blob for images; Turso/libSQL + Drizzle for projects, captures, feedback, immutable replies, and capability rotation; App password prompt checked server-side against environment secrets; Local app on port 3100; port 3000 and all existing processes remain off-limits

Human approved:

> Approve as proposed

---

## D015 — MIT React Flow is the canvas foundation

*2026-09-08 · phase: design · origin: **Agent proposed, human approved** · status: **accepted***

**Problem**

The annotation canvas needs pan/zoom, custom nodes, and precise coordinate control. The obvious premium option charges license fees; the free options differ widely in fit.

**Decision**

Use MIT-licensed React Flow. Each page/device capture gets its own coordinate plane in screenshot-natural pixels, with pages grouped in a project sidebar rather than placed on one shared infinite canvas. Pins, rectangles, and circles are custom nodes parented to the screenshot; arrows are React Flow edges with draggable endpoint nodes.

**Alternatives considered**

- *tldraw with a trial/license key* — License cost against an explicit keep-costs-low goal from the human.
- *MIT Excalidraw embed* — Sketch-oriented; weaker fit for numbered pins, metadata attachment, and pixel-exact coordinate persistence.

**Rationale**

The human picked the option and supplied the reasoning: cost. Screenshot-natural coordinates mean browser size and canvas zoom never move a target, which is what makes deep-zoom feedback trustworthy.

**Consequences**

- Annotation geometry is stored immutably in screenshot-natural pixel coordinates; adapters translate to screen space, never the reverse.
- Desktop and mobile captures are independent coordinate planes; annotations never migrate between them.
- No canvas license fees or key management.

**Provenance evidence**

Agent asked:

> Which canvas foundation should Pinata use for the live app?

Human approved:

> let's do MIT React flow, as one of my other goals was to keep costs low - rather than paying for tldraw

---

## D016 — Browserless captures screenshots and DOM manifests in one session

*2026-09-08 · phase: design · origin: **Agent proposed, human approved** · status: **accepted***

**Problem**

The screenshot and the DOM metadata manifest must come from the same layout state or pins cannot be attached to elements reliably. Self-hosting headless Chromium is operational burden the MVP does not need.

**Decision**

Use the Browserless Function API: one fresh browser session per URL and viewport, desktop and mobile at CSS-pixel scale. Each session navigates to a validated public HTTPS URL, incrementally scrolls lazy content, freezes visual animation, extracts a bounded and sanitized element manifest, and captures the final image from that same state. Maximum two concurrent captures.

**Alternatives considered**

- *A screenshot-only API such as ScreenshotOne* — Simple only if page URLs are already known and no DOM manifest is needed; it cannot extract aligned metadata in the same session.
- *Self-hosted Playwright/Chromium* — The human asked for a hosted provider with good APIs/CLIs rather than infrastructure to run.

**Rationale**

Proposed by the agent and ratified through the umbrella architecture approval (there was no standalone Browserless question — recorded honestly). The manifest is deliberately bounded: tag, role, short visible text, accessible name, structural path, document-space rectangle. It excludes HTML source, cookies, storage, form values, hidden content, and cross-origin iframe internals.

**Consequences**

- Only public absolute HTTPS targets are captured; redirects, private addresses, metadata endpoints, unsupported schemes, excessive height, and timeouts are rejected.
- DOM metadata is descriptive context attached to an immutable capture, never an executable selector or editing mechanism.
- Concurrency is capped at two to stay inside the Browserless free-tier limit.

**Provenance evidence**

Agent asked:

> Browserless rather than a screenshot-only API if "core top-level pages" means discovering navigation links. Browserless can inspect the page and capture both viewports in one browser platform. ScreenshotOne is simpler only if page URLs are already known.

Human approved:

> Approve as proposed

---

## D017 — Private Vercel Blob for images, Turso/libSQL + Drizzle for metadata

*2026-09-08 · phase: design · origin: **Agent proposed, human approved** · status: **accepted***

**Problem**

Screenshots are large binary assets and project data is relational; both need managed, Vercel-friendly homes that stay within free tiers and require no server administration.

**Decision**

Store screenshots in private Vercel Blob and everything else — projects, pages, captures, annotation geometry, DOM metadata references, threads, actor roles, share-token digests, revisions — in Turso/libSQL via Drizzle. All reads and writes pass through authorized application routes.

**Alternatives considered**

- *Neon (Postgres) instead of Turso* — Offered as an explicit option in the approval prompt; the human approved the stack as proposed. Turso is lighter and its CLI verified cleanly in readiness checks.

**Rationale**

Proposed by the agent and approved wholesale. Both services completed real write/read/delete verification during mission readiness checks before this was recorded, so the choice is evidence-backed rather than brochure-backed.

**Consequences**

- Share-token digests are stored, never the tokens themselves.
- Database triggers reject UPDATE/DELETE on founder replies, enforcing immutability below the application layer.
- Mutations use prepared queries, origin/CSRF checks, and durable rate limits.

**Provenance evidence**

Agent asked:

> Private Vercel Blob plus Turso/libSQL for screenshot assets and project/comment metadata. This is lighter than Postgres, integrates with Vercel, and has a strong CLI. An unguessable edit URL acts as a bearer capability; display names are labels, not verified identities.

Human approved:

> Approve as proposed

---

## D018 — Editor password prompt, persistent founder capability links, append-only threads

*2026-09-08 · phase: design · origin: **Agent proposed, human approved** · status: **accepted***

**Problem**

The product needs exactly two roles — Lucas as editor, recipients as founders — without a signup system. Access control has to be real (server-enforced) while staying proportionate to a friends-and-founders tool.

**Decision**

Lucas authenticates through an in-app password prompt whose credential is checked server-side against an environment secret. Founders enter through high-entropy, unguessable project links that act as bearer capabilities and persist until Lucas rotates or revokes them. Threads are chronological and append-only: founders reply as `founder`, Lucas appends follow-ups, and founder replies are immutable for everyone — no update/delete endpoint exists for them.

**Alternatives considered**

- *Browser HTTP Basic prompt or Vercel deployment protection* — Basic auth is hostile to demo and to founders; deployment protection would lock founders out entirely.
- *Founder links that expire after 30 days or are one-per-recipient* — The human chose persistence-until-rotation; expiry adds a renewal flow the MVP does not need.

**Rationale**

Two separate approval questions, answered directly by the human. Immutability of founder replies is the trust mechanism: feedback history cannot be rewritten by either side, which makes the tool safe to point at someone's product.

**Consequences**

- Founder view is read/reply only: founders cannot create, move, edit, or delete annotations.
- Link rotation and revocation are first-class operations, not admin chores.
- Server-enforced least privilege for both roles; display names are labels, not identities.

**Provenance evidence**

Agent asked:

> When you said "env secrets basic auth," which Lucas login experience do you want? [...] How should shared founder links behave over time?

Human approved:

> we will store password as an env credential and it'll be enforced on the front end with a prompt [...] Persist until Lucas rotates/revokes

---

## D019 — Standardize on Node 24 across app, CI, and Vercel

*2026-09-08 · phase: setup · origin: **Agent proposed, human approved** · status: **accepted***

**Problem**

The scaffold was built on Node 20, Vercel deploys run Node 24, and the local machine drifted to Node 25 — under which `node --test test/` already broke once (Session 02). Three runtimes is a standing source of works-here failures.

**Decision**

Standardize the application, CI, and repository documentation on Node 24, matching Vercel.

**Alternatives considered**

- *Node 20, matching the scaffold* — Would require downgrading Vercel and fighting the platform default.

**Rationale**

Proposed by the agent with an explicit recommendation; the human's answer was a delegation ("i defer to you") rather than a picked option, and it is recorded as approval-by-deferral for honesty. The recommendation stood because it removes a drift axis that had already produced a real failure.

**Consequences**

- README and CI pin Node 24 once the product stack lands.
- The Node 25 `node --test` directory-form breakage (Session 02) stays fixed via the explicit glob, which behaves identically on Node 24.

**Provenance evidence**

Agent asked:

> Which Node runtime should the application, CI, and Vercel standardize on? [...] I recommend standardizing the new app, CI, and repository on Node 24 rather than downgrading Vercel. This supersedes the scaffold's pre-product runtime choice.

Human approved:

> i defer to you

---

## D020 — Product-stack transition: Vitest and Playwright join the single validate gate

*2026-09-08 · phase: validate · origin: **Agent proposed, human approved** · status: **accepted***

**Problem**

The zero-dependency `node:test` gate chosen in D007 cannot cover a Next.js application — no component tests, no browser flows, no typecheck. But multiplying entry points would break the single-command contract that makes the gate runnable.

**Decision**

`npm run validate` remains the single gate and grows to aggregate: ESLint plus repository integrity checks, TypeScript typecheck, Vitest suites, the deterministic docs check, the Next.js production build, and Playwright Chromium end-to-end tests. GitHub Actions runs the identical Node 24 command. The docs tooling itself stays zero-dependency, and the existing `node:test` suite keeps running until its assertions are migrated.

**Alternatives considered**

- *Keep node:test only* — Cannot typecheck TypeScript, render components, or drive a browser; the gate would go formally green while proving almost nothing about the app.
- *A second test runner or entry point alongside validate* — Forbidden by AGENTS.md section 3: one gate, or the gate stops being run.

**Rationale**

Proposed by the agent, approved by the human with the full stack named. This reverses D007's rejection of a test framework — correct at the time, when the repo was dependency-free docs tooling — while preserving D007's actual decision, the single gate.

**Consequences**

- When Milestone 1 lands dependencies, the lint rule asserting empty dependency lists must be re-scoped to protect only the docs tooling, or retired with a new decision record.
- The README validation section gets rewritten when the gate composition changes.
- User-reported escapes become contract assertions before fixes are implemented (the feedback-loops requirement).

**Provenance evidence**

Agent asked:

> For validation, I propose Vitest for unit/component/integration tests, Playwright for repeatable browser flows, and agent-browser for real user-surface validation. The milestone gate will run lint, typecheck, tests, production build, and e2e through the single `npm run validate` entry point. Workers will run narrow affected tests first, then the complete gate before handoff.

Human approved:

> Approve Vitest, Playwright, agent-browser

---

<sub>Generated from 20 record(s) as of 2026-09-08 · source `3bab0716450d`</sub>
