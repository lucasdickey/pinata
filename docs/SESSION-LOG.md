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

## Session 08 — 2026-09-08 — Turso schema, migrations, and provider boundaries

Mission feature `turso-schema-and-provider-boundaries`: establish the
canonical Drizzle/libSQL persistence model and the server-only provider seams
every later capture/annotation/thread feature builds on.

### What happened

- Wrote `src/lib/server/db/schema.ts`: projects (digest-only share
  capability), ordered pages with unique `(project_id, normalized_url)`,
  immutable capture attempts with per-`(page, variant)` attempt numbers,
  unique idempotency keys, and unique `blob_path`, annotations with
  server-numbered pins and optimistic revisions, append-only
  `thread_entries`, generic `idempotency_keys`, digest-keyed
  `rate_limit_buckets`, and `schema_meta`. CHECK constraints pin the
  architecture's variant/status/kind/role/label enumerations.
- Generated `drizzle/0000_init.sql` with drizzle-kit and added a custom
  migration installing `BEFORE UPDATE`/`BEFORE DELETE` triggers on
  `thread_entries` that `RAISE(ABORT, 'thread_entries are append-only')`.
- Added `scripts/db-migrate.mjs` (`npm run db:migrate`): applies the
  committed migrations with drizzle-orm's libSQL migrator, idempotently, and
  never prints credentials. Verified against the real configured Turso
  database (apply, reapply as no-op).
- Added server-only, dependency-injectable provider boundaries:
  `src/lib/server/db/client.ts` (env-built or injected libSQL client),
  `src/lib/server/providers/browserless.ts` (fixed SFO Function endpoint,
  Authorization-header token, response byte cap, bounded error codes), and
  `src/lib/server/providers/blob.ts` (private put/head/get/del, injectable
  SDK, pathname-only results — provider URLs never cross the seam).
- 25 focused tests (in-memory schema/constraint/trigger matrix, fake-fetch
  and fake-SDK provider outcomes, server-only source scans) and 3 real
  integration tests (Turso migrate-twice/write/read/unique/trigger/cleanup;
  private Blob put/head/get/delete with SHA-256 comparison) all pass.
  Integration tests skip silently when provider env is absent so the CI gate
  stays green without credentials.

### What broke and was fixed

- drizzle wraps libSQL errors, so constraint messages live on `error.cause`,
  not `error.message`; assertion helpers now walk the cause chain. A failed
  first integration run left one disposable run-id row chain in the real
  database; it was deleted by exact run-id prefix and absence verified before
  the rerun passed.
- `BlobNotFoundError` from `@vercel/blob` carries `name: "Error"`; the
  adapter matches the constructor name instead.
- A one-off probe confirmed the private Blob object URL returns HTTP 403
  without provider authorization.

### Elapsed

Roughly 45 minutes of mission-worker time.

### Decisions and assertions

- `D025` recorded (agent-autonomous): committed Drizzle migrations, the Node
  migration runner, database-enforced thread immutability, and the injectable
  provider seams.
- Supports the persistence half of `VAL-PROJECT-001/004`, `VAL-CAPTURE-008`,
  `VAL-THREAD-002`, `VAL-AUTH-006`, and `VAL-THREAD-006`; the endpoint-level
  assertions land with their owning features.

### Open questions at end of session

- `editor-durable-login-throttling` consumes `rate_limit_buckets`;
  `project-url-array-and-atomic-create` consumes `idempotency_keys` and the
  project/page/capture tables; capture features own the Browserless function
  source that flows through this boundary.

---

## Session: durable editor-login throttling (2026-09-08)

### What happened

- Built `src/lib/server/auth/throttle.ts`: one shared durable login bucket in
  the approved `rate_limit_buckets` table, keyed by the SHA-256 digest of the
  fixed `editor-login` scope, with a fixed window anchored at the first
  failure and an atomic `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`
  registration that resets the window exactly at the published boundary.
- Wired `POST /api/auth/login` to pre-check the durable bucket (generic 429 +
  bounded `Retry-After`), fail closed with a bounded 503 when the store or
  `SESSION_SECRET` is unavailable, register failures atomically, and clear
  the bucket on success. The session-secret check now runs before password
  verification so a misconfigured deployment cannot serve as a
  password-correctness oracle.
- The login form now shows bounded retry guidance on 429 instead of
  mislabeling it as a wrong password.
- TDD: focused unit tests (threshold, exact recovery boundary, cross-handle
  bucket sharing, digest-only rows), route tests with injected database and
  clock, and a real-Turso integration test using two independent clients and
  a run-scoped scope with verified cleanup.
- Manual HTTP proof: three wrong passwords on one dev-server process, two
  more after a full restart, then a generic 429; the real Turso bucket row
  read back as the digest key with count 5 and no credential material; the
  correct password was rejected with 429 while throttled; after clearing the
  bucket, the correct password succeeded (200). The validation bucket row was
  deleted and absence verified.

### Dead ends / surprises

- One off-by-one in a test expectation: the window anchors at the first
  failure, not at the check time; fixed the expectation, not the code.
- Pre-existing (not introduced here): the e2e auth specs require `.env.local`
  secrets, so CI without Turso/editor env cannot run them; the login route's
  new durable-store dependency inherits that limitation deliberately
  (fail-closed).

### Elapsed

Roughly 40 minutes of mission-worker time.

### Decisions and assertions

- `D026` recorded (agent-autonomous): durable digested global login bucket,
  fixed-window exact recovery, generic 429 + Retry-After, fail-closed secret
  ordering without a password oracle.
- Fulfills `VAL-AUTH-006` on the local surface with real-Turso corroboration;
  the isolated-preview missing-secret deployments remain milestone-validation
  evidence (worker does not deploy).

### Open questions at end of session

- Editor session revocation is still per-process (see `auth/session.ts`);
  cross-instance logout durability belongs to the session-lifecycle feature
  if the contract demands it.

---

## Session: keeping the CI gate green without secrets (2026-09-08)

### What happened

- The auth e2e specs read `EDITOR_PASSWORD` straight out of `.env.local` and
  threw when it was absent, so `npm run validate` could not pass in GitHub
  Actions, which holds no repository secrets. Fixed by gating rather than by
  handing CI credentials.
- Added `e2e/local-env.ts`: `localEnvGate([...names])` resolves each variable
  from the process environment first and `.env.local` second, returns the
  missing **names** and a `test.skip` reason, and `requireLocalEnvValue(name)`
  reads a value only after the gate passed. Nothing in the module can put a
  value into a message.
- `e2e/auth.spec.ts` now gates the two login checks on
  `EDITOR_PASSWORD`/`SESSION_SECRET`/`TURSO_*` and the protected-read check on
  `SESSION_SECRET`. The prompt-shape and public-bundle secret-name scans stay
  unconditional and run in CI.
- `test/e2e-env-gate.test.ts` covers the helper (missing file, quoting,
  process-env precedence, empty-as-absent, name-only reasons) and enforces the
  repository rule that no Playwright spec reads `.env.local` directly and that
  any spec using the gate actually skips on it.
- Documented the split in `AGENTS.md` section 3 and `README.md`: a green CI run
  proves the public surfaces; credentialed paths are proven by a local gate run
  with `.env.local` present and against the deployment.

### What broke, and what it caught

- The first no-secret run still failed one test: with `SESSION_SECRET` absent,
  `GET /api/editor/session` fails closed with a bounded 503, not the 401 the
  anonymous-denial test asserts. That is the route behaving correctly, so the
  test was gated on `SESSION_SECRET` rather than relaxed to accept either
  status — a denial test that accepts 503 would pass against a broken build.
- Verified the CI condition without touching `.env.local`: copied the working
  tree to a scratch directory with no env file, unset the provider variables,
  and ran the whole gate there. `npm run validate` exited 0 with three e2e
  tests skipped and eleven passed; the JSON reporter showed skip reasons
  naming only variables.

### Elapsed

Roughly 30 minutes of mission-worker time.

### Decisions and assertions

- `D027` recorded (agent-autonomous): env-dependent tests skip rather than
  fail, so the gate needs no repository secrets; the reduced CI coverage is
  stated rather than implied.
- No contract assertion changed. `VAL-AUTH-001` coverage is unchanged where the
  environment is configured — the same specs run and pass locally.

### Open questions at end of session

- Deployed-surface auth validation (`VAL-AUTH-002`) still needs a real run
  against the Vercel deployment; CI cannot stand in for it, and now says so.

## Session — project creation from an explicit URL array, written atomically

### What was attempted

Mission feature `project-url-array-and-atomic-create`: turn one required root
URL plus an optional explicit list of additional URLs into a project, its
unique pages, and the capture work owed for them — in one transaction, before
anything is dispatched — with an editor UI that can be driven entirely from the
keyboard. Assertions `VAL-PROJECT-001`, `VAL-PROJECT-002`, `VAL-PROJECT-006`.

### What landed

- `src/lib/url/normalize.ts`: the synchronous, network-free admission
  normalizer. One WHATWG parse, https-only, no credentials, no non-443 port, no
  IP literals, no single-label or reserved-suffix hosts, fragment dropped. Its
  output *is* page identity, so `/pricing#plans` and `/pricing` are one page.
- `src/lib/server/projects/{submission,create,read,schemas}.ts`: row-level
  validation that reports every bad row at once as `{field, index, code}`, a
  canonical payload digest, one `db.transaction` writing the idempotency
  record, the project, the ordered pages, and exactly two pending capture rows
  per page, and a deterministic ordered read for the editor list.
- `app/api/projects/route.ts`: POST/GET behind origin, session, CSRF, content
  type, byte cap, and strict schema; 422 with bounded codes, 409 on a reused
  key with a different payload, 200 on a true replay, 405 on other verbs.
- `src/components/project-create-form.tsx` and a rewritten `editor-home.tsx`:
  add/remove/reorder rows with named controls (`Move URL 3 up`, `Remove URL 2`),
  focus moved deliberately after each mutation, per-row `aria-invalid` plus
  `role="alert"`, Cancel that posts nothing, one idempotency key per intent.
- Boundary catalog bumped to `2026-09-08.3` with the new limits, the
  `not-public` and `too-long` reject reasons, and eight new fixtures; `EVALS.md`
  and `ARCHITECTURE.md` regenerated against them.

### What broke, and what it caught

- The first race test could not run at all: an in-memory libSQL client is a
  single connection, so two overlapping transactions raised `TRANSACTION_ACTIVE`,
  and moving to a file-backed SQLite database only traded that for both racers
  getting `SQLITE_BUSY`. Neither reproduces Turso's semantics. The unit test was
  replaced with a deterministic simulation of losing the race — a proxy that
  commits the winner inside the loser's transaction call — and real concurrency
  is proven in the Turso integration suite instead.
- Two component tests failed for reasons worth keeping: RTL's automatic cleanup
  is not registered when Vitest runs without globals (fixed with an explicit
  `cleanup()`), and a visually-hidden label rendered the accessible name as
  `"Move upURL 2"`, which is exactly what a screen-reader user would have heard.
  The buttons now carry explicit `aria-label`s.
- `https:///pricing` was expected to be rejected as malformed and came back as
  `not-public`: WHATWG parses it with `pricing` as the host. The expectation was
  wrong, and the case exposed a real gap — empty host labels (`.com`, `a..b`)
  are now rejected explicitly.
- Playwright's request context sends no `Origin` header, so the API half of the
  e2e spec got a 403 from a route that is correct to demand one. The spec now
  sends the page's own origin, which is what a real browser fetch does.

### Verification beyond the gate

- Denial matrix by curl against `127.0.0.1:3100`: 401 anonymous, 403 without
  CSRF, 403 cross-origin, 415 wrong content type, 400 unknown field, 405 on
  PUT/DELETE. Then 422 with per-row codes, 201 create, 200 identical replay,
  409 conflicting reuse, 200 list.
- Inspected the real Turso rows after the create: pages in submission order
  with the root first, two `pending` captures each. Deleted every row this
  session created and re-queried to confirm.
- `e2e/projects.spec.ts` drives the whole flow in Chromium against the
  production build and the real database, then deletes its own run-scoped rows
  and asserts the store is clean.

### Elapsed

Roughly 2 hours of mission-worker time.

### Decisions and assertions

- `D028` (agent-autonomous): explicit URL array, never crawl; admission is a
  synchronous network-free normalizer whose output is page identity.
- `D029` (agent-autonomous): project, pages, and two pending attempts per page
  in one transaction, keyed for idempotent retry.
- `VAL-PROJECT-001`, `VAL-PROJECT-002`, `VAL-PROJECT-006` are covered by unit,
  component, integration, and e2e tests.

### Open questions at end of session

- A host that resolves to a private address still passes admission by design.
  The capture worker owns that check (`VAL-CAPTURE-001/002`); until it lands,
  nothing in the system enforces it.
- The database still holds one orphan `valrun-…` project titled "validation
  run" from an earlier session's run. It was left alone rather than deleted by
  a session that did not create it.

## Session — project/page/device hierarchy and the capture-attempt status model

### What was attempted

Turn the rows project creation commits into a navigable, durable organization:
a project → page → Desktop/Mobile tree with exactly one active item, a status
model over immutable capture attempts, a retry scoped to one page and one
viewport, and deterministic version selection.

### What was built

- `src/lib/server/captures/status.ts` — the computed layer over stored attempt
  rows: `capturing` past `STALE_CAPTURE_AGE_MS` computes to stale, the active
  capture is the highest-numbered *ready* attempt, retry is offered only for a
  terminal or stale latest attempt whose outcome the catalog allows.
- `src/lib/server/captures/transitions.ts` — every persisted transition is a
  compare-and-set on one attempt id plus its expected status. Illegal pairs and
  lost races report `fenced` and write nothing.
- `src/lib/server/captures/retry.ts` + `app/api/pages/[pageId]/captures` — a
  retry that names one page and one variant, recorded under a `capture-retry`
  idempotency scope digested with `{pageId, variant}` so key reuse against
  another target is a 409 rather than a silent second capture.
- `src/lib/server/projects/hierarchy.ts` (replacing `projects/read.ts`) plus
  `GET /api/projects/[publicId]` — the whole organization read from Turso, with
  per-project counts and both devices always present.
- `src/components/project-workspace.tsx` — the tree, the one-active-item rule,
  partial statuses, the version list, and an inert screenshot stage with no
  link or frame that could navigate to the captured site.

### What broke or surprised

- The GET `/api/projects` payload changed shape (`pages[].captures` became
  `pages[].devices`), so the existing route test and `e2e/projects.spec.ts` had
  to move with it. Keeping the old shape alongside the new one would have meant
  two sources of truth for the same rows.
- Adding `CAPTURE_REQUEST_MAX_BYTES` is not free: the catalog, both published
  docs, the drift test, and `POLICY_VERSION` all move together. That friction is
  the point, but it is worth budgeting for.

### How it was verified

- Focused Vitest: status/selection/staleness, fenced transitions, scoped retry
  (replay, conflict, non-retryable, quota, unknown page), hierarchy ordering and
  ownership, the route boundary matrix, and the workspace component.
- Real Turso (`test/integration/hierarchy.integration.test.ts`): a *fresh*
  database handle — the readback a restarted process performs — returns the same
  public ID, root, normalized URLs, order, ownership, and attempts; a partial
  failure leaves ordered ready siblings usable; a scoped retry replays, conflicts
  on target reuse, and a late old result lands on its own row without becoming
  the default. Run-scoped rows deleted with verified cleanup.
- Chromium e2e drives the workspace against the production build: one active
  device, the failed variant's bounded message, a retry that touches one variant
  only, and the same versions after a hard reload.

### Elapsed

Roughly 1.5 hours of mission-worker time.

### Decisions and assertions

- `D030` (agent-autonomous): active capture is the highest-numbered ready
  attempt; staleness is computed at read time; terminal rows are fenced.
- `D031` (agent-autonomous): retry is scoped to one page and one viewport and
  keyed to that exact target.
- `VAL-PROJECT-003`, `VAL-PROJECT-004`, and `VAL-PROJECT-005` are covered on the
  local surface; the redeployment half of `VAL-PROJECT-004` waits on the
  milestone-2 deployment feature.

### Open questions at end of session

- Nothing writes `ready` yet outside tests: the capture worker that calls
  `applyCaptureTransition` for real is the next feature. Until then the stage
  shows a placeholder instead of the private screenshot, which
  `private-capture-asset-delivery` will supply.
- The orphan `valrun-…` project from an earlier session is still in the
  database; this session again left it alone.

## Session — capture admission and remote-network safety (2026-09-08)

### What was attempted

The public-HTTPS admission boundary for capture: canonicalization, bounded
DNS, redirect-hop revalidation, and the Browserless in-function request
guard, so nothing private can reach an image or a manifest
(`VAL-CAPTURE-001`, `VAL-CAPTURE-002`).

### What landed

- `src/lib/boundaries/network.ts` — `DNS_TIMEOUT_MS`, `MAX_CNAME_HOPS`,
  `REDIRECT_PROBE_TIMEOUT_MS`, and `NON_PUBLIC_ADDRESS_RANGES`: 27 IPv4 and
  IPv6 prefixes published as enumerated policy in `docs/EVALS.md`.
- `src/lib/net/address.ts` — prefix-match classification over parsed bytes, so
  compressed IPv6, embedded IPv4, and IPv4-mapped spellings cannot spell their
  way past a range. Anything that does not parse is non-public.
- `src/lib/server/captures/dns.ts` — bounded CNAME chain plus A and AAAA,
  fail-closed on timeout, ambiguous failure, loop, hop cap, empty result, or a
  single non-public answer. Results carry a count, never an address.
- `src/lib/server/captures/admission.ts` — canonicalize once, check the
  initial destination, then revalidate every top-level redirect hop under the
  identical rules up to `MAX_REDIRECT_HOPS`.
- `src/lib/server/captures/guard.ts` — the emitted in-function guard that
  revalidates navigations and refuses credentialed, reserved, non-HTTP(S), and
  IP-literal subresource destinations inside the provider sandbox.
- `src/lib/server/captures/dispatch.ts` and
  `app/api/captures/[captureId]/dispatch/route.ts` — admission strictly before
  provider work; a rejected target fails the attempt with its catalog outcome,
  a safe one claims `capturing` with both public URLs persisted.

### What broke or surprised

- Adding three constants plus a published range table moved five files again
  (catalog, both docs, the drift test rows, `POLICY_VERSION`), and the
  `POLICY_VERSION` string itself appears in prose as well as a table row in
  both documents.
- Emitting the guard as JavaScript source means it cannot import the address
  catalog, so it refuses the entire IP-literal space instead of doing address
  arithmetic remotely. That is strictly stricter and removes the duplicate
  implementation the alternative would have required; a test evaluates the
  exact emitted source and cross-checks it against the shared catalog.
- Real DNS made the rebinding case cheap to prove: `10.0.0.1.nip.io` and
  `169.254.169.254.nip.io` are genuine public names, and both are refused by
  the real resolver path rather than by a fixture.

### How it was verified

- Focused Vitest: 60 address-range cases, 52 admission cases (canonicalization
  order, CNAME chain/loop/hop cap, mixed A/AAAA answers, DNS timeout,
  ambiguous-family failure, the redirect matrix at and over the hop cap), 38
  guard cases including catalog agreement, and 19 dispatch-route cases.
- Real DNS and real HTTPS through the live adapters: `example.com` admitted,
  `www.github.com` admitted after one revalidated hop to `github.com`,
  `127.0.0.1.nip.io` / `10.0.0.1.nip.io` / `169.254.169.254.nip.io` refused as
  `dns-failed`, NXDOMAIN refused as unresolved.
- The live app on `127.0.0.1:3100` against real Turso: a run-scoped project
  dispatched four desktop attempts — two claimed `capturing` with their final
  URLs persisted, two failed as `dns-failed` with no `final_url`, no
  `blob_path`, and no `image_hash`. Anonymous, foreign-origin, and unsupported
  -method probes answered 403/401/405 with bounded generic messages. Every
  run-scoped row was deleted and its absence verified.

### Elapsed

Roughly 1 hour of mission-worker time.

### Decisions and assertions

- `D032` (agent-autonomous): admission is two defences — a bounded
  server-side check and an in-function request guard.
- `D033` (agent-autonomous): DNS admission fails closed on any ambiguity and
  one non-public answer rejects the host.
- `VAL-CAPTURE-001` and `VAL-CAPTURE-002` are covered on the local surface.
  The remote half of `VAL-CAPTURE-002` — proving the guard against live
  private-destination fixtures — belongs to `browserless-remote-network-safety`
  once images and manifests exist.

### Open questions at end of session

- An admitted attempt now sits in `capturing` until the provider step exists.
  That is a legal state with computed staleness and retry, but the next
  capture feature should call the provider immediately after
  `dispatchCapture` returns rather than leaving the claim open.

---

## Session — the standard Browserless captures, desktop and mobile (2026-09-09)

### What was attempted

The first feature that actually produces an image: one real Browserless
execution per URL and viewport, a stabilized full-page screenshot and its DOM
manifest from that single result, byte-level image validation, private Blob
storage, and a finalized `ready` row — plus the two proofs that mocks cannot
give, against controlled public fixtures.

### What was built

- `src/lib/server/captures/function-source.ts` — the ESM function the provider
  runs. It installs the request guard, emulates the device, navigates, scrolls
  in bounded steps, returns to the top, applies the published motion matrix,
  measures anchors before and after stabilization, builds the manifest, and
  takes one full-page screenshot from that same state. No target interaction
  exists anywhere in it, and a focused test greps the emitted source to keep it
  that way.
- `src/lib/server/captures/image.ts` — dependency-free PNG and WebP structural
  decoding, dimension agreement, byte caps, and SHA-256 over the exact bytes.
- `src/lib/server/captures/result.ts` — strict validation of the provider
  envelope, including the `{ data, type }` transport wrapper.
- `src/lib/server/captures/execute.ts` — the orchestration where every path out
  of a claimed attempt is terminal, and a lost finalization deletes the object
  it just wrote.
- The dispatch route now admits, captures, and finalizes in one request.

### What broke

- **Every real provider call failed with a gateway 500.** A minimal
  three-line function failed the same way, which ruled out the capture code.
  Measured across three regional endpoints: a bearer credential returns 500, a
  query-string token returns 200, and `Authorization: Basic base64(token + ':')`
  returns 200. The adapter now uses basic (`D036`) — the credential stays in a
  header and out of URLs, which was the point of the rule.
- **The provider wraps results.** A Function API response is
  `{ data, type }`; the code validated the outer object as the capture
  envelope and rejected every real success as untrustworthy.
- **Fixture hosting was a dead end three times.** A Vercel Blob public upload
  is refused on a private store; the project's own Vercel deployments answer an
  SSO redirect, so Browserless cannot load them; webhook.site serves a CSP that
  forbids scripts and workers, which is most of a motion fixture. What worked:
  keep the fixtures in the repository, publish a byte-identical copy to a
  disposable public host per run, and verify the served hash before use
  (`D037`).
- Smaller ones: the animated-GIF fixture had to be hand-encoded (two frames,
  red then blue) so the first-frame assertion has a colour to check; the
  integration cleanup missed the retry attempt because the application
  generates its own id, so it now deletes by page.

### How it was verified

- Focused Vitest: 17 image-validation cases, 37 function-source cases, 23
  execution cases, and 24 dispatch-route cases; 681 tests green overall.
- Real Browserless, real private Blob, real Turso, run `capv-mttfyuby-…`:
  - echo fixture desktop — `1440x900` document, decoded `1440x900`, own hash,
    own private object, null error;
  - echo fixture mobile — `390x844` document, decoded `390x844`, distinct
    context nonce, `cookie-sentinel: none`, `local-storage-sentinel: none`,
    `session-storage-sentinel: none`;
  - tall fixture twice — `1440x4484`, 5 scroll steps, final scroll `(0, 0)`,
    `MIDDLE-SENTINEL-LOADED` and `BOTTOM-SENTINEL-LOADED` present in both image
    and manifest, interaction counters all zero, warnings exactly
    `motion-paused:video`, `motion-unsupported-warn:canvas-js`,
    `motion-as-rendered:sticky-parallax`, animated image frozen to its red
    first frame, anchor shift `0` px, and a masked pixel-diff ratio of `0`
    against a published threshold of `0.001`.
  - Every run-scoped row and object was deleted and its absence verified.

### Elapsed

Roughly 1 hour 15 minutes of mission-worker time.

### Decisions and assertions

- `D034` (agent-autonomous): captures are PNG; only PNG or WebP may be stored.
- `D035` (agent-autonomous): dispatch admits, captures, and finalizes in one
  request — answering the open question left by the admission session.
- `D036` (agent-autonomous): Browserless is authenticated with HTTP basic.
- `D037` (agent-autonomous): controlled fixtures live in the repository and are
  published per run to a disposable public host.
- `VAL-CAPTURE-003` and `VAL-CAPTURE-004` are covered by the real-provider
  suite; `VAL-CAPTURE-014`'s image-validation half is covered by the focused
  decoder tests.

### Open questions at end of session

- The fixture host is disposable by design, so the real-provider suite needs a
  publish step before it runs and skips without one. If a later feature needs
  fixtures that outlive a run, that is a hosting decision to revisit.
- Desktop capture keeps the provider's own headless user agent rather than
  claiming a consumer browser identity. If a target serves different markup to
  headless Chrome, that is the trade to reconsider.

## Session — the bounded sanitized DOM manifest (2026-09-09)

### What was attempted

The manifest half of the capture result (`browserless-dom-manifest`,
VAL-CAPTURE-005/006): effective visibility through clipped ancestors, closed
`<details>`/menus, off-canvas drawers, and the screen-reader-only clip
patterns; visible-text-only assembly so hidden descendants cannot ride out in
a visible parent; hostile-value neutralization (controls, bidi, U+2028/2029,
stacked combining marks, nonfinite or oversized rectangles); deterministic
vertical-stride truncation under the 500-element and 256 KiB caps; and
image/manifest correlation through the layout nonce.

### What broke

- The in-page pass grew inside `function-source.ts` until the file was doing
  two jobs; the inspection pass moved to `manifest-source.ts` so the exact
  provider text can run under jsdom in `capture-manifest-page.test.ts`.
- jsdom does not decompose the `overflow` shorthand into longhands (and vice
  versa), so the clip check consults both. jsdom computes legacy `clip` as
  `auto`, so the `rect(0 0 0 0)` case is proven only by the real-browser
  fixture.
- `textContent` leaked hidden descendants and closed `<details>` panels into
  visible parents' entries; text is now assembled from visible text nodes.
- The nonce correlation check initially had no fixture support; the provider
  fakes now model the nonce entry every honest manifest carries.
- First real-provider run of the new `manifest-v1` fixture caught one fixture
  bug (the shadow host was a `<div>`, which is deliberately not a semantic
  candidate) and passed everything else, desktop and mobile.

### Elapsed

Roughly 1 hour of mission-worker time.

### Decisions and assertions

- `D038` (agent-autonomous): the manifest is bounded twice — in-page for
  response size, server-side for what is persisted — with degrade-and-warn on
  overflow instead of capture failure.
- VAL-CAPTURE-005: 28 jsdom page-source tests, 15 server-side bounding tests,
  execute-level nonce-correlation and overflow tests, and the real-provider
  run (`capv-mttgzy4b-2dd61610`: desktop 1440x2613, mobile 390x2745, 24
  elements, ~7.2 KiB manifests, landmark ink at claimed rectangles).
- VAL-CAPTURE-006: the fixture plants SENTINEL- markers in every forbidden
  source (hidden/clipped/closed content, href/src/srcset/action/formaction,
  form values, cookies, storage, script/style/template/noscript, shadow root,
  iframe title); the exact persisted JSON from the real runs contains none of
  them, and the interaction counters stayed zero.

### Open questions at end of session

- No HTTP route serves manifest JSON yet (the read surface is milestone 2
  canvas/nearby-element work), so the contract's curl sentinel scan is
  satisfied by scanning the exact persisted bytes in the integration suite
  instead. Revisit when a manifest read route exists.

---

## Session 09 — 2026-09-09

**Timebox:** capture-state, retry, and storage-faults feature. Consumed this
session: _in progress_.

### What happened

1. The capture attempt state machine, idempotency, leases, terminal
   immutability, retry/recapture version ordering, stale reconciliation, and
   late-result fencing were already landed by
   `project-hierarchy-persistence-and-partial-status` and
   `browserless-device-static-image`. The remaining feature-owned work was the
   bounded orphan-cleanup state (VAL-CAPTURE-009), the version-pinned
   link-laden no-crawl fixture (VAL-PROJECT-003), and the deterministic
   Desktop-only / Mobile-only / URL-level partial-failure integration fixtures
   (VAL-PROJECT-005).
2. Found and closed a real gap: a fenced finalization deleted the object it
   just wrote, but if that delete failed the object was orphaned with no
   cleanup record. Added the `capture_cleanups` table (migration `0002`) and
   `src/lib/server/captures/cleanup.ts` so a known orphan is recorded with a
   bounded retry window instead of being silently dropped, without rewriting
   the terminal capture row. → `D039`, `POLICY_VERSION 2026-09-08.8`.
3. Wrote `test/fixtures/capture/links-v1.html`, a self-contained fixture
   saturated with every discovery surface a crawler would follow (canonical,
   alternate, sitemap, JSON-LD, iframe, inline anchor, form action, and a
   delayed script-inserted anchor), plus ordinary same-origin subresources
   that must still load. Extended the real-provider integration suite with a
   no-crawl suite and a partial-failure suite.
4. **Dead end / blocker:** the disposable fixture host (`litterbox.catbox.moe`)
   began returning HTTP 403 behind a BunkerWeb anti-bot for every upload
   (node fetch and curl alike, IP/ASN-level), and the alternates are unusable:
   `0x0.st` has disabled uploads, `x0.at` serves `text/plain` + `nosniff` so
   Chromium will not render it, `filebin.net` forces a 302 +
   `Content-Disposition: attachment` (download, not render), `paste.rs` fails
   TLS from this machine, and no tunnel client (cloudflared/ngrok/tailscale)
   is installed. The new integration suites are written, typecheck, and skip
   cleanly in CI, but their real-Browserless runs could not be executed this
   session because no public HTTPS fixture URL could be published.

### What broke

- The schema migration count assertion in `db-schema.test.ts` (`2` → `3`) and
  its table list needed updating for `capture_cleanups`; the drift guard needed
  the new `CAPTURE_CLEANUP_WINDOW_MS` row.
- The publish-fixture host regression is a mission infrastructure blocker for
  any future real-provider capture run, not specific to this feature.

### Elapsed

Roughly 1 hour of mission-worker time.

### Decisions and assertions

- `D039` (agent-autonomous): a known orphan object is tracked in its own
  bounded table, never by rewriting the terminal capture row.
- VAL-CAPTURE-008: state machine, idempotency, version ordering, stale
  reconciliation, and late-result fencing verified by 80 focused tests and the
  real-Turso hierarchy suite (`valrun` runs green this session).
- VAL-CAPTURE-009: orphan-cleanup record, bounded retry, deadline, and
  confirm-gone covered by 6 new cleanup tests plus 2 new execute-fence tests;
  no false ready, no lost sibling, terminal rows untouched.
- VAL-PROJECT-005: partial-failure sibling preservation, scoped idempotent
  retry, and late-result fencing verified against real Turso by the hierarchy
  integration suite this session.
- VAL-PROJECT-003 (link-laden no-crawl) and the real-Browserless half of
  VAL-PROJECT-005: integration suites written and CI-safe but **not executed
  against the real provider** — blocked by the fixture-host 403.

### Open questions at end of session

- The disposable fixture host must be replaced or restored before any
  real-provider capture validation can run. This blocks the Browserless
  execution proof for the link-laden and partial-failure fixtures; the focused
  and real-Turso proofs for the state model are unaffected.

## Session — the durable fixture host (2026-09-09)

### What was attempted

1. Restored the blocked real-provider fixture pipeline with the user's
   re-decision: a separate unprotected static Vercel project,
   `pinata-fixtures`, serving `test/fixtures/capture/` (echo-v1,
   tall-motion-v1, manifest-v1, links-v1) over durable public HTTPS.
2. Rolled back the failed first attempt (D040): deleted the empty
   `pinata-fixtures` Blob store (`store_6lu0gxibrNzwskvk`), which triggered
   the known silent `.env.local` rewrite; re-verified the file holds exactly
   the required variable names and removed the stale
   `FIXTURE_BLOB_READ_WRITE_TOKEN` line the pull had kept. The private
   `pinata-captures` store and the main project's deployment protection
   (`ssoProtection: all_except_custom_domains`) were verified untouched.
3. Rewrote `scripts/publish-capture-fixtures.mjs`: ensures the project exists,
   disables its deployment protection through the Vercel API (all three
   protection fields confirmed null), deploys the exact repository bytes,
   resolves the production alias from the deployment record, and refuses to
   print a URL unless each fixture reads back as a direct 200, inline
   `text/html`, no attachment disposition, byte-exact sha256. The durable base
   URL is committed in `test/fixtures/capture/host.json`; the script is
   idempotent (a second run changed nothing).
4. Proved one real Browserless execution pair against the new host (run
   `capv-mttmb4cg-04ebf9d1`): echo desktop 1440×900 and mobile 390×844 both
   rendered (21 queryable manifest elements each, no download), stored
   privately, finalized in Turso, and the run's rows and Blob objects were
   verified deleted afterwards.

### What broke

- The first draft of the publish script read `orgId` from the wrong place in
  `.vercel/repo.json` (it lives under `projects[0]`), fixed before the first
  successful deploy.
- A hasty audit query assumed `idempotency_keys` has an `id` column; it does
  not. Re-ran the count against `key`: zero leftovers.

### Elapsed

Roughly 45 minutes of mission-worker time.

### Decisions and assertions

- `D040` (user-directed, superseded): publish fixtures to a dedicated public
  Vercel Blob store — recorded retroactively with the verbatim direction so
  the reversal trail is complete; proven platform-incapable (forced
  `Content-Disposition: attachment`).
- `D041` (user-directed): the separate unprotected static Vercel project,
  verbatim direction "Separate unprotected Vercel project", superseding D040
  and D037's disposable-per-run host mechanism.
- Unblocks the real-Browserless halves of `capture-state-retry-and-storage-faults`
  (VAL-PROJECT-003/005), `browserless-remote-network-safety`, and every future
  real-provider suite run.

### Open questions at end of session

- None for the fixture host. The durable URLs are committed; the publish step
  is now a re-verification rather than a per-run gamble.

## Session — real-provider proof for capture state, retry, and storage faults (2026-09-09)

### What was attempted

1. Re-ran the full real-provider integration suite against the durable
   `pinata-fixtures` host that the previous session unblocked (run
   `capv-mttmnccz-f62ba9c0`, then `capv-mttmui3q-46ec3eea`): echo
   desktop/mobile, tall-motion stabilization, manifest bounds and hostile
   exclusion, the link-laden no-crawl proof (VAL-PROJECT-003), and the
   deterministic URL-level / Desktop-only / Mobile-only partial-failure
   matrix (VAL-PROJECT-005). 30 of 30 integration tests passed; the focused
   fault suites for the state machine, retry idempotency, late-result
   fencing, Blob upload/finalization/orphan-cleanup failures
   (VAL-CAPTURE-008/009) were already green and stayed green.
2. Fixed the two latent failures the blocked first run never reached. The
   links-v1 fixture named its own linked hosts in visible hint paragraphs,
   so the "no linked host anywhere in the persisted manifest" scan could
   never pass — visible text is legitimately inert manifest data. Published
   `links-v2` (hints no longer name the hosts; the hosts now exist only in
   URL-bearing attributes the manifest never collects) through the normal
   versioned publish path; links-v1 stays published and immutable. The
   suite also seeded only the desktop attempt while asserting the
   application shape of two initial attempts per page; it now seeds the
   mobile sibling pending and proves the desktop execution neither
   disturbed nor cloned it.
3. Verified teardown: all three runs left zero run-scoped rows in Turso
   (projects/pages/captures/idempotency keys) and zero `capture_cleanups`
   rows; Blob objects were deleted by the suite's own teardown.
4. Removed the documented leftover validation project
   `valrun-mtta24to-4a6e7ff9-proj` (1 annotation, 1 capture, 1 page, 1
   project, idempotency keys) that two earlier sessions had noted but not
   owned; verified absence afterwards.
5. `npm run validate` green end to end: lint, typecheck, 741 Vitest tests
   (30 env-gated skips), docs:check, production build, 18 Playwright e2e.

### What broke

- The first `fixtures:publish` run for links-v2 failed its own readback with
  a 404: the production alias took a few seconds to pick up the new
  deployment. A re-run (the script is idempotent) passed all readbacks.
- The orphan-project delete hit a foreign-key constraint: an annotation row
  also referenced the capture. Deleting thread entries, then annotations,
  then captures/pages/project in dependency order resolved it.

### Elapsed

Roughly 40 minutes of mission-worker time.

### Decisions and assertions

- No new decision records: the fixture version bump follows the
  already-decided versioning policy (D037/D041) and the seeding change
  mirrors the existing two-initial-attempts contract (VAL-PROJECT-006).
- Real-provider evidence now exists for VAL-PROJECT-003 (link-laden page
  creates no pages or attempts beyond the submitted URL, ordinary public
  subresources load, interaction counters zero) and VAL-PROJECT-005
  (partial failure keeps successful siblings usable and ordered; same-key
  retry creates exactly one new attempt; ready siblings never resubmitted).

### Open questions at end of session

- None. The capture-state feature's remaining assertions are
  validator-surface work (browser screenshots and curl matrices run by the
  milestone validators).

## Capture quotas, outcome catalog, and polling (2026-09-09)

### What was attempted

- Gave the published max-2 Browserless limit teeth: a durable `capture_leases`
  table (migration 0003) with an atomic conditional-upsert claim per slot,
  expiry at exactly the published stale age, and an id-conditional release.
  Dispatch claims before admission; a full budget leaves the attempt pending
  and answers 429 with the quota-exceeded outcome; the route releases after
  execution finalizes the row.
- Wired the editor to poll the hierarchy GET on the published backoff
  schedule (2 s doubling to 10 s, 10 minute deadline), stopping on
  terminal/stale and never issuing anything but the read.
- Proved the exact 18-row outcome catalog end to end at the dispatch route,
  including sentinel-leak scans (provider body, stack, token, signed URL,
  internal address, source HTML) over responses and persisted rows.
- Added the real-provider concurrency proof to the Browserless integration
  suite: three concurrent dispatches, exactly two overlapping executions,
  the third pending and resumed through a second database handle, zero
  leases left held.
- Gave `verifyReadback` in the fixture publish script a bounded retry
  (6 attempts, 10 s apart) so alias propagation lag cannot fail a publish.

### What broke

- Drizzle wraps the libsql UNIQUE error, so the first idempotent-reclaim
  check missed it; the detector now scans the whole cause chain.
- The live-slot count and the reclaim predicate disagreed at the exact
  expiry instant (strict vs non-strict); both now treat the expiry instant
  as still-held, matching computed stale.
- Two real gaps in execute.ts surfaced while writing the sentinel tests: a
  throwing Blob put escaped as a provider error (now blob-failure), and a
  throwing orphan delete in the fenced path lost cleanup tracking (now
  recorded). Both fixed in place.
- React defers effect re-runs until the enclosing act completes, so one
  giant fake-timer advance only ever fires the timer already scheduled; the
  deadline test advances in 10 s steps instead.

### Elapsed

Roughly two hours of mission-worker time across two sessions.

### Decisions and assertions

- D042 (leases, polling schedule, publish readback retry).
- Evidence for VAL-CAPTURE-007 (at-limit/limit-plus-one, cross-instance
  overlap proof with timestamps, pending resume, stale-lease reconciliation)
  and VAL-CAPTURE-012 (catalog matrix, route-driven outcomes, backoff/stop
  polling, leak scans).

### Open questions at end of session

- None. Browser-surface assertions (screenshots, curl matrices) remain for
  the milestone validators.

---

## 2026-09-08/09 (late): remote-network safety proof against the real provider

### What happened

- Built the VAL-CAPTURE-013 proof: two new version-pinned fixtures on the
  durable pinata-fixtures host, a real-provider integration suite, and new
  guard/fixture unit pins. Started test-first; the naive 18-probe single-page
  fixture was destroyed by the provider (HTTP 400 "Target closed"), which
  forced an empirical mapping of the provider's private-network enforcement.
- Mapped the enforcement boundary with bounded instrumented runs: literal
  loopback/link-local/metadata/IPv6-local requests get the browser session
  destroyed even when the in-function guard aborts them; RFC1918 literals are
  guard-aborted and recorded; private-resolving names are fast-refused or
  silently dropped; WebSocket handshakes are invisible to request
  interception; a connected frame delays its parent's load event.
- Split the matrix into `remote-network-v1` (survivable, expected ready) and
  `remote-network-hard-v1` (session-fatal literals, expected bounded safe
  failure with zero artifacts), added the pixel-v1 public-subresource fixture
  and two 302 redirect routes into private-resolving names, and published all
  of it through `npm run fixtures:publish`.
- Live suite results: survivable page ready in ~9 s with all 14 probes
  blocked, 4 guard-recorded refusals, zero leak pixels in the decoded
  screenshot, zero sentinels in the persisted manifest, public subresources
  loaded; live DNS alternation observed on the rebinding name (6 public, 2
  non-public verdicts); three seeded post-admission attempts ended as bounded
  safe failures (navigation-timeout) with no artifacts; the hard page ended
  as a bounded safe failure (browserless-provider) in ~1.3 s.

### What broke

- The single-page fixture was unprovable: the provider killed the session
  before any outcome existed. Fixed by the two-page split (D043).
- After the split the survivable page still hit `total-timeout`: silently
  dropped private requests pend forever, so the page's network never idles.
  Every probe now cancels its own attempt on timeout (abort, close,
  terminate, frame removal).
- Parse-time frame insertion stalled navigation; frame probes now insert only
  after the window load event.
- The guard recorded only 2 of 4 expected literal refusals: `http:` image and
  frame destinations are swallowed by Chrome's mixed-content layer before
  request interception. Switching the literal image/frame probes to `https:`
  puts all four refusals on the guard record.

### Elapsed

Roughly two and a half hours of mission-worker time, including provider
debugging.

### Decisions and assertions

- D043 (provider kill-switch map, two-page fixture split, probe
  self-cancellation rule).
- Evidence for VAL-CAPTURE-013: no private/metadata sentinel in image or
  manifest across redirect/fetch/frame/worker/WebSocket/image vectors,
  provider safety under post-admission DNS change, preserved public
  subresources, bounded termination for every attempt.

### Open questions at end of session

- None.

## Session — authorized private capture asset delivery (2026-09-09)

### What happened

- Built the only route private screenshot bytes may leave through:
  `GET`/`HEAD` `/api/captures/<captureId>/asset`. The route verifies the live
  editor session on every request (304/206/HEAD included); the delivery
  module (`src/lib/server/captures/asset.ts`) resolves the capture through
  the project hierarchy, settles range and conditional semantics from the
  persisted record before any provider read, and revalidates fetched bytes
  against the persisted type, length, and SHA-256 before serving. Strong ETag
  is the persisted SHA-256. Every response carries `private, no-store,
  max-age=0`, `nosniff`, `Vary: Cookie`, and `Accept-Ranges: bytes`.
- TDD: `test/server/capture-asset.test.ts` went red on the missing route
  module, then green across 28 cases (exact bytes/headers, single-range 206,
  malformed/multi/suffix-range 400, unsatisfiable 416, hash conditionals
  without a provider read, identical generic denials for nonexistent and
  non-ready ids, integrity fail-closed, 405s, no pathname leakage).
- Real-provider proof: `test/integration/blob-asset.integration.test.ts`
  seeded a disposable private object plus Turso rows, verified provider
  metadata/hash, proved unauthenticated SDK access is denied, proved exact
  authorized delivery, and verified deletion of both.
- Production-build proof: `e2e/asset.spec.ts` runs the HTTP matrix through
  Playwright's request context against `next start` and drives a real
  browser: warm render (64×40 image decoded), reload, authoritative logout,
  then plain/conditional/range replays and reload/re-navigation/back all
  denied 401 with the network log showing exactly 200, 200, 401, 401 — no
  cached replay. agent-browser confirmed the anonymous surface: generic 401
  JSON, no image, no cookies.
- A literal curl pass against `next start` with a real login repeated the
  matrix (200 with byte-exact sha256, HEAD, 206, 400s, 416, 304/200,
  anonymous 401, unknown/failed 404, unsafe methods 405, logout then
  plain/conditional/range replay 401). Disposable rows/object deleted and
  verified absent.
- Boundary catalog gained `ASSET_CACHE_CONTROL`, `ASSET_VARY`,
  `ASSET_RANGE_UNIT` under `POLICY_VERSION` 2026-09-09.1 (five-file change).

### What broke

- Playwright `addCookies` rejects `url` plus `path` together; fixed by
  passing `url` only.
- `page.goForward()` after a 401 top-level navigation returned null (no
  forward traversal); the history assertion moved to a network-response log
  that proves every post-logout navigation hit the network and reauthorized.
- The first curl login attempt failed 400 because a shell-interpolated JSON
  body mangled the password; fixed by piping `JSON.stringify` output straight
  into curl so no credential value is ever expanded by the shell.

### Elapsed

Roughly one hour of mission-worker time.

### Decisions and assertions

- D044 (non-redirecting route, reauthorize-every-request, single
  explicit-start ranges, hash-as-ETag, fail-closed integrity, no-store
  everywhere).
- Evidence for VAL-CAPTURE-014 (delivery half): authorized delivery returns
  exact bytes/type/length with the SHA-256 matching the stored object, proven
  at unit, real-provider, production-build, and curl levels. The
  rotation/revocation founder matrix remains with VAL-CAPTURE-010 in
  milestone 2, which extends this same route.

### Open questions at end of session

- None.

## Session — editor project-entry states (2026-09-09)

### What happened

- Completed the authenticated project-list and project-create entry states
  (VAL-AUTH-008, VAL-AUTH-009). `EditorHome` now renders the list as one
  explicit state machine inside the named Projects region (`aria-busy` while
  loading): a `role=status` loading line, a named empty state whose single
  New project control lives inside the region as the one primary action, the
  populated workspace, and a `role=alert` failure state with a single-flight
  Try again that issues exactly one GET and is disabled while in flight.
  Sign-out renders outside the list state, and a failed background read never
  unmounts or clears an open create form.
- TDD: `test/editor-home-entry.test.tsx` went red on the missing status
  region, busy flag, and retry control, then green across five cases.
- `e2e/projects.spec.ts` gained a failure/retry test that forces the first
  list read to 500 through route interception and counts requests (one retry
  = one read, zero writes across reload), and the create test now asserts the
  project appears exactly once, the workspace is reached without manual
  route entry, and reload plus Back/Forward never add a POST.
- Moved run-scoped cleanup out of the trailing test into `test.afterAll`
  with absence assertions inside the hook, extending it to idempotency keys
  that reference the run's page ids (capture-retry keys store page ids, not
  the run id — the gap that leaked two keys per workspace test).
- Real-Turso housekeeping: the orphan project
  `valrun-mtta24to-4a6e7ff9-proj` was already absent (verified by re-query);
  twelve orphaned idempotency keys from earlier aborted runs, all referencing
  deleted pages, were deleted and the store re-queried to zero across
  projects, pages, captures, and keys.
- agent-browser on the anonymous surface: named Editor sign in region,
  labeled password textbox with a 3px solid focus outline, decoy wrong
  password announced generically with the field cleared and no keyboard
  trap. axe (wcag2a/aa): one pre-existing color-contrast violation on links
  (accent on background), not introduced here; flagged for the milestone-3
  token/contrast feature.
- Form inputs added to the global `:focus-visible` rule so login and create
  fields show the same visible focus as buttons and links.

### What broke

- The first e2e run of the new create assertions failed because the
  deliberate 422 correction submission is itself a POST; the no-resubmit
  assertion now snapshots the post count after creation and requires it to
  stay flat across reload/history instead of assuming one total POST.
- The new failure test tripped the known `#__next-route-announcer__`
  `role=alert` collision; the query is scoped to `p[role='alert']`.
- Inline `node -e` SQL with double-quoted `like` patterns fails (SQLite
  treats double quotes as identifiers); run Turso one-offs from a script
  file with single-quoted literals.

### Elapsed

Roughly one hour of mission-worker time.

### Decisions and assertions

- D045 (four-state list machine with single-flight retry; e2e run cleanup in
  teardown with page-id-keyed idempotency rows included).
- Evidence for VAL-AUTH-008 and VAL-AUTH-009 on the local surface:
  component tests for the state machine and request counts, Playwright for
  the real login, create-once, retry-count, reload, and history behavior
  against the production build and real Turso, agent-browser for the login
  surface semantics.

### Open questions at end of session

- None.

## Markdown list continuation fix (2026-09-09, scrutiny round 1)

### What was attempted

Milestone-1 scrutiny flagged VAL-REQS-002: the hand-rolled renderer consumed
only list-marker lines, severing 80 wrapped continuations across the four
source docs and splitting every multi-line ordered item into its own
single-item list. Wrote the failing tests first — wrapped-item fixtures in
`test/requirements-markdown.test.ts` plus a real-source-doc structural
assertion in `test/requirements-sources.test.ts` that recomputes expected
`<ul>`/`<ol>`/`<li>`/`<p>` counts from each source (the systemic gap: the
renderer had only ever seen synthetic single-line fixtures) — confirmed all
five failed against the old renderer, then consumed non-blank,
non-block-start continuation lines into the current item in both list loops.

### What broke or dead-ended

One self-inflicted failure: the Functional-requirements assertion used a
`[^<]*` regex that cannot span the `<strong>` tag inside the first `<li>`;
replaced it with a joined-text `toContain` check. Before fixing, an analysis
script confirmed no source doc has a non-blank line directly after a list and
no continuation line is table-like, so absorption cannot swallow a paragraph
or table.

### Elapsed

Roughly 45 minutes of mission-worker time.

### Decisions and assertions

- D046 (continuation absorption; a blank line is the only way to end a list;
  nested lists remain unsupported).
- Evidence for VAL-REQS-002 on the local surface: the Functional
  requirements section renders as one ordered list of eight items, and the
  real-doc structural assertion proves zero severed continuations across all
  four sources.

### Open questions at end of session

- None.

## Reqs link visibility and contrast fixes (2026-09-09, user-testing round 1)

### What was attempted

User-testing round 1 found four blocking defects on the /reqs surface. Wrote
the failing tests first: `test/visual-tokens.test.ts` recomputes the WCAG
luminance of the global tokens straight from `app/globals.css` (it reproduced
axe's exact 4.06:1 and 4.29:1 failures before the fix, which validated the
math), and three new assertions in `test/requirements-decisions.test.tsx` for
the artifact-link host suffix, h2 card titles with no in-card level skips,
and per-decision unique landmark labels. All six failed red against the old
code. Then darkened the single `--accent` token from `#d1495b` to `#c43448`
(4.98:1 on cream, 5.25:1 with surface text — fixing links, wordmark, landing
h1, error text, and the nav badge in one move), gave decision artifact links
the Markdown renderer's visible `(host)` suffix via `new URL(url).host`,
moved card titles to h2 with h3 section labels, and scoped the repeated
region aria-labels per decision ID.

### What broke or dead-ended

One self-inflicted failure: the first host-suffix render put the leading
space inside the `<span>` (" (github.com)"); moved the space outside the
element so the suffix matches the Markdown renderer's exact
` <span class="external-host">(host)</span>` shape. A scratch contrast script
also produced nonsense ratios until its sRGB channel math was corrected —
the lesson was to verify the harness against axe's known 4.06:1 reading
before trusting candidate colors.

### Elapsed

Roughly 60 minutes of mission-worker time.

### Decisions and assertions

- D047 (darkened `--accent` with the AA floor documented at the token,
  external-host suffix on artifact links, h1 -> h2 -> h3 heading order,
  per-decision landmark labels).
- Evidence for VAL-REQS-004: the three external artifact links on
  /reqs/decisions (D002, D012, D040) now render with visible
  `(github.com)` / `(app.factory.ai)` / `(vercel.com)` suffixes, asserted
  against the real decision log.
- Evidence for VAL-REQS-006: `test/visual-tokens.test.ts` locks `--accent`
  at >=4.5:1 on both backgrounds and as the nav-badge fill; heading order
  and landmark uniqueness on /reqs/decisions are asserted in
  `test/requirements-decisions.test.tsx`.

### Open questions at end of session

- None.
