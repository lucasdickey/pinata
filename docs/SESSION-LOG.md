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

---

## Session 04 — 2026-09-08 — Foundation: Node 24 + Next.js + the grown-up gate

### What was attempted

1. Converted the docs-only scaffold into a Next.js App Router + TypeScript
   application under Node 24, implementing `D014`, `D019`, and `D020`:
   installed the mission-approved package set pinned exactly
   (289 packages, one `package-lock.json`), added `app/` + `src/` with a
   minimal landing page, and wired `tsconfig.json`, `next.config.ts`,
   `vitest.config.ts`, `playwright.config.ts`, and `eslint.config.js`.
2. Migrated both `node:test` suites to Vitest by changing the import source
   only — every provenance, deterministic-rendering, screenshot, dashboard,
   and relative-link assertion survives unchanged in intent. Added
   `test/home.test.tsx` to prove the Vitest + jsdom + React Testing Library
   chain, and `e2e/smoke.spec.ts` to prove Playwright Chromium against
   `next start` on `127.0.0.1:3100`.
3. Re-scoped the dependency-free lint rule into an approved pinned allowlist
   (`scripts/lib/approved-deps.mjs`, imported by both lint and the integrity
   test) and added a zero-dependency test for the docs tooling — recorded as
   `D021`, the consequence `D020` had already flagged.
4. Grew `npm run validate` to the six ordered stages (lint → typecheck →
   Vitest → docs:check → build → Playwright) and pointed GitHub Actions at
   Node 24 with `npm ci` + the identical command.

### What broke, and what it caught

- **Vitest 4 ignored the `esbuild.jsx` override.** Component tests failed to
  parse JSX ("Unexpected JSX expression") because Vitest 4 transforms through
  oxc, not esbuild. Fixed with `oxc: { jsx: { runtime: "automatic" } }` —
  after a detour through a `@ts-expect-error` that `tsc` correctly rejected as
  unused, since the `oxc` key is typed but expects an options object.
- **Playwright's cached Chromium was one build behind.** The readiness check
  had exercised chromium-1234; `@playwright/test` 1.63.0 wants 1243.
  `npx playwright install chromium` resolved it; CI installs fresh anyway.
- **The first `jq` append of D021 silently fell through to a placeholder
  branch** because of a shell-quoting typo. Caught by inspecting the temp file
  before touching the real one; redone from a heredoc JSON file.

### Elapsed

Roughly 45 minutes of mission-worker time inside the resumed Mission
(`901210d4`), plus the readiness work already counted in Session 02-03.

### Decisions and assertions

- `D021` recorded (agent-autonomous, implementing `D020`'s consequence).
- Implements `D014`, `D019`, `D020`. No new deferrals.

### Open questions at end of session

- None for the foundation. Next milestone-1 features build the `/reqs/*` hub,
  auth, and the capture pipeline on top of this gate.

## Session 05 — 2026-09-08 — Requirements hub and source-backed docs

### What was attempted

Mission feature `requirements-source-docs-and-hub` (Mission `901210d4`):
created the human-editable sources `docs/REQUIREMENTS.md`,
`docs/ARCHITECTURE.md`, `docs/MILESTONES.md`, and `docs/EVALS.md`, and the
public hub routes `/reqs`, `/reqs/architecture`, `/reqs/milestones`,
`/reqs/decisions`, and `/reqs/evals`. Markdown renders through a new
zero-dependency safe renderer (`src/lib/markdown.ts`) with raw HTML disabled,
allow-listed link targets, and unique heading anchors; the decisions page
imports `docs/decisions/decisions.json` directly. Test-first: renderer,
source-alignment, and decision-catalog tests were red before implementation
(missing modules), then green.

### What broke, and what it caught

- **The first inert-link rendering returned bare label text**, which the
  fixture could not distinguish from never-parsed text. Unsafe or malformed
  link targets now render as a marked `<span class="inert-link">` so the
  dropped navigation is visible in tests and in the page.
- **Testing Library `getByText` is stricter than intuition**: the typographic
  quotes wrapping transcript evidence and a duplicated word across card
  sections broke exact matches. Fixed in the tests with regex matchers — the
  rendering itself was correct.

### Elapsed

Roughly 50 minutes of mission-worker time.

### Decisions and assertions

- `D022` recorded (agent-autonomous): the renderer mechanism, the shared
  route/dogfood constants, and the no-second-dataset rule.
- Implements the `D020`/`D021` dependency policy; fulfills validation
  assertions `VAL-REQS-001`, `VAL-REQS-002`, `VAL-REQS-004`, `VAL-REQS-005`,
  and `VAL-REQS-006` on the local surface. Exact runtime boundary values stay
  with the validation-boundary-catalog feature (`VAL-REQS-007`).

### Open questions at end of session

- None. The deployed-SHA provenance cue (`VERCEL_GIT_COMMIT_SHA`) will show a
  real value once the deployment feature ships; locally it reads `local`.

## Session 06 — 2026-09-08 — Validation boundary catalog

Mission feature `validation-boundary-catalog` (Mission `901210d4`): created
`src/lib/boundaries/` as the single versioned source of every runtime policy
value the contract names (VAL-REQS-007) — session lifetime/renewal, URL limits
and 22 exact normalization fixtures, capture dimensions/time/bytes/attempts/
concurrency/staleness, the exact-key manifest schema, the eight-case
supported-motion matrix and tolerances, the eighteen-code capture outcome
catalog, geometry minimums, login/reply quotas, the client request timeout,
the annotation maximum, hit targets, and the performance protocol/budgets —
all re-exported under one dated `POLICY_VERSION`. Published the same values in
`docs/EVALS.md` (full catalog) and `docs/ARCHITECTURE.md` (capture/session
subset), which the `/reqs/evals` and `/reqs/architecture` routes render.

Test-first: `test/boundaries.test.ts` was red before the modules existed
(module-not-found), then red on the six documentation-publication tests until
the docs tables were written. The suite imports the exported constants,
verifies internal consistency (budgets nest, the lazy scroll covers a
maximum-height page, the total deadline fits the provider session cap), pins
the fixtures and outcome catalog, compares every constant's exact formatted
value against both docs and the rendered route HTML, and scans `src/` and
`app/` for duplicated policy literals. A Playwright spec asserts the served
pages publish the same values.

### What broke, and what it caught

- **Assumed WHATWG decodes `%7E` and uppercases percent-encodings.** Node 24's
  `URL` preserves `%7Eme` and lowercase `a%2fb` byte-for-byte, verified with a
  throwaway script before writing fixtures. The fixtures encode preservation,
  so `%7E` and `~` remain distinct page identities.
- **Thousands-grouping mismatch between test and docs.** The first doc run
  failed on `1,440 × 900` versus `1440 × 900`; the formatter now groups only
  byte/duration/pixel-cap values, and a missing `POLICY_VERSION` table row in
  EVALS.md was added.
- **`example.com.` keeps its trailing dot in WHATWG**, so stripping it is a
  deliberate policy step; the fixture and a test assertion record that this is
  intentional, not parser behavior.

### Elapsed

Roughly 45 minutes of mission-worker time (excluding an external pause).

### Decisions and assertions

- `D023` recorded (agent-autonomous): the catalog module, the chosen values,
  the docs-publication rule, and the duplicate-literal defect rule.
- Fulfills `VAL-REQS-007` on the local surface (source export, docs/route
  alignment, duplicate-literal scan). The deployed-content comparison runs
  with the deployment feature; consuming features (auth, capture, canvas,
  thread, UI, performance) must now import these constants.

### Open questions at end of session

- None. Values are defensible against the documented provider limits and
  observed Chickpea heights; any future change bumps `POLICY_VERSION` and
  updates both docs in the same commit.

## Session 07 — 2026-09-08 — Editor authentication, sessions, and the authorization boundary

### What happened

Built Lucas's password-only entry (mission feature
`editor-auth-session-and-authorization`, assertions VAL-AUTH-001 and
VAL-AUTH-010) test-first. The landing route is now the server-side boundary:
a clean browser gets the product framing plus one labeled masked password
prompt and no editor data; a verified session gets a minimal editor shell
with a keyboard-operable Sign out. `POST /api/auth/login` enforces, in
order, an exact same-origin Origin (compared against the Host header), the
`application/json` content type, the new 1,024-byte auth body cap, a strict
one-field Zod schema, and then the server-only verifier, which SHA-256-hashes
both submitted and configured passwords and compares the fixed-length
digests with `crypto.timingSafeEqual`. Success issues an HMAC-SHA256-signed
session (`pinata_editor_session`, HttpOnly, SameSite=Strict, path `/`,
`Secure` on HTTPS) plus a browser-readable `pinata_csrf` double-submit
proof. `POST /api/auth/logout` requires the session-bound `x-pinata-csrf`
header, revokes the session id in a per-process set held until absolute
expiry, and clears both cookies with matching attributes; repeat logouts are
idempotent. `GET /api/editor/session` is the first protected read behind
`requireEditor`, and renews sessions inside the 2-hour threshold with a
fresh absolute expiry. The two new boundaries
(`AUTH_REQUEST_MAX_BYTES`, `EDITOR_PASSWORD_MAX_CHARS`) joined the catalog,
which bumped `POLICY_VERSION` to 2026-09-08.2.

### What broke, and what it caught

- **Next.js normalizes `request.url`'s hostname.** The first real-server
  login returned 403: the app runs on `127.0.0.1:3100` but route handlers
  saw `http://localhost:3100/...`, so Origin (`127.0.0.1`) mismatched the
  URL host. The check now treats the Host header as the addressed authority,
  with the request URL as fallback; a regression test pins both the
  normalized-URL pass case and a poisoned-Host rejection.
- **Next.js's route announcer is a second `role="alert"`.** The first e2e
  login-denial assertion was ambiguous against `#__next-route-announcer__`;
  the spec now targets the login section's paragraph alert.
- **Local development secrets are short.** A naive e2e scan for secret
  *values* in served HTML false-positives when a local value is a common
  six-letter word. The e2e scans for secret *names* in HTML and client
  bundles (always meaningful) and proves the login response never echoes the
  submitted password; unique-sentinel value scans remain with the deployed
  cross-surface hardening feature (VAL-AUTH-002). Advisory: confirm the
  deployed `EDITOR_PASSWORD`/`SESSION_SECRET` are high-entropy before any
  public launch.

### Elapsed

Roughly 60 minutes of mission-worker time (including one external pause).

### Decisions and assertions

- `D024` recorded (agent-autonomous): fixed-length digest verification, the
  signed renewable session format, the double-submit CSRF binding, and the
  per-process logout revocation set.
- Fulfills `VAL-AUTH-001` and `VAL-AUTH-010` on the local surface: 30 unit
  tests (verifier, session lifecycle, cookies, schema, origin/transport,
  server-only source scan), 14 route-level matrix tests, the curl matrix
  against the running server, and 5 new Playwright specs all pass inside
  `npm run validate`.

### Open questions at end of session

- Cross-instance logout revocation and durable login throttling (Turso
  `rate_limit_buckets`) belong to `editor-durable-login-throttling` and
  `editor-session-lifecycle-on-protected-data`; the token format and route
  contracts are stable for them.
