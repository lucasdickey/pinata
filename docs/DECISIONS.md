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
| Human directed | 9 | D001, D002, D004, D007, D011, D012, D013, D040, D041 |
| Agent proposed, human approved | 9 | D009, D010, D014, D015, D016, D017, D018, D019, D020 |
| Agent decided alone | 24 | D005, D006, D008, D021, D022, D023, D024, D025, D026, D027, D028, D029, D030, D031, D032, D033, D034, D035, D036, D037, D038, D039, D042, D043 |
| Raised and deferred | 1 | D003 |
| **Total** | **43** | |

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
| [D021](#d021--re-scope-the-dependency-ban-to-an-approved-pinned-allowlist-eslint-covers-js-tsc-covers-ts) | build | Re-scope the dependency ban to an approved pinned allowlist; ESLint covers JS, tsc covers TS | Agent decided alone | accepted |
| [D022](#d022--serve-reqs-from-repository-sources-with-a-zero-dependency-safe-markdown-renderer) | build | Serve /reqs from repository sources with a zero-dependency safe Markdown renderer | Agent decided alone | accepted |
| [D023](#d023--publish-one-versioned-validation-boundary-catalog-as-shared-exported-constants) | build | Publish one versioned validation boundary catalog as shared exported constants | Agent decided alone | accepted |
| [D024](#d024--verify-the-editor-password-via-fixed-length-digests-and-bind-sessions-to-a-double-submit-csrf-proof) | build | Verify the editor password via fixed-length digests and bind sessions to a double-submit CSRF proof | Agent decided alone | accepted |
| [D025](#d025--persist-the-canonical-model-in-committed-drizzle-migrations-with-database-enforced-thread-immutability-and-injectable-provider-seams) | build | Persist the canonical model in committed Drizzle migrations with database-enforced thread immutability and injectable provider seams | Agent decided alone | accepted |
| [D026](#d026--throttle-editor-logins-with-one-durable-digested-global-bucket-and-check-secrets-fail-closed-before-verification) | build | Throttle editor logins with one durable digested global bucket and check secrets fail-closed before verification | Agent decided alone | accepted |
| [D027](#d027--env-dependent-tests-skip-rather-than-fail-so-the-ci-gate-needs-no-repository-secrets) | build | Env-dependent tests skip rather than fail, so the CI gate needs no repository secrets | Agent decided alone | accepted |
| [D028](#d028--projects-take-an-explicit-url-array-admission-is-a-synchronous-network-free-normalizer) | build | Projects take an explicit URL array; admission is a synchronous, network-free normalizer | Agent decided alone | accepted |
| [D029](#d029--a-project-its-pages-and-two-pending-capture-attempts-per-page-are-created-in-one-transaction-keyed-for-idempotent-retry) | build | A project, its pages, and two pending capture attempts per page are created in one transaction, keyed for idempotent retry | Agent decided alone | accepted |
| [D030](#d030--the-active-capture-is-the-highest-numbered-ready-attempt-and-staleness-is-computed-at-read-time) | build | The active capture is the highest-numbered ready attempt, and staleness is computed at read time | Agent decided alone | accepted |
| [D031](#d031--retry-is-scoped-to-one-page-and-one-viewport-keyed-to-that-exact-target) | build | Retry is scoped to one page and one viewport, keyed to that exact target | Agent decided alone | accepted |
| [D032](#d032--capture-admission-is-two-defences-a-bounded-server-side-check-and-an-in-function-request-guard) | build | Capture admission is two defences: a bounded server-side check and an in-function request guard | Agent decided alone | accepted |
| [D033](#d033--dns-admission-fails-closed-on-any-ambiguity-and-one-non-public-answer-rejects-the-host) | build | DNS admission fails closed on any ambiguity, and one non-public answer rejects the host | Agent decided alone | accepted |
| [D034](#d034--capture-screenshots-are-png-and-only-png-or-webp-may-ever-be-stored) | build | Capture screenshots are PNG, and only PNG or WebP may ever be stored | Agent decided alone | accepted |
| [D035](#d035--dispatch-admits-captures-and-finalizes-in-one-request-there-is-no-claim-endpoint) | build | Dispatch admits, captures, and finalizes in one request; there is no claim endpoint | Agent decided alone | accepted |
| [D036](#d036--browserless-is-authenticated-with-http-basic-because-bearer-fails-and-the-url-is-not-an-option) | build | Browserless is authenticated with HTTP basic, because bearer fails and the URL is not an option | Agent decided alone | accepted |
| [D037](#d037--controlled-capture-fixtures-live-in-the-repository-and-are-published-to-a-disposable-public-host-per-run) | validate | Controlled capture fixtures live in the repository and are published to a disposable public host per run | Agent decided alone | superseded |
| [D038](#d038--the-dom-manifest-is-bounded-twice-in-page-for-response-size-server-side-for-what-is-persisted) | build | The DOM manifest is bounded twice: in-page for response size, server-side for what is persisted | Agent decided alone | accepted |
| [D039](#d039--track-a-known-orphan-object-in-its-own-bounded-table-never-by-rewriting-the-terminal-capture-row) | build | Track a known orphan object in its own bounded table, never by rewriting the terminal capture row | Agent decided alone | accepted |
| [D040](#d040--publish-capture-fixtures-to-a-dedicated-public-vercel-blob-store) | validate | Publish capture fixtures to a dedicated public Vercel Blob store | Human directed | superseded |
| [D041](#d041--capture-fixtures-are-served-by-a-separate-unprotected-static-vercel-project) | validate | Capture fixtures are served by a separate unprotected static Vercel project | Human directed | accepted |
| [D042](#d042--browserless-concurrency-is-a-durable-two-slot-lease-table-the-editor-polls-the-hierarchy-on-a-published-backoff-schedule) | build | Browserless concurrency is a durable two-slot lease table; the editor polls the hierarchy on a published backoff schedule | Agent decided alone | accepted |
| [D043](#d043--remote-network-safety-is-proven-against-the-real-provider-with-a-two-page-fixture-split-driven-by-the-provider-kill-switch-map) | build | Remote-network safety is proven against the real provider with a two-page fixture split driven by the provider kill-switch map | Agent decided alone | accepted |

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

## D021 — Re-scope the dependency ban to an approved pinned allowlist; ESLint covers JS, tsc covers TS

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

D020's first recorded consequence: the lint rule asserting empty dependency lists contradicts the approved application stack the moment Milestone 1 installs it. ESLint also needed a scope decision, because typescript-eslint and eslint-config-next are not in the approved dependency set.

**Decision**

package.json dependencies and devDependencies are limited to the mission-approved packages at exact pinned versions, enforced by lint against the single allowlist in scripts/lib/approved-deps.mjs (imported by both the lint gate and the integrity tests so they cannot drift). The docs tooling stays zero-dependency, now enforced by a test that scripts/ and docs/dashboard import only node: builtins or relative paths. ESLint lints the JavaScript surface only; TypeScript/TSX correctness is covered by tsc --noEmit. @types/node, @types/react, and @types/react-dom are admitted as part of the approved TypeScript toolchain.

**Alternatives considered**

- *Keep the empty-dependency lint rule and exempt app code by convention* — A rule the gate enforces but the stack violates would be deleted under pressure anyway; re-scoping keeps the protection honest for the docs tooling where it matters.
- *Add typescript-eslint and eslint-config-next for full TS linting* — Both are outside the mission-approved dependency set; tsc --noEmit already covers type correctness, and the lint stage stays dependency-light.

**Rationale**

D020 explicitly deferred this re-scope to the Milestone 1 implementation, and the package set itself was approved during mission planning (D014-D017, D020). Choosing the enforcement mechanics is a mechanical choice inside an approved direction, per AGENTS.md section 4.

**Consequences**

- Adding any new package requires editing scripts/lib/approved-deps.mjs and recording a decision.
- Exact pinned versions only; npm install must run with --save-exact or the gate fails.
- npm audit reports 4 moderate findings in the drizzle-kit/esbuild toolchain (dev-only transitive deps); the automated fix is a breaking downgrade and is not applied. Recorded as a known weakness in docs/NEXT.md.
- tsconfig.json and next-env.d.ts are partially maintained by Next.js tooling; tsconfig.json must stay strict JSON so the lint JSON check keeps passing.

**Artifacts**

- `scripts/lib/approved-deps.mjs` — The single dependency allowlist imported by lint and tests
- `package.json` — The ordered six-stage validate gate and pinned approved dependencies

---

## D022 — Serve /reqs from repository sources with a zero-dependency safe Markdown renderer

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

The approved architecture requires /reqs pages backed by docs/REQUIREMENTS.md, docs/ARCHITECTURE.md, docs/MILESTONES.md, and docs/EVALS.md with raw HTML disabled, and decisions rendered directly from docs/decisions/decisions.json. But the approved dependency allowlist (D021) contains no Markdown package, and hand-copying content into JSX would create a second dataset that drifts from the sources.

**Decision**

Implement a deliberately small Markdown renderer in src/lib/markdown.ts (headings, paragraphs, flat lists, pipe tables, fenced code, blockquotes, inline code/strong/em/links) that escapes every source character it does not emit itself, allow-lists link targets to https?/root-relative/relative/anchor, renders unsafe or malformed targets as inert text, adds target=_blank rel="noopener noreferrer" plus a visible host label to external links, and makes colliding heading anchors unique with deterministic -2/-3 suffixes. The hub's route table and dogfood URL array are exported constants in src/lib/requirements.ts that pages and tests share; /reqs/decisions imports docs/decisions/decisions.json directly.

**Alternatives considered**

- *Add react-markdown or marked to the approved set* — D021 requires a decision and allowlist change for any new package; the requirements docs use a small fixed subset, so a dependency buys little and expands the supply chain the gate must protect.
- *Hand-write the hub pages as JSX duplicating the docs* — Creates the exact second-source drift the architecture forbids; VAL-REQS-002 requires source order to match the repository files.

**Rationale**

The direction (source-backed /reqs routes, raw HTML disabled, decisions from the JSON) was already fixed by the approved mission architecture; only the mechanism was open. Choosing the mechanism is a mechanical choice inside an approved direction per AGENTS.md section 4, it adds no dependencies, and it is fully reversible, so a unilateral call is safe and is labeled agent-autonomous honestly.

**Consequences**

- The supported Markdown subset is deliberately small; new document features require renderer support plus tests.
- Hostile-input behavior (raw HTML, javascript:/data:/vbscript:/protocol-relative targets, malformed links, colliding anchors) is pinned by test/requirements-markdown.test.ts.
- Any second decision dataset or duplicated dogfood URL literal is a defect caught by test/requirements-sources.test.ts and test/requirements-decisions.test.tsx.

**Artifacts**

- `src/lib/markdown.ts` — The safe renderer
- `src/lib/requirements.ts` — The shared route table and dogfood URL array

---

## D023 — Publish one versioned validation boundary catalog as shared exported constants

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

The validation contract (VAL-REQS-007 plus the auth, capture, quota, geometry, and performance assertions) requires exact versioned values for session lifetime/renewal, URL limits and normalization fixtures, capture dimensions/time/bytes/attempts/concurrency/staleness, the manifest schema, the supported-motion matrix and tolerances, the capture outcome catalog, geometry minimums, login/reply quotas, the client timeout, the annotation maximum, hit targets, and the performance protocol/budgets — before the features that consume them exist. Without a single exported source, each consuming feature would invent and duplicate its own literals, and the docs and /reqs pages would silently drift from runtime behavior.

**Decision**

Create src/lib/boundaries/ as the only source of runtime policy values: focused modules (session, url, capture, manifest, motion, outcomes, geometry, quotas, feedback, interaction, performance) re-exported under one dated POLICY_VERSION (2026-09-08.1). Choose the concrete values now: a 12-hour renewable editor session with a 2-hour renewal threshold; 32 submitted rows, 16 unique URLs, 2,048 bytes per URL; 1440×900 and 390×844 DPR-1 viewports; 16,384 px height, 25,000,000 px area, 8 MiB image, 16 MiB provider response caps; 30 s navigation, 5 s network-idle, 800 px × 24-step × 250 ms lazy scroll, and a 90 s total capture deadline inside Browserless's 120 s session cap; 5 redirect hops; 64 attempts per project; 2 active captures; a 5-minute stale age; a 500-element / 256 KiB exact-key manifest schema; an eight-case motion matrix with 1 px anchor tolerance and 0.001 masked-diff ratio; an eighteen-code outcome catalog with 256-byte public messages; 8 px minimum shapes and 16 px minimum arrows; 5 failed logins per 15 minutes and 30 replies per hour; a 15 s client request timeout; 2,000-character feedback bodies; 200 annotations per capture; 8 nearby candidates; 24 px hit targets (WCAG 2.2 AA); and the tall-capture performance protocol and budgets. Publish the same values, fixtures, and policy enums in docs/EVALS.md and docs/ARCHITECTURE.md (which the /reqs routes render), and pin all three together with test/boundaries.test.ts, which imports the exported constants, checks the docs and rendered route HTML for the exact values, and scans the application for duplicated literals.

**Alternatives considered**

- *Defer the exact numbers to each consuming feature* — VAL-REQS-007 requires published exact values before the dependent behavior lands; deferring re-creates the drift and guesswork the catalog exists to prevent, and each feature would choose in isolation.
- *Maintain the values in the docs and mirror them into code* — Two writable sources inevitably drift; instead the code exports the values once and the docs are pinned to the exports by test.

**Rationale**

The mission plan explicitly assigns defining this catalog to the validation-boundary-catalog feature, and the requirements session deliberately published policies without numbers until it landed. The values are constrained by documented provider limits (Browserless's two concurrent sessions and 120-second cap), the observed ~13,000 px Chickpea mobile page, WCAG 2.2 target-size minimums, and the approved architecture. Choosing them here is the assigned work, the choice is fully recorded, and it is reversible by editing one module, so a unilateral call is safe and is labeled agent-autonomous honestly.

**Consequences**

- Auth, capture, canvas, thread, UI, and performance features must import from src/lib/boundaries/ rather than declaring literals; the duplicate-literal scan in test/boundaries.test.ts fails otherwise.
- docs/EVALS.md and docs/ARCHITECTURE.md table rows are formatted to the drift test's conventions; changing a value requires updating the constant and the docs together.
- URL normalization is pinned by 22 exact fixtures, including the policy steps WHATWG does not perform (trailing-dot strip, fragment removal, empty-query drop) and the distinctness of %7E versus ~ and of /pricing versus /pricing/.
- Any boundary change bumps POLICY_VERSION and updates both docs in the same commit.

**Artifacts**

- `src/lib/boundaries/index.ts` — The versioned catalog entry point
- `test/boundaries.test.ts` — The source/docs/route drift guard and duplicate-literal scan
- `docs/EVALS.md` — The published boundary tables, rendered at /reqs/evals

---

## D024 — Verify the editor password via fixed-length digests and bind sessions to a double-submit CSRF proof

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

The editor login (VAL-AUTH-001, VAL-AUTH-010) needs a server-only verifier that never leaks length or timing information about EDITOR_PASSWORD, a session format that supports the catalog's absolute-expiry/renewal policy plus authoritative logout before any durable store exists, and CSRF protection for cookie-authorized mutations now that SameSite=Strict and exact Origin checks alone would leave the later mutation surface without a session-bound proof.

**Decision**

Hash both the submitted password and EDITOR_PASSWORD with SHA-256 and compare the fixed-length digests with crypto.timingSafeEqual, so empty, unequal-length, oversized, and arbitrary-Unicode input can neither throw nor bypass. Issue sessions as HMAC-SHA256-signed v1.payload.signature tokens carrying a random session id, issued-at, absolute expiry, and a random CSRF proof; renewal keeps the session id and proof and resets the absolute expiry. Bind mutations with a double-submit pair: the proof rides in a browser-readable pinata_csrf cookie and must be echoed in the x-pinata-csrf header, compared timing-safely against the session payload. Logout revokes the session id in a per-process revocation set held until the session's absolute expiry, and always clears both cookies with matching attributes. Enforce exact same-origin Origin against the Host header (Next.js normalizes request.url's hostname), the 1,024-byte auth body cap, and a strict one-field Zod schema; add AUTH_REQUEST_MAX_BYTES and EDITOR_PASSWORD_MAX_CHARS to the boundary catalog and bump POLICY_VERSION to 2026-09-08.2. Keep every secret, verifier, and cookie serializer in src/lib/server/, guarded by a test that fails if any client module imports them.

**Alternatives considered**

- *Compare plaintext passwords with timingSafeEqual after length checks* — Length checks branch on attacker input and expose the configured length; hashing to fixed-length representations first keeps one constant-time code path for every input class.
- *Rely on SameSite=Strict plus Origin checks without a CSRF token* — The contract requires a session-bound CSRF proof on authenticated mutations; the double-submit header also guards against future relaxed-same-site mistakes and subresource confusion.
- *Wait for the Turso schema feature and store sessions/revocations in the database* — Login must work before the database lands; a per-process revocation set satisfies authoritative logout within an instance now, and the durable-throttling feature can move revocation and buckets to Turso without changing the token format or the route contracts.

**Rationale**

The architecture document already directs the password prompt, timing-safe comparison, SESSION_SECRET-signed cookies, and origin/CSRF protection, so this chooses only implementation mechanics inside that approved direction — a safe agent-autonomous call. The verifier and session format were proven with 44 focused tests before the full gate ran.

**Consequences**

- Client code reads the pinata_csrf cookie and echoes it in x-pinata-csrf on every mutation; the header is compared against the session payload, not the cookie, so a stolen cookie alone cannot authorize mutations.
- Logout is authoritative per application instance; cross-instance revocation durability arrives with the durable store features (editor-durable-login-throttling, editor-session-lifecycle-on-protected-data).
- AUTH_REQUEST_MAX_BYTES (1,024 bytes) and EDITOR_PASSWORD_MAX_CHARS (256) join the versioned boundary catalog; docs/EVALS.md and docs/ARCHITECTURE.md publish them at POLICY_VERSION 2026-09-08.2.
- No client-reachable module may import src/lib/server/ or node:crypto; test/server/auth.test.ts enforces the boundary by source scan.

**Artifacts**

- `src/lib/server/auth/password.ts` — Fixed-length timing-safe verifier
- `src/lib/server/auth/session.ts` — Signed, renewable, revocable session tokens
- `src/lib/server/http.ts` — Origin, byte-cap, and generic-error boundaries
- `test/server/auth-routes.test.ts` — The login/logout/session denial matrix

---

## D025 — Persist the canonical model in committed Drizzle migrations with database-enforced thread immutability and injectable provider seams

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

Every capture, annotation, thread, sharing, and throttling feature needs one authoritative Turso/libSQL schema whose constraints (unique normalized pages, immutable capture attempts, append-only thread entries, capability digests, idempotency keys, durable rate-limit buckets) hold at the database boundary rather than by application convention, applied through committed repeatable migrations, with provider boundaries that focused tests can drive deterministically without letting mocks replace real Turso/Blob/Browserless proof.

**Decision**

Model the architecture's tables in src/lib/server/db/schema.ts (text UUID keys, epoch-ms UTC timestamps, explicit foreign keys, unique constraints, and CHECK constraints for capture variant/status, annotation kind, and thread role/label), generate committed SQL with drizzle-kit into drizzle/, and add a custom migration installing BEFORE UPDATE/DELETE triggers on thread_entries that RAISE(ABORT). Apply migrations with scripts/db-migrate.mjs (npm run db:migrate), a Node script using drizzle-orm's libSQL migrator over @libsql/client so reapplication is idempotent and credentials are never printed. Capture attempts carry a per-(page, variant) monotonic attempt number plus a unique idempotency key and a unique blob_path, so retries are new immutable rows. Add generic idempotency_keys ((scope, key) primary key plus payload digest) and digest-keyed rate_limit_buckets tables. Keep all database, Browserless, and private-Blob construction in server-only modules with dependency-injectable client/fetch/SDK seams; adapters map provider failures to bounded secret-free error codes and never cross provider URLs or tokens to callers.

**Alternatives considered**

- *drizzle-kit push or manual schema changes against Turso* — The architecture requires committed, repeatable migrations; push/manual mutation leaves no auditable artifact and cannot be replayed identically in CI or production.
- *Enforce thread append-only behavior only in application code* — VAL-THREAD-002 requires database triggers rejecting UPDATE/DELETE; application-only enforcement can be bypassed by any future code path or manual session.
- *Let thread entries carry ON DELETE CASCADE so validation cleanup can delete them* — Cascade would let an annotation hard-delete erase founder history, contradicting the immutability rule; tests instead prove triggers inside a rolled-back transaction so no immutable row is ever left behind.

**Rationale**

The architecture document already directs Turso/libSQL + Drizzle, committed migrations, the table set, digest-only capability storage, and database triggers; this record chooses only mechanics inside that approved direction (migration runner, attempt-number/idempotency columns, trigger SQL), which is safe to decide unilaterally. The schema, triggers, and provider seams were verified against the real configured Turso database and private Blob store with disposable run-scoped data and confirmed cleanup before the full gate ran.

**Consequences**

- Future schema changes flow through drizzle-kit generate plus npm run db:migrate; drizzle/meta snapshots are committed and hand edits to generated SQL are limited to appended custom statements before first application.
- Retrying a capture inserts a new row with the next attempt number; blob_path uniqueness forces a fresh private object per attempt, which capture features rely on for late-result fencing (VAL-CAPTURE-008).
- Rate-limit and idempotency callers must SHA-256 their scope + identifier into bucket/digest keys; no plaintext password or raw capability may key a row.
- Focused tests inject in-memory libSQL databases, fake fetch, and fake Blob SDKs for deterministic fault coverage; test/integration/turso.integration.test.ts runs the real-provider checks whenever the environment is present and skips otherwise.
- No client-reachable module may import src/lib/server/db or src/lib/server/providers; test/server/provider-boundaries.test.ts enforces the boundary by source scan.

**Artifacts**

- `src/lib/server/db/schema.ts` — Canonical Drizzle schema
- `drizzle/0001_thread_entries_immutable.sql` — Append-only thread triggers
- `scripts/db-migrate.mjs` — Idempotent migration runner
- `src/lib/server/providers/blob.ts` — Private Blob boundary with injectable SDK
- `test/integration/turso.integration.test.ts` — Real Turso/Blob verification with verified cleanup

---

## D026 — Throttle editor logins with one durable digested global bucket and check secrets fail-closed before verification

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

VAL-AUTH-006 requires durable editor-login throttling that holds across tabs and at least two application instances, recovers after the exact published interval, and keeps passwords and secrets out of throttle evidence, plus fail-closed behavior when either editor auth secret is missing. The contract fixes the threshold (LOGIN_MAX_FAILURES) and window (LOGIN_WINDOW_MS) but not the bucket identity, window style, throttled-response shape, or misconfiguration ordering.

**Decision**

Enforce the login throttle in the approved Turso rate_limit_buckets table as one shared bucket keyed by the SHA-256 digest of the fixed editor-login scope (never a password, secret, or client identifier), with a fixed window anchored at the first failure: failures are registered by a single atomic INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING statement that resets the window exactly at the boundary, throttled attempts receive a bounded generic 429 with a Retry-After header and never mutate or extend the window, a successful login deletes the bucket, and the route fails closed (bounded 503) when the durable store or SESSION_SECRET is unavailable. The SESSION_SECRET check runs before password verification so a misconfigured deployment answers every attempt with the identical 503 instead of becoming a password-correctness oracle. Tests and validation runs use run-scoped scopes so they never touch the production bucket.

**Alternatives considered**

- *Per-client-IP buckets keyed from x-forwarded-for / x-real-ip* — The editor credential is a single shared secret, so IP-keyed buckets let a distributed attacker keep guessing by rotating addresses, and client-supplied forwarding headers are spoofable off-platform; one global bucket is the strongest reading of the contract requirement that the same bucket hold across tabs and instances.
- *Sliding window or throttled-attempts-extend-the-window* — Only a fixed window anchored at the first failure makes 'a correct attempt succeeds immediately after the exact recovery interval' literally true; extending the window under sustained attack would make recovery unpredictable.
- *Keep the pre-existing order that verifies the password before checking SESSION_SECRET* — With SESSION_SECRET absent and EDITOR_PASSWORD present that order answers 401 to wrong passwords and 503 to the right one, leaking password correctness from a misconfigured deployment.

**Rationale**

VAL-AUTH-006 and the approved schema (D025) already direct durable, digest-keyed throttling; this record chooses only the keying scope, window semantics, response shape, and check ordering inside that approved direction, which is safe to decide unilaterally because no user-facing product direction changes. The behavior was proven against the real configured Turso database (two independent clients sharing one run-scoped bucket, digest-only readback, verified cleanup) and end to end against the local server across a process restart before the full gate ran.

**Consequences**

- Five wrong editor passwords anywhere in the world throttle all editor login attempts for up to the published 15-minute window; this deliberately trades editor availability for credential protection and is published in docs/EVALS.md.
- The login route depends on the durable store: when Turso is unreachable, login fails closed with a bounded 503 rather than allowing unaccounted attempts.
- CI environments without Turso credentials cannot exercise the login route; the e2e auth specs already require .env.local secrets and remain a local/deployed-surface check.
- Validation runs correlate durable throttle state by recomputing the SHA-256 of their run-scoped scope and must delete the row afterward; the production scope is reserved for real traffic.
- Future reply throttling (VAL-THREAD-006) should reuse registerLoginFailure-style atomic upsert semantics with its own scope.

**Artifacts**

- `src/lib/server/auth/throttle.ts` — Durable digest-keyed login throttle with atomic window reset
- `app/api/auth/login/route.ts` — Login route wiring: throttle pre-check, fail-closed secrets, failure accounting
- `test/server/login-throttle.test.ts` — Focused threshold, recovery-boundary, and digest-only bucket tests
- `test/server/auth-throttle-routes.test.ts` — Route-level throttle and fail-closed configuration matrix
- `test/integration/login-throttle.integration.test.ts` — Real Turso cross-instance proof with run-scoped cleanup

---

## D027 — Env-dependent tests skip rather than fail, so the CI gate needs no repository secrets

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

The gate is one command run in two places with different configuration. Locally .env.local supplies the editor secrets, Turso credentials, Blob token, and Browserless token; GitHub Actions holds none of them. The e2e auth specs read EDITOR_PASSWORD from .env.local and threw when it was absent, so `npm run validate` could never pass in CI. Either CI gets real secrets, or the suite has to state which parts it can prove without them.

**Decision**

Keep secrets out of CI entirely and make configuration-dependent tests skip with a name-only reason instead of failing. Playwright specs go through e2e/local-env.ts: localEnvGate([...names]) resolves each variable from the process environment first and .env.local second, reports the missing names, and the spec calls test.skip(!gate.ready, gate.reason) before reading any value through requireLocalEnvValue. No spec reads .env.local directly, and test/e2e-env-gate.test.ts enforces both that rule and the presence of the skip. This mirrors the describe.skipIf gating the Vitest integration suites already use. The unauthenticated e2e coverage — the login prompt shape, the 401 on the protected read, and the public HTML/bundle secret-name scan — stays unconditional and runs in CI.

**Alternatives considered**

- *Give the workflow real repository secrets* — It would put the editor password, session-signing key, and provider tokens into a workflow that also runs on pull requests, for no gain in what CI actually proves; the credentialed paths still need a real browser and a real deployment to be believable.
- *Split e2e into a CI subset and a local-only suite with a second command* — A second entry point breaks the rule that one command means the same thing everywhere, and it invites the local-only suite to rot unrun.
- *Have the specs fabricate a password when the environment is absent* — A test that passes against a credential nobody configured proves nothing and would report false coverage of the auth boundary.

**Rationale**

This is the gating pattern the repository already chose for the Turso and Blob integration suites, applied to Playwright, so it introduces no new direction; it is safe to decide unilaterally because it neither weakens an assertion nor changes product behavior. The skipped tests are named in the run output with the variables they need, which keeps the reduced CI coverage visible instead of silent, and no secret value reaches the workflow, the specs, or any committed file.

**Consequences**

- A green CI run proves the public and anonymous surfaces only. Editor login, Turso, Blob, and Browserless coverage comes from a local `npm run validate` with .env.local present, and from validation against the deployment — CI alone is never sufficient evidence that a credentialed path works.
- Every future env-dependent Playwright spec must gate through e2e/local-env.ts; reading .env.local directly now fails `npm test`.
- Skip reasons and gate errors may name variables but never values, keeping the no-secret-in-output rule intact even in failure output.

**Artifacts**

- `e2e/local-env.ts` — The shared Playwright environment gate: name-only reporting, process env before .env.local
- `e2e/auth.spec.ts` — Auth specs: anonymous checks unconditional, the two login checks gated
- `test/e2e-env-gate.test.ts` — Gate behavior plus the repository rule that no spec reads .env.local directly

---

## D028 — Projects take an explicit URL array; admission is a synchronous, network-free normalizer

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

A project needs more than one page, and the obvious way to get them is to crawl the root. Crawling is out of scope by product framing (the landing copy promises 'no crawling'), it turns project creation into an unbounded network operation, and it makes the page set non-deterministic. The creation boundary still has to decide, for every submitted string, whether it is a capturable destination — and it has to decide the same way every time so page identity is stable.

**Decision**

Project creation accepts exactly one required root URL plus an optional explicit array of additional URLs, and never discovers, infers, or follows a link. Every string goes through one synchronous normalizer (src/lib/url/normalize.ts) that performs no I/O: trim, byte cap, scheme check, a single WHATWG parse, https-only, no credentials, no non-443 port, trailing-dot strip, IP-literal rejection, empty-label rejection, single-label and reserved-suffix rejection, fragment dropped, empty query dropped, empty path normalized to '/'. The result is the page's identity, so two spellings that differ only by fragment collapse to one page. Every limit and every reject reason lives in the versioned boundary catalog (POLICY_VERSION 2026-09-08.3) with fixtures, and the route returns all offending rows at once as {field, index, code} without echoing the submitted text.

**Alternatives considered**

- *Crawl the root and offer discovered pages* — Contradicts the product's stated 'no crawling' promise, makes creation an unbounded network operation with its own failure and abuse surface, and yields a page set that changes between two runs against the same site.
- *Resolve DNS at admission to prove the host is public* — It makes a form submission depend on the network, is trivially defeated by rebinding between admission and capture, and duplicates the check the capture worker has to make anyway at fetch time.
- *Accept any URL and let capture fail later* — It converts a correctable typo into a persisted project with dead pages and pushes SSRF-shaped inputs deeper into the system before anything says no.

**Rationale**

This is the conservative reading of an existing product constraint rather than a new direction, so it was safe to decide unilaterally. Keeping admission synchronous and network-free means the boundary is fully testable from fixtures, the same function decides page identity and admission (so they cannot drift), and the genuinely network-dependent checks stay where they can be enforced — at capture time, against the address actually connected to.

**Consequences**

- Users must paste the pages they care about; there is no discovery affordance, and the editor UI is therefore an add/remove/reorder row list rather than a picker.
- A host that resolves to a private address still passes admission. Rebinding and redirect safety are the capture worker's job (VAL-CAPTURE-001/002), and that split is now load-bearing.
- Any change to normalization changes page identity, so it must bump POLICY_VERSION and update the fixtures and docs the drift tests compare against.

**Artifacts**

- `src/lib/url/normalize.ts` — The synchronous admission normalizer: no I/O, one parse, one reject reason per failure
- `src/lib/boundaries/url.ts` — Versioned limits, reject reasons, and the normalization fixtures the docs and tests share
- `test/url-normalization.test.ts` — 79 cases: fixtures, byte caps, hostile spellings, and page-identity collapse

---

## D029 — A project, its pages, and two pending capture attempts per page are created in one transaction, keyed for idempotent retry

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

Creating a project writes to three tables, and capture dispatch reads what it wrote. A partial write leaves a project with no pages, or pages with no attempt rows that nothing will ever pick up — states the UI cannot represent and the capture worker cannot recover from. A double-submit or a retried request after a dropped response would otherwise create a second identical project.

**Decision**

One db.transaction writes the idempotency record, the project, every page in submission order (root first), and exactly two pending capture rows per page (desktop 1440x900, mobile 390x844, DPR 1, attempt 1) — or nothing. Capture dispatch happens strictly after the transaction commits. The client sends an idempotency key per creation intent: the same key with the same canonical payload digest replays the original identities with created:false and HTTP 200, the same key with a different digest is refused with 409, and a transaction failure re-reads the idempotency record so a concurrent winner converges instead of both callers failing.

**Alternatives considered**

- *Write the rows sequentially and repair on the next read* — Repair logic has to guess which of several partial shapes it is looking at, and every reader — UI, capture worker, share links — would need the same guess.
- *Deduplicate on the payload alone, with no client key* — Two deliberate projects over the same URL set are legitimate; collapsing them silently loses user intent, and the payload alone cannot distinguish a retry from a second attempt.
- *Create the attempt rows lazily when capture first runs* — It leaves a window where a project exists with nothing queued, so a crash between creation and dispatch strands the project with no evidence that work was ever owed.

**Rationale**

Atomicity plus an explicit key is the standard shape for a create-then-dispatch boundary and introduces no product direction, so it was safe to decide unilaterally. Writing the attempt rows inside the same transaction makes 'work is owed' a durable fact rather than an in-flight intention, which is what lets the capture worker be a plain queue reader and lets partial-status reporting be a query instead of an inference.

**Consequences**

- Capture dispatch may assume every page already has exactly two pending attempt rows; it never creates them.
- Clients must generate one idempotency key per creation intent and reuse it on retry — the editor form does this and refreshes the key only after a success or a conflict.
- The variant matrix (desktop/mobile, their viewports and DPR) is fixed at creation time, so adding a variant later means a migration for existing projects, not just new code.

**Artifacts**

- `src/lib/server/projects/create.ts` — The single transaction plus replay, conflict, and concurrent-winner convergence
- `test/server/projects-create.test.ts` — Atomicity, rollback-leaves-nothing, replay identity, and lost-race convergence
- `test/integration/projects.integration.test.ts` — The same guarantees against the real Turso database, with verified cleanup

---

## D030 — The active capture is the highest-numbered ready attempt, and staleness is computed at read time

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

Attempt rows are immutable history, so a page variant can hold several of them at once: a ready one, a newer failed one, and an abandoned capturing one whose worker died. Something has to decide which version the canvas shows and when a retry is offered. Choosing by completion time would let a late result from an abandoned older attempt overwrite a newer ready capture as the default, silently rebasing every annotation bound to it. Persisting a stale flag would need a background job the deployment does not have.

**Decision**

Selection is by attempt version, never by clock: the active capture for a (page, variant) is the ready attempt with the highest attempt number, so a late old result still persists on its own row and stays addressable but can never become the default. A capturing attempt older than STALE_CAPTURE_AGE_MS computes to stale on read rather than being written, and retry is offered only when the latest attempt is terminal or computed stale and the outcome catalog does not mark that failure non-retryable. Every persisted transition is a compare-and-set on one attempt id plus its expected status, so terminal rows can never be rewritten.

**Alternatives considered**

- *Select the most recently completed attempt* — An abandoned attempt that reports back ten minutes late would displace the newer capture the user is already annotating.
- *Persist a stale flag with a sweeper job* — It needs a scheduler the Vercel deployment does not run, and a missed sweep leaves an attempt permanently unretryable.
- *Overwrite the attempt row on retry* — It destroys the image, manifest, hash, and annotation binding of the previous version, which the architecture requires to stay addressable.

**Rationale**

Version-ordered selection plus read-time staleness makes both answers pure functions of committed rows, so two readers, two instances, and a reload cannot disagree, and no background process is required. This is an implementation of the immutability rule the architecture already fixed, not a product choice, so it was safe to decide unilaterally.

**Consequences**

- A late result is never lost and never wins: it lands on its own row and appears in the version list below the newer default.
- Staleness moves with the published constant; changing STALE_CAPTURE_AGE_MS changes retryability everywhere at once with no data migration.
- Any future capture worker must transition through applyCaptureTransition, because a direct update would bypass the terminal-row fence.

**Artifacts**

- `src/lib/server/captures/status.ts` — Computed state, version-ordered selection, and retryability
- `src/lib/server/captures/transitions.ts` — Compare-and-set transitions that fence terminal rows and lost races
- `test/server/capture-status.test.ts` — Selection, staleness, and retryability boundaries

---

## D031 — Retry is scoped to one page and one viewport, keyed to that exact target

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

When one of a project eight captures fails, resubmitting the project would re-run the seven that succeeded, burn Browserless quota, and replace ready captures that already carry annotations. A retry also needs a key so a double click or a retried request after a dropped response does not schedule two captures — but a key that is not bound to its target would let the same key silently schedule a different page or viewport.

**Decision**

POST /api/pages/[pageId]/captures names exactly one page and one variant. It writes one new pending attempt for that target only, never touching a sibling page or the other viewport. The client idempotency key is recorded in the shared idempotency_keys table under a capture-retry scope with a digest of {pageId, variant}: the same key with the same target replays the one created attempt, and the same key with a different target is refused with a bounded 409. Attempts are capped per project by MAX_CAPTURE_ATTEMPTS_PER_PROJECT, and a missing page, a non-retryable state, and a quota refusal all answer with the same generic bounded message.

**Alternatives considered**

- *Retry at the project level* — It re-captures ready siblings, wastes the two-concurrent free tier, and creates new versions nobody asked for.
- *Key the retry on (page, variant) alone with no client key* — Two deliberate recaptures of the same target are legitimate; collapsing them removes the ability to recapture at all.
- *Let the key be target-free* — A reused key would then schedule work against whatever target the request happened to name, which is exactly the confusion idempotency is supposed to prevent.

**Rationale**

Scoping the mutation to the smallest addressable unit is what makes partial failure recoverable without collateral damage, and binding the key to the target keeps replay honest. Both follow directly from the approved capture model, so no product direction was decided here.

**Consequences**

- The capture worker remains a queue reader: retry, like creation, only writes pending rows and never calls a provider inline.
- A client must hold one key per retry intent and refresh it only after a success or a conflict; the workspace does this per (page, variant).
- CAPTURE_REQUEST_MAX_BYTES joins the versioned boundary catalog (POLICY_VERSION 2026-09-08.4) so the retry body cap is published like every other limit.

**Artifacts**

- `src/lib/server/captures/retry.ts` — Target-bound idempotent retry with the project attempt cap
- `app/api/pages/[pageId]/captures/route.ts` — The scoped retry endpoint and its bounded denials
- `test/integration/hierarchy.integration.test.ts` — Real-Turso proof of scoped retry, replay, conflict, and late-result fencing

---

## D032 — Capture admission is two defences: a bounded server-side check and an in-function request guard

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

Project creation admits URLs without touching the network, so a public hostname that resolves to a private address passes it. Capture then hands that hostname to Browserless, which runs in a different network from this application. A single application-side DNS check is not proof of anything the remote browser will do a moment later, and a purely remote check gives the application no bounded verdict before it spends provider quota.

**Decision**

Capture admission runs in two places. Server-side, admitCaptureTarget canonicalizes once with WHATWG URL, rejects every unsafe syntax and IP spelling, resolves a bounded CNAME chain plus A and AAAA under DNS_TIMEOUT_MS, refuses the host if any answer is non-public, then walks the redirect chain with redirect: manual, revalidating every top-level hop under the identical rules up to MAX_REDIRECT_HOPS. Only then is the attempt claimed as capturing with its requested and final public URL persisted. Inside the Browserless function, an emitted request guard revalidates every top-level navigation and aborts subresource requests to credentialed hosts, reserved hosts, non-HTTP(S)/WebSocket schemes, and IP-literal hosts, without disabling web security, TLS validation, sandboxing, or the provider blocklist.

**Alternatives considered**

- *Trust the application-side DNS check alone* — It cannot see a rebind, and the browser resolves the name again from a different network.
- *Trust the provider private-network blocklist alone* — It gives the application no bounded pre-provider verdict, so an unsafe target would still consume quota and produce an attempt with no explanation.
- *Validate only the initial URL and let the browser follow redirects* — A public first hop redirecting to 169.254.169.254 is the exact attack this boundary exists to refuse.

**Rationale**

Neither side is sufficient alone and the two fail in different directions, so running both is what makes the boundary defensible. Both sides follow from the approved architecture, so no product direction was decided here.

**Consequences**

- Rejected targets never reach a provider: dispatch fails the attempt with a catalog outcome before a Browserless client is built.
- A safe redirect chain persists both the requested and the final public URL on the claimed attempt.
- DNS_TIMEOUT_MS, MAX_CNAME_HOPS, REDIRECT_PROBE_TIMEOUT_MS, and the non-public address range catalog join the versioned boundary catalog (POLICY_VERSION 2026-09-08.5).
- POST /api/captures/[captureId]/dispatch claims an admitted attempt as capturing; the provider execution that turns it into ready lands in the following capture feature, and until then an admitted attempt reaches computed stale and stays retryable.

**Artifacts**

- `src/lib/server/captures/admission.ts` — Canonicalize, bounded DNS, and redirect-hop revalidation
- `src/lib/server/captures/guard.ts` — The emitted Browserless in-function request guard
- `app/api/captures/[captureId]/dispatch/route.ts` — Admission before any provider work

---

## D033 — DNS admission fails closed on any ambiguity, and one non-public answer rejects the host

*2026-09-08 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

A resolver can answer in more ways than yes and no. A host may return one public A record and a private AAAA record, a SERVFAIL for one family and an answer for the other, two CNAMEs, a chain that loops, or nothing at all within the budget. Treating any of those as good enough leaves a path where the browser picks the answer we did not check.

**Decision**

A host is admitted only when every answer parses as an address and every answer is public. A timeout, an ambiguous failure such as SERVFAIL or REFUSED from either family, more than one CNAME, a loop, a chain longer than MAX_CNAME_HOPS, an unparseable answer, and an empty result all reject the host. A definitive ENODATA/NXDOMAIN for one family is the one non-answer that is treated as information rather than ambiguity, so an IPv4-only host still resolves. Rejections report a bounded reason and never the resolved address.

**Alternatives considered**

- *Admit the host if any family answers publicly* — The browser may prefer the family whose answer we could not read, which is the rebinding case restated.
- *Retry ambiguous answers until one resolves* — It turns an unbounded resolver into an unbounded capture, and a determined attacker controls how long that lasts.
- *Report the matched address or range in the error* — That turns the rejection into an internal-network oracle for anyone who can submit a URL.

**Rationale**

Every rejected case is one where the application cannot state what the browser will connect to, and the cost of refusing is one retryable failed attempt. The address catalog is published as enumerated policy so the refusal is auditable without disclosing any particular answer.

**Consequences**

- A misconfigured but genuinely public host can be refused; the outcome is dns-failed, which the catalog marks retryable.
- The non-public range catalog is the single executable source for both the address classifier and the published docs, so adding a range is one catalog edit plus its published rows.

**Artifacts**

- `src/lib/server/captures/dns.ts` — Bounded, fail-closed CNAME/A/AAAA resolution
- `src/lib/net/address.ts` — Prefix-match classification against the published range catalog
- `src/lib/boundaries/network.ts` — The published DNS budget and non-public address ranges

---

## D034 — Capture screenshots are PNG, and only PNG or WebP may ever be stored

*2026-09-09 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

The capture pipeline has to decide what image format it asks Chromium for and what it will accept back. The choice is not cosmetic: the motion assertion compares two captures of one deterministic fixture pixel by pixel, and it also decides what a decoder has to be able to reject safely.

**Decision**

The published catalog gains ALLOWED_IMAGE_CONTENT_TYPES = [image/png, image/webp], and the first entry is what the capture function asks for. Only an allowlisted declared content type whose bytes decode as that same format, at exactly the document dimensions, can be stored. POLICY_VERSION moved to 2026-09-08.6.

**Alternatives considered**

- *Capture lossy WebP for smaller objects* — Lossy encoding makes two captures of an identical page differ, which is exactly what the stabilization assertion measures.
- *Accept whatever the provider returns* — A provider error page, an HTML body, or a polyglot would become a ready capture; the decoder has to gate on a closed set.

**Rationale**

This is a mechanical choice inside an already approved direction, and it is reversible: WebP stays in the allowlist so a future feature can switch the produced format without touching the validator. PNG is lossless, so the pixel-diff assertion measures the page rather than the encoder, and the structural decoder that validates it is small enough to stay dependency-free.

**Consequences**

- Screenshots are larger than a lossy encoding would be; a 1440 x 4484 fixture capture measured 188 KB, well inside the 8 MiB cap.
- Adding an image format is a five-file catalog change: the constant, both published docs, the drift test row, and POLICY_VERSION.

**Artifacts**

- `src/lib/boundaries/capture.ts` — The published image-type allowlist
- `src/lib/server/captures/image.ts` — Structural PNG/WebP validation, dimension agreement, and SHA-256

---

## D035 — Dispatch admits, captures, and finalizes in one request; there is no claim endpoint

*2026-09-09 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

Admission claimed an attempt and returned 202 with the row left in capturing, on the assumption that some later call would run the provider. That leaves a durable open claim whenever the second call never arrives, and it invites a second public endpoint whose only job is to finish someone else's claim.

**Decision**

POST /api/captures/:id/dispatch now runs the Browserless execution in the same request, immediately after dispatchCapture returns ok, and answers only once the row is ready or failed. Every exit from a claimed attempt is terminal: a missing provider credential, an untrustworthy envelope, a storage failure, and an unexpected throw all fail the row with a catalog outcome rather than leaving it capturing.

**Alternatives considered**

- *Keep 202 and add a worker or claim endpoint* — It adds a second surface that finalizes attempts it did not admit, and the open claim still exists whenever that worker is not running.
- *Leave the claim open and rely on stale-lease reconciliation* — Staleness is a five-minute recovery path for crashes, not a design for the normal case.

**Rationale**

The open claim was recorded as an open question by the previous feature, and closing it inside the existing endpoint changes no public contract beyond the success status. Deciding this unilaterally was safe because the alternative — a new endpoint — is the change that would have needed approval.

**Consequences**

- A successful dispatch response now takes as long as a real capture, which the request-level timeout budget already bounds.
- An admitted attempt can never be observed as an open capturing claim from this route, so polling only ever sees a terminal row.

**Artifacts**

- `app/api/captures/[captureId]/dispatch/route.ts` — Admit, capture, finalize, respond
- `src/lib/server/captures/execute.ts` — Every path out of a claim is terminal

---

## D036 — Browserless is authenticated with HTTP basic, because bearer fails and the URL is not an option

*2026-09-09 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

The provider documents its token as a query parameter, which this project refuses: a credential in a URL leaks into proxies, logs, and error reports. The adapter therefore sent it as a bearer credential in the Authorization header — and every real call failed. Measured against three regional endpoints, a bearer credential returns a gateway 500 while the same request with the token in the query string returns 200.

**Decision**

The adapter sends Authorization: Basic base64(token + ':') — the token as the basic username with an empty password. That form is accepted by the same gateway that rejects bearer, and it keeps the credential in the header. The fixed regional /function endpoint and the never-log rule are unchanged.

**Alternatives considered**

- *Put the token in the ?token= query string as documented* — URLs end up in proxy logs, error reports, and stack traces; a header does not.
- *Stop and treat the provider as blocked* — The provider is not blocked — one header form works, and the constraint is theirs, not the design's.

**Rationale**

This preserves the invariant that matters (the credential travels only in the Authorization header, never in a URL and never in a log) and changes only the scheme token inside that header. It was safe to decide alone because the alternative that needed judgement — a credential in the URL — was rejected, not chosen.

**Consequences**

- Provider-adapter tests assert the basic form and that the raw token appears nowhere in the header value or the URL.
- If the provider later accepts bearer, switching back is a one-line change behind browserlessAuthorization().

**Artifacts**

- `src/lib/server/providers/browserless.ts` — browserlessAuthorization(): the accepted header form

---

## D037 — Controlled capture fixtures live in the repository and are published to a disposable public host per run

*2026-09-09 · phase: validate · origin: **Agent decided alone** · status: **superseded***
*Superseded by D041.*

**Problem**

Proving device emulation, context isolation, lazy loading, and motion stabilization needs pages that Browserless can actually load, which means public HTTPS. This project's own Vercel deployments sit behind deployment protection and answer an SSO redirect, no tunnel tooling is installed, and publishing fixtures through the application's own routes would put test pages on its public surface.

**Decision**

The fixtures are versioned files in test/fixtures/capture/ (echo-v1.html, tall-motion-v1.html). scripts/publish-capture-fixtures.mjs uploads them to a disposable public host with a one-hour lifetime, refuses to print a URL unless the served bytes hash to exactly the repository bytes and arrive as text/html, and the real-provider suite reads those URLs from the environment and skips when they are absent.

**Alternatives considered**

- *Serve the fixtures from the application on Vercel* — Deployment protection blocks the provider, and disabling it to host test pages trades a real safety control for test convenience.
- *Commit the fixtures to a public branch and serve them through a CDN of raw repository files* — It requires pushing, and this worker does not push.
- *Run a tunnel to the local server* — No tunnel client is installed, and installing one puts a network-exposing daemon on the machine for a test.

**Rationale**

The repository stays the source of truth for fixture behaviour — the host only serves a byte-identical copy for the length of a run — so the assertion remains reproducible from the tree. The uploaded content is inert markup with no secrets and no application data, and it expires on its own.

**Consequences**

- The real-provider capture suite needs one publish step before it runs, and it skips rather than fails when the URLs are absent, so CI stays green.
- The tall fixture publishes one masked region: everything whose value legitimately varies between runs lives in aside#volatile, and everything outside it must be pixel-identical.

**Artifacts**

- `test/fixtures/capture/tall-motion-v1.html` — Versioned tall fixture covering the published motion matrix
- `scripts/publish-capture-fixtures.mjs` — Hash-verified publication of the repository fixtures
- `test/integration/browserless-capture.integration.test.ts` — The real Browserless proof for VAL-CAPTURE-003 and VAL-CAPTURE-004

---

## D038 — The DOM manifest is bounded twice: in-page for response size, server-side for what is persisted

*2026-09-09 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

The manifest is produced by code running in a remote sandbox against a page Pinata does not control, then crosses a network. Trusting the in-page pass alone would let a hostile or drifting page write unbounded, markup-bearing, or privacy-compromising data straight into Turso; re-fetching metadata in a second provider call would break the same-layout correlation with the screenshot.

**Decision**

The single Function API execution builds the manifest in-page with effective-visibility clipping (ancestor overflow, closed details/dialog, off-canvas, clip-path), a closed attribute allowlist, visible-text-only assembly, and deterministic vertical-stride truncation, and draws the layout nonce into the screenshot while describing it as a pinned manifest element. Server-side, result.ts enforces the exact-key schema with finite bounded numbers, then boundManifest() in src/lib/server/captures/manifest.ts re-sanitizes every string and rectangle, re-applies both caps (500 elements, 262,144 UTF-8 bytes), re-samples with the same vertical stride, adds the manifest-truncated warning when it had to drop anything, and execute.ts refuses a ready transition unless the nonce survives in the bounded manifest. POLICY_VERSION moved to 2026-09-08.7 with three new constants: MANIFEST_HINT_MAX_CHARS, MANIFEST_MAX_COMBINING_MARKS, MANIFEST_RECT_MAX_PX.

**Alternatives considered**

- *Trust the in-page bounds and persist what arrives* — The response is untrusted input; a page that finds a gap in the sandbox cleaner would land hostile content in the database and later in the UI.
- *Fail the capture when the provider manifest exceeds a cap* — The screenshot is perfectly good; dropping a whole capture over a trimmable metadata overflow makes a bounded problem fatal. Degrade-and-warn keeps the capture ready, which is what the published outcome catalog says.
- *Sample truncation by document order without vertical sorting* — Document order is not visual order on pages with positioned or multi-column content; sorting by rectangle top makes top/middle/bottom coverage a property of what the user sees.

**Rationale**

Defense in depth with distinct jobs at each layer: the page-side pass keeps the response small and does the layout-aware visibility work only a browser can do, while the server-side pass is the authority on what is persisted and can degrade rather than fail. The nonce element pinned ahead of sampled candidates makes image/manifest correlation survive worst-case truncation. This is safe to decide unilaterally: it implements the assigned feature's published assertions inside the already-approved architecture and constants discipline.

**Consequences**

- Every manifest string passes through two sanitizers; the page-side one must stay behaviorally in lockstep with sanitizeManifestString().
- Any new manifest field is a five-file catalog change plus schema, in-page, and sanitizer updates.
- A capture whose manifest loses its nonce element fails as browserless-provider rather than ready.

**Artifacts**

- `src/lib/server/captures/manifest-source.ts` — In-page visibility, sanitization, and deterministic sampling pass
- `src/lib/server/captures/manifest.ts` — Server-side bounding that gates what is persisted
- `test/fixtures/capture/manifest-v1.html` — Controlled sentinel fixture for real-provider exclusion proof

---

## D039 — Track a known orphan object in its own bounded table, never by rewriting the terminal capture row

*2026-09-09 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

Turso and Blob are not transactional. A capture can upload a private object and then lose its finalization fence — the capture row is already terminal and immutable, so it can never reference the object, which makes the object an orphan. The object must be deleted, but the delete itself can fail. VAL-CAPTURE-009 requires a known orphan to be deleted or represented by bounded cleanup state, and VAL-CAPTURE-008 forbids rewriting a terminal row to carry that state.

**Decision**

A new capture_cleanups table records exactly one known orphan per internal blob pathname, with the uploading capture id for correlation, a bounded attempts counter, a retry deadline (the new CAPTURE_CLEANUP_WINDOW_MS = 3,600,000 ms), and a last-error label — no target URL, credential, or provider URL is ever persisted. execute.ts records a cleanup row when the fenced finalization's orphan delete fails, and reconcileCaptureCleanups() deletes pending orphans (an absent object completes cleanup), retries failures inside the window, and stops incrementing past the deadline while still deleting on sight. Cleanup state lives in its own table so terminal capture rows stay untouched. POLICY_VERSION moved to 2026-09-08.8.

**Alternatives considered**

- *Record the orphan on the capture row* — The row is already terminal when the orphan exists; rewriting it to track cleanup violates the immutable-attempts invariant the whole feature rests on.
- *Best-effort delete with no tracking row* — A failed delete would leave an untracked orphan with no record that it ever existed, which is exactly the false-clean state the assertion forbids.
- *Retry the orphan delete forever* — An unbounded retry loop is unbounded work; the window bounds retry effort while the obligation to delete on sight never expires.

**Rationale**

The table makes the orphan a first-class, durable, queryable fact instead of a side effect, which is what lets a later cleanup pass prove no untracked orphan remains. Keeping it off the capture row preserves terminal immutability, and the attempts-plus-deadline shape satisfies the bounded-cleanup requirement. This is safe to decide unilaterally: it implements the assigned feature's published assertion inside the approved persistence architecture, using the existing migration tooling.

**Consequences**

- capture_cleanups gains a committed migration (0002); the schema test table list and migration count were updated.
- CAPTURE_CLEANUP_WINDOW_MS joins the versioned boundary catalog (five-file change) at POLICY_VERSION 2026-09-08.8.
- A future cleanup pass must call reconcileCaptureCleanups; the rows are the durable backlog.

**Artifacts**

- `src/lib/server/captures/cleanup.ts` — Bounded orphan-cleanup record and reconcile pass
- `src/lib/server/captures/execute.ts` — Fenced finalization now records a cleanup row on a failed orphan delete
- `test/server/capture-cleanup.test.ts` — Bounded retry, deadline, and confirm-gone behavior

---

## D040 — Publish capture fixtures to a dedicated public Vercel Blob store

*2026-09-09 · phase: validate · origin: **Human directed** · status: **superseded***
*Superseded by D041.*

**Problem**

The disposable fixture host behind D037 died: litterbox.catbox.moe began refusing every upload with HTTP 403 behind a BunkerWeb anti-bot, and the alternates were unusable (0x0.st disabled uploads, x0.at serves text/plain + nosniff so Chromium will not render it, filebin.net forces a redirect plus attachment disposition, paste.rs fails TLS from this machine, no tunnel client is installed). Every real-provider capture suite was blocked, so a durable fixture host needed a user decision.

**Decision**

Per the user's direction, publish the fixtures to a dedicated public-access Vercel Blob store. The store pinata-fixtures (store_6lu0gxibrNzwskvk) was created and connected to the pinata project's Development environment under the FIXTURE_BLOB prefix, keeping it separate from the private capture store.

**Alternatives considered**

- *A separate unprotected Vercel project serving the fixtures as static files* — Declined at the time in favour of the Blob store; later proven to be the only option of the two that can serve renderable HTML, and adopted as D041.
- *Restore catbox.moe upload access* — The 403 is IP/ASN-level anti-bot enforcement outside our control; a durable host was preferable to depending on it again.

**Rationale**

The user chose the Blob store from the options presented. On execution it proved platform-incapable: Vercel Blob force-serves every HTML-family content type with Content-Disposition: attachment, a documented anti-phishing measure ('This also prevents hosting HTML pages on Vercel Blob'). A content-type matrix probe (text/html, text/html;charset, application/xhtml+xml all attachment; only displayable types like text/plain inline) and a real Playwright Chromium navigation (page.goto aborted with 'Download is starting', the download event fired, the h1 never rendered) confirmed no upload-time override exists in @vercel/blob 2.8.0. Upload and readback otherwise worked: exact sha256 match and declared text/html.

**Consequences**

- No repository files were changed for this attempt; the empty store and its Development-only FIXTURE_BLOB_READ_WRITE_TOKEN were rolled back under D041.
- The private capture store pinata-captures and its BLOB_READ_WRITE_TOKEN were verified untouched throughout.
- Any candidate fixture host must now be probed for attachment disposition on HTML and a real browser navigation before adoption — three host choices in a row failed only at serve time.

**Provenance evidence**

Human instruction:

> Public Vercel Blob store (recommended)

**Artifacts**

- [Vercel documents the forced attachment disposition on HTML as anti-phishing](https://vercel.com/docs/vercel-blob/public-storage)

---

## D041 — Capture fixtures are served by a separate unprotected static Vercel project

*2026-09-09 · phase: validate · origin: **Human directed** · status: **accepted***
*Supersedes D040.*

**Problem**

The user's first directed durable host (D040, a public Vercel Blob store) was proven platform-incapable of serving renderable HTML — Blob forces Content-Disposition: attachment on every HTML-family content type, verified by a content-type matrix and a real Chromium navigation that downloaded instead of rendering. The real-provider fixture pipeline was still blocked and needed a re-decision.

**Decision**

Per the user's re-decision, the fixtures are served by a tiny separate Vercel project, pinata-fixtures, deploying test/fixtures/capture/ (echo-v1, tall-motion-v1, manifest-v1, links-v1) as static files with deployment protection disabled. npm run fixtures:publish ensures the project exists, disables its protection, deploys the exact repository bytes, and refuses to print a URL unless each fixture reads back as a direct 200 (no interstitial or SSO redirect), inline text/html with no attachment disposition, and a byte-exact sha256 match. The durable base URL is committed in test/fixtures/capture/host.json (public and non-secret), so fixture URLs no longer depend on a per-run host. The failed D040 store (store_6lu0gxibrNzwskvk) was deleted and .env.local re-verified to hold all required variable names afterwards. This also supersedes D037's disposable-per-run host mechanism; its fixture versioning, hash-verified readback, and environment handoff all carry forward.

**Alternatives considered**

- *Disable deployment protection on the main pinata project and host the fixtures there* — It trades a real safety control on the product surface for test convenience, and puts test pages on the application's public surface. Protection on the main project was verified unchanged (ssoProtection all_except_custom_domains).
- *Keep searching disposable hosts* — Three have now failed at serve time (catbox anti-bot 403, x0.at nosniff text/plain, filebin.net attachment redirect) and none are durable; every real-provider run would keep depending on a per-run upload.
- *Repurpose the public Blob store with non-HTML content types* — Serving HTML as text/plain makes Chromium refuse to render it; the fixture must be a page a real browser navigates to.

**Rationale**

A separate unprotected project is the one option that satisfies every constraint at once: inline text/html (plain static file serving, no forced disposition), durable public HTTPS URLs reachable from Browserless's network, zero coupling to the main project's protection, and no fixture content in the private capture Blob store. The published content is inert versioned markup with no secrets and no application data, so an unprotected static host carries no meaningful exposure.

**Consequences**

- Fixture URLs are durable: https://pinata-fixtures.vercel.app/<fixture>.html. The publish step is now an idempotent deploy plus verification instead of a per-run upload to an expiring host.
- The fixture project hosts fixtures only; capture screenshots and all product data stay in the private Blob store, and no fixture content enters it.
- The rule is now recorded for any future host candidate: probe for Content-Disposition: attachment on text/html and prove a real browser navigation renders the page before adoption.
- vercel blob delete-store silently rewrites .env.local via an env pull; after deleting store_6lu0gxibrNzwskvk the local file was re-verified to contain exactly the required variable names (the stale FIXTURE_BLOB_READ_WRITE_TOKEN line was removed).

**Provenance evidence**

Human instruction:

> Separate unprotected Vercel project

**Artifacts**

- `scripts/publish-capture-fixtures.mjs` — Idempotent deploy plus verified readback against the durable fixture project
- `test/fixtures/capture/host.json` — Committed durable base URL and per-fixture byte/hash record
- `test/fixture-host.test.mjs` — Gate-time integrity check that the committed host record matches the fixtures

---

## D042 — Browserless concurrency is a durable two-slot lease table; the editor polls the hierarchy on a published backoff schedule

*2026-09-09 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

MAX_ACTIVE_CAPTURES was a published constant with no enforcement: dispatch admitted every pending attempt immediately, so two browsers or two application instances could overlap more than two Browserless jobs, and a quota-rejected attempt had no defined state. The editor also had no way to watch an attempt finish: creation redirected to a list that showed pending/capturing rows forever until a manual reload, and a naive fixed-interval poller could spin forever on abandoned work.

**Decision**

A durable capture_leases table (migration 0003) holds exactly MAX_ACTIVE_CAPTURES slots. A dispatch claims a slot with an atomic conditional upsert that only succeeds when the slot is free or expired, so the limit holds across clients and application instances without any in-process counter. A lease expires at the published stale age (STALE_CAPTURE_AGE_MS), so an abandoned attempt becomes reclaimable at exactly the instant its row computes stale; release is conditional on the capture id, so a late release from an abandoned worker cannot free a slot a newer attempt reclaimed. A quota-rejected attempt stays pending with the catalog's quota-exceeded outcome (429 plus bounded retry guidance), resumable by any later authorized client. The editor polls the hierarchy GET on the published schedule (2 s initial, doubling to a 10 s ceiling, 10 minute deadline) and stops as soon as every attempt is terminal or computed stale; polling is read-only and can never create an attempt. The outcome catalog drives the dispatch route end to end, and two real gaps found while proving it were closed: a throwing Blob put now maps to blob-failure, and a throwing orphan delete in the fenced path now records bounded cleanup state instead of escaping as a provider error. The fixture publish readback gained a bounded retry (6 attempts, 10 s apart) so post-deploy alias propagation lag cannot fail a publish.

**Alternatives considered**

- *In-process concurrency counter per server instance* — It silently multiplies the limit by the instance count and vanishes on redeploy; the contract requires the limit across instances and resumability after redeployment.
- *Derive concurrency from capturing rows in the captures table* — A capturing row outlives its worker (crash after the claim, before execution), and fencing already treats the row as the worker's claim; overloading it with slot accounting couples quota to finalization order and cannot express expiry independently of the row.
- *Server-sent events or websockets for progress* — The hierarchy read is already the authorized, tested shape of progress; a second live channel adds a surface for a demo-scale need. Polling the existing GET with a bounded schedule carries zero new server code.

**Rationale**

Safe to decide unilaterally: the mission fixes max-2 concurrency as binding architecture, and a lease table is the smallest durable mechanism that enforces it across instances while sharing its expiry with the computed-stale boundary the state machine already publishes. The polling schedule reuses the existing authorized hierarchy read, so no new endpoint or permission shape was introduced.

**Consequences**

- Every dispatch now takes the lease claim before admission; the dispatch route answers 429 with the quota-exceeded outcome and releases the lease only after execution finalizes the row.
- capture_leases is run-state, not content: rows are deleted on release or reclaimed on expiry, and tests prove one attempt can never hold two slots.
- Three polling constants (CAPTURE_POLL_INITIAL_INTERVAL_MS, CAPTURE_POLL_MAX_INTERVAL_MS, CAPTURE_POLL_DEADLINE_MS) join the boundary catalog under POLICY_VERSION 2026-09-08.9, with the five-file change applied (catalog, EVALS, ARCHITECTURE, drift test, version).
- scripts/publish-capture-fixtures.mjs verifyReadback retries 6 times 10 s apart before failing a publish.
- Real-provider proof: the integration suite now runs three concurrent dispatches against real Turso plus Browserless and asserts exactly two overlapping executions, a pending-and-resumable third attempt resumed through a second database handle, and zero remaining leases.

**Artifacts**

- `src/lib/server/captures/leases.ts` — Durable slot claim, conditional release, and live-slot count
- `src/lib/capture-polling.ts` — Published backoff/stop polling state machine consumed by the editor
- `test/server/capture-outcomes.test.ts` — Exact 18-row outcome catalog matrix plus route-driven cases and sentinel leak scans
- `test/integration/browserless-capture.integration.test.ts` — Real-provider overlap-timestamp and pending-resume proof

---

## D043 — Remote-network safety is proven against the real provider with a two-page fixture split driven by the provider kill-switch map

*2026-09-09 · phase: build · origin: **Agent decided alone** · status: **accepted***

**Problem**

The in-function request guard and server-side admission are proven by focused tests, but neither can prove what the provider network does when a public-shaped name resolves private a moment after admission, and a naive all-in-one attack fixture (18 probes against every private destination shape) was destroyed outright by the provider: Browserless returned HTTP 400 Target closed for the whole session, so no outcome at all was provable. The safety property had to be mapped empirically before it could be asserted.

**Decision**

Map the provider enforcement boundary with bounded instrumented runs, then encode the map as two version-pinned fixtures on the durable pinata-fixtures Vercel project. remote-network-v1 (expected ready) carries the survivable matrix: RFC1918-literal fetches, image, and frame that the in-function guard aborts (recorded as bounded blocked reasons), fetches to private-resolving names (static nip.io names plus the live-alternating rbndr.us name) and through the fixture host own 302 routes into private-resolving names, WebSocket handshakes the request guard cannot see, and a worker-internal fetch. Every probe cancels its own attempt on timeout (AbortController, socket close, worker terminate, frame removal) because a silently dropped private request otherwise pends forever and keeps the page network from ever going idle, which once stalled the capture until the total deadline. Private frame probes insert only after the window load event because a connected frame delays its parent load and a dropped destination would then stall navigation itself. remote-network-hard-v1 (expected bounded safe failure with zero artifacts) carries the session-fatal literals: loopback, link-local, metadata, and both IPv6-local forms, any one of which the provider answers by destroying the browser target. The live integration suite executes both against the real provider, scans the exact persisted manifest JSON and every decoded screenshot pixel for the runtime-assembled leak marker, asserts ordinary public subresources still load, and models the post-admission DNS-change window with seeded capturing rows.

**Alternatives considered**

- *One fixture covering every destination shape in a single page* — The provider destroys the session when a page attempts a literal loopback, link-local, metadata, or IPv6-local request, even when the in-function guard aborts it first; one mixed page can therefore never produce a ready artifact, and the survivable vectors would lose their proof.
- *Mock the provider enforcement in unit tests only* — The entire risk lives in the provider network layer after admission; a mock asserts the shape of our own assumptions and could never have discovered the kill-switch, the silent-drop behavior for private-resolving names, or the WebSocket interception gap.
- *Let hanging private probes burn the per-phase timeouts* — A silently dropped request pends for the whole capture: waitForNetworkIdle never idles and the attempt dies at the total deadline with no artifact. Probe self-cancellation turns the same attack into a five-second ready capture, which is what makes the positive sentinel scan meaningful.

**Rationale**

Safe to decide unilaterally: the mission contract (VAL-CAPTURE-013) fixes the property to prove and the durable fixture host as the publication mechanism; only the empirical provider behavior was unknown, and discovering it required exactly the bounded debug runs performed. The two-page split is the smallest fixture design that matches the observed enforcement boundary without weakening any probe.

**Consequences**

- test/fixtures/capture/remote-network-v1.html and remote-network-hard-v1.html are version-pinned and immutable once published; pixel-v1.png joins the host as the public-subresource fidelity proof, and the fixture host gains two 302 redirect routes (/redirect-v1/meta, /redirect-v1/loopback) into private-resolving names.
- Provider behavior map of record (2026-09-09): literal loopback, link-local, metadata, and IPv6-local requests destroy the session; RFC1918 literals are guard-aborted and recorded; private-resolving names are fast-refused or silently dropped at the network layer; WebSocket handshakes are invisible to request interception; the DNS alternation of 7f000001.08080808.rbndr.us was observed live (6 public, 2 non-public verdicts in the recorded run).
- The integration suite treats a ready capture of any private-resolving target as a loud test failure, never as a blessed outcome.
- Fixture probes must always self-cancel: any future version that omits cancellation reintroduces the total-deadline stall.

**Artifacts**

- `test/fixtures/capture/remote-network-v1.html` — Survivable 14-probe matrix with self-canceling probes and runtime-assembled leak marker
- `test/fixtures/capture/remote-network-hard-v1.html` — Session-fatal literal destinations; expected outcome is a bounded safe failure with zero artifacts
- `test/integration/browserless-network-safety.integration.test.ts` — Real-provider proof: sentinel scans of manifest and pixels, live DNS-alternation evidence, post-admission seeded attempts, hard-fixture failure bound

---

<sub>Generated from 43 record(s) as of 2026-09-09 · source `e6790283d525`</sub>
