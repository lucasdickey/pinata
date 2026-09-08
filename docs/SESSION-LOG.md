# Session log

Append-only. Newest section at the bottom. One section per working session.

This file records **what happened**, including dead ends. `DECISIONS.md` records
**what we chose**. Both are needed to explain the process honestly.

---

## Session 01 — 2026-09-04

**Timebox:** ~4 hours total for the assignment. Consumed this session: _in progress_.

### What happened

1. Repository created and pushed as a public GitHub repo under `lucasdickey`, named
   `pinata` — a portmanteau of **pin** + **anno**tation + at **ya**. Name and
   visibility were specified by the human. → `D001`, `D002`
2. Local `git init` produced a `master` default branch. Flagged to the human rather
   than renamed unilaterally, since the choice is cosmetic but visible on a repo
   that will be reviewed. → `D003`
3. The assignment PDF was read and transcribed into `docs/ASSIGNMENT.md`. The
   grading criterion "ability to explain your process and decisions" was identified
   as the one that shapes repository structure, since the other three are satisfied
   by the product itself.
4. The human asked for a documented decision trail with explicit provenance
   (human-requested vs agent-proposed-and-approved), a plain-text Markdown artifact
   to read afterwards, and a browser-loadable HTML view that can carry screenshots.
   → `D004`
5. Agent proposed a single-source-of-truth design — hand-edit `decisions.json`,
   generate both the Markdown log and the dashboard data island from it — to avoid
   three files drifting apart by hand. Zero dependencies, dashboard opens over
   `file://`. → `D005`
6. Product concept still open. The name implies pinned annotations, but the actual
   problem statement had not been fixed at the time the scaffolding was built, so
   the scaffolding was deliberately built concept-agnostic. → `D006`

7. Dashboard verified by rendering it in a real browser rather than by assertion:
   6 cards, 5 counters, 8 filter chips, working search. Screenshot captured and
   attached to `D004`.
8. Factory refused to start a Mission, warning that the directory was not a git
   repository and that Missions need real validation capability to QA against.
   Two faults behind one warning: `/missions` was being run from
   `~/Documents/code` rather than from `pinata/`, and the project genuinely had
   no way to distinguish a good change from a bad one. Built the validation
   contract before letting a Mission near the repo. → `D007`, `D008`

### What broke, and what it caught

- **The docs generator embedded a wall-clock timestamp.** That made a staleness
  check impossible: every build differed from the last, so `docs:check` could
  never pass. Replaced the timestamp with a SHA-256 prefix of the source plus
  the latest decision date, which are both pure functions of the input. This is
  now a standing constraint, recorded in `D007`.
- **The test suite immediately caught a real bug in code I had already shipped.**
  `anchor()` collapsed runs of whitespace into a single hyphen, but GitHub emits
  one hyphen per space and does not collapse. Any decision title containing a
  character surrounded by spaces — an em dash, an ampersand — would have
  produced an index link in `DECISIONS.md` that silently resolved to nothing.
  Fixed by making the slug rules GitHub-faithful, and pinned by a test that uses
  an independent second implementation as its oracle so the two cannot drift
  into agreeing on the wrong answer.
- **Two of the three initial test failures were bugs in the tests, not the code.**
  A `data.([a-z]+)` regex intended to find dashboard field accesses was matching
  the filename `decisions-data.js`, and the heading-slug oracle had inherited the
  same collapsing bug it was meant to detect. Worth noting because a suite that
  is wrong in the same direction as the code proves nothing.
- **A test asserting `AGENTS.md` documents the validation commands failed first,
  legitimately.** The commands existed before the contract describing them did.

Verified the gate fails as designed: with a stale generated file,
`npm run docs:check` and `npm run validate` both exit 1. Clean, `validate` exits
0 across 50 tests.

### Shipping the first chunk

9. Committed the scaffolding and the validation harness, opened PR #1, watched CI
   go green in 9s with no install step, and merged. The CI source hash matched the
   local one exactly, which is the first real evidence that generated artifacts
   are reproducible across machines rather than merely deterministic on mine.
10. Renamed the default branch `master` → `main`, answering the deferral from
    `D003`. Done as a pointer move at the same commit, so no history was
    rewritten and the SHA is unchanged. → `D009`
11. Agreed to commit straight to `main` from here on, dropping branches and PRs.
    Note what this costs: with no PR, `npm run validate` before each commit and
    CI after it are the only things between a bad change and the default branch.
    → `D010`

### A rule that had to bend

Answering `D003` exposed a contradiction in my own validator. It required
`user-deferred` records to sit at `status: pending`, and separately required any
record with a `superseded_by` pointer to be `superseded`. So an answered
deferral could not be represented at all: the schema let a question be asked or
settled, but had no way to say "this was open, and then it closed."

Relaxed `user-deferred` to allow `pending` or `superseded`, with three tests
pinning the distinction — open stays pending, `accepted` is still rejected
because it would let an unanswered question read as settled, and an answered one
must point at whatever answered it. `D003` now reads as superseded by `D009`
rather than being quietly rewritten, which is the behaviour the log is for.

### Dead ends

None abandoned. Two reversals, both recorded rather than dropped: the wall-clock
timestamp in generated output (`D007`) and the deferral status rule above.

### Open questions at end of session

- **What exactly does `pinata` do?** Still the blocker. No application code has
  been written and `src/` does not exist yet. → `D006`

---

## Session 02 — 2026-09-08

**Timebox:** ~4 hours total for the assignment. Consumed prior to this session:
not finalized in Session 01. Consumed this session: _in progress_.

### What happened

1. Session opened with a status review. Outstanding state: `src/` still empty and
   the product concept still open (`D006`), branch-rename question looking
   pending (`D003`) — though it had in fact already been answered in a
   concurrent session (`D009`), which this session only discovered at push time.
   See Session 03 for the collision.
2. The human directed that work be committed and pushed early and often —
   especially at decision points — rather than sitting uncommitted. Recorded as
   `D011` (drafted as `D009`, renumbered on merge) and folded into the
   `AGENTS.md` commit-hygiene rule.
3. The uncommitted work was inspected for anything unsuited to a public repo
   (per `D002`'s no-secrets consequence) before committing: `.claude/` is only a
   symlink into `.agents/skills/`, the skill is public vendored content, and the
   PNG is a generated brand sheet. All safe to publish.

### What broke, and what it caught

- **`npm test` broke under Node 25.** The script was `node --test test/`, which
  Node 25.6.1 treats as an entry-point module rather than a test directory and
  fails with `MODULE_NOT_FOUND`. Session 01 ran under an older Node where the
  directory form worked, so this is environment drift the gate caught the first
  time it ran on the newer runtime. Fixed by pointing the script at an explicit
  glob (`node --test test/*.test.mjs`), which behaves the same on both. All
  tests pass after the fix.

### Dead ends

None.

### Open questions at end of session

- The product concept (`D006`) remained the blocking question at the time.

---

## Session 03 — 2026-09-08

**Timebox:** ~4 hours total for the assignment. This session ran alongside a
Factory Mission, so wall-clock and agent time have diverged; see below.

### What happened

1. Asked for mission status. First answer came from the repo alone and was
   wrong in spirit: the repo showed no new commits, so it looked like nothing
   had happened. The human corrected this with the Mission session token
   (`901210d4-da5a-462c-b63b-07301719d17f`).
2. Read the Mission orchestrator transcript and its settings. The Mission
   (2026-09-06 → 2026-09-08, 34 child sessions) completed the entire planning
   phase: product brief, architecture research, live infrastructure
   verification (Vercel, Turso, Blob, Browserless), a 47-feature plan, an 83 KB
   validation contract, and 7 worker skill definitions. It then halted on
   usage-budget exhaustion in state `awaiting_input` — mid-way through
   auditing its own artifacts, before any worker executed. **No application
   code was written and nothing landed in this repository**; all artifact
   writes went to `~/.factory/missions/901210d4-…/`.
3. Extracted verbatim provenance evidence from the Mission transcript (the
   initial brief, the AskUser proposals, and the human's answers) and recorded
   the planning decisions the human had already made: the product definition
   (`D012`), the Chickpea test target (`D013`), the Next.js/Vercel stack
   (`D014`), React Flow (`D015`), Browserless (`D016`), Blob + Turso (`D017`),
   the access model (`D018`), Node 24 (`D019`), and the validation-stack
   transition (`D020`). All dated 2026-09-08, the recording date; the choices
   themselves were made during Mission planning on 2026-09-06/07, which the
   records say explicitly.
4. Rewrote the README: the placeholder "problem" section is gone; it now
   describes what Pinata is, why, for whom, and how it works, with the
   approved stack and the three-milestone plan.
5. The human directed that all commits be authored as `lucas@lucasdickey.com`.
   The local git identity had been auto-guessed as `ld@lds-Mac-mini.local`;
   repo-local config was set correctly and the unpublished commits were
   re-authored during the rebuild below.

### What broke, and what it caught

- **Two concurrent sessions recorded different decisions under the same IDs.**
  While this session was recording `D009`–`D018` locally, another session
  published `D009` (rename to main, answering `D003`) and `D010` (commit
  straight to main) to the remote. The push was correctly rejected. Resolution:
  the published IDs win (the remote is the review surface, per `D002`), the
  local commit-early record was renumbered to `D011`, and the mission-planning
  records became `D012`–`D020`. The pre-reconciliation branch survives as
  local branch `backup/pre-reconcile`. Exactly the failure `D011` exists to
  prevent: two batches of unpublished work colliding.
- **The provenance protocol forced real work.** Several Mission approvals were
  not cleanly classifiable: Browserless and Turso/Blob had no standalone
  approval question (they were ratified by the umbrella "Approve as
  proposed"), and Node 24 was answered with "i defer to you." All three are
  recorded with exactly that wording instead of being flattered into stronger
  origins. `D019`'s rationale names it approval-by-deferral.
- **`D020` surfaces a future lint conflict.** The current lint gate asserts
  the dependency lists stay empty; Milestone 1 will add dependencies, so that
  rule must be re-scoped to the docs tooling (or retired with a new record)
  when the product stack lands. Recorded as a consequence of `D020`.

### Dead ends

None abandoned. The Mission itself is paused, not dropped.

### Open questions at end of session

- Resume the Mission (`/missions` from `pinata/`) once usage limits reset;
  next action there is `foundation-docs-worker` on
  `foundation-node24-next-validation`.
