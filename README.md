# pinata

**pin** + **anno**tation + at **ya**

A lightweight workspace for giving directional feedback on friends' public
websites — pin a note to the exact spot on the page, share a link, get the
founder's reply. Built for the Factory candidate assignment; the brief is
transcribed in [`docs/ASSIGNMENT.md`](docs/ASSIGNMENT.md).

## The problem

Giving feedback on a friend's website today means scattered screenshots in a
chat thread, or firing up a heavyweight design tool for what is really a
two-minute comment. Either way the words get detached from the exact spot on
the page they refer to, and the founder is left guessing what "the pricing
table feels cramped" actually points at.

Pinata keeps the feedback pinned to the page. It is deliberately **not** an
editing tool: no copy rewrites, no style changes, no IDE. The founder owns the
edits; Pinata just makes "try tightening this" unambiguous.

## Who it is for

- **The editor (Lucas)** — captures pages, places pins and markups, writes
  directional comments. Authenticates with a simple password prompt.
- **The founder** — a friend who receives an unguessable link, reads the
  annotations in place, and replies. No account, no signup. The first real
  recipient is the founder of [chickpea.co](https://chickpea.co/), which is
  also the canonical test target.

## How it works

1. **Create a project** from a public HTTPS URL, optionally with an explicit
   list of additional page URLs. Pinata never crawls or discovers links on its
   own.
2. **Capture.** A managed headless-browser service (Browserless) loads each
   URL on desktop and mobile viewports, scrolls out lazy-loaded content,
   freezes animation, and takes a static full-page screenshot. In the same
   session it extracts a small, sanitized manifest of visible DOM elements
   (tag, role, short text, position) — never HTML source, cookies, or form
   values.
3. **Annotate.** Each capture opens in a pan/zoom canvas (React Flow) rendered
   at the screenshot's own size. A click drops a numbered pin; a Shift-drag
   (or the Box tool, B) draws a numbered box around a region; the Circle
   tool (C) circles one, and the Arrow tool (A) says "move this there".
   Every mark is stored in screenshot pixels, so it stays glued to its
   target at any zoom, and is named by what it says and what it points at
   ("Pin 3 · “Annual toggle reads the same in both states” · Annual (save
   20%)"). When placing a mark, nearby captured elements are offered as
   context.
4. **Share and reply.** A persistent, revocable link opens the project in a
   read/reply-only founder view. Threads are append-only and chronological:
   the founder replies, the editor follows up, and nobody — including the
   founder — can edit or delete a founder reply. Either side can mark a
   note resolved, and reopen it later; each change is recorded in the
   thread.

Guardrails: public pages only, static captures only, no runtime AI, and
directional feedback only. Full rationale lives in the decision log.

### The walkthrough

A ten-chapter interactive walkthrough of the above, built with
[Remotion](https://www.remotion.dev/) (`D072`), plays inside the app at
`/walkthrough`: pick a chapter, or press play and let it run (about 1:45). It
paints with the application's own tokens and borrows only imagery that already
lived in the repository: the brand exploration board and the dashboard
screenshots attached to `D004` and `D066`. The composition lives in
`remotion/`; the slide table in `remotion/walkthrough/slides.ts` is the single
source for the video, the chapter list, and the on-page transcript.

```bash
npm run walkthrough          # Remotion Studio, to scrub and edit the slides
npm run walkthrough:render   # writes out/pinata-walkthrough.mp4 (git-ignored)
```

## Stack

Next.js + React + TypeScript on Vercel · Browserless for capture · Turso
(libSQL) + Drizzle for metadata · private Vercel Blob for screenshots · React
Flow for the canvas. Chosen and approved during mission planning — see
[`D014`–`D018`](docs/DECISIONS.md).

## Status

The product concept is fixed ([`D012`](docs/DECISIONS.md#d012--define-the-product-directional-feedback-on-friends-public-websites))
and the architecture was approved during a Factory Mission planning phase. The
application foundation is in place — Node 24, Next.js + React + TypeScript, and
the single `npm run validate` gate — and product features land milestone by
milestone. The plan is three milestones:

1. **Capture and organize** — app foundation, editor auth, projects and URL
   arrays, the capture pipeline, deployed and validated against Chickpea.
2. **Pins and founder feedback** — the annotation canvas, metadata
   attachment, share links, and the append-only reply loop.
3. **Rich marks, polish, and handoff** — boxes, circles, arrows, design
   polish, hardening, and the interview-ready documentation.

## How the work is documented

The assignment is graded partly on the ability to explain the process and the
decisions, so the decision trail is maintained continuously rather than
reconstructed afterwards.

| Artifact | What it is |
| --- | --- |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Plain-text decision log. Generated. |
| `docs/dashboard/index.html` | Same data as a browser page, with screenshots. Open it directly, no server needed. |
| [`docs/SESSION-LOG.md`](docs/SESSION-LOG.md) | What actually happened each session, dead ends included. |
| [`docs/NEXT.md`](docs/NEXT.md) | What I'd do with more time. |
| [`AGENTS.md`](AGENTS.md) | The rules the agent works under. |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | Product requirements, naming story, scope, and non-goals. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System shape, stack, capture pipeline, security boundaries. |
| [`docs/MILESTONES.md`](docs/MILESTONES.md) | The three vertical slices and their status. |
| [`docs/EVALS.md`](docs/EVALS.md) | The human-readable eval catalog. |
| `remotion/walkthrough/slides.ts` | The ten-slide walkthrough played at `/walkthrough`; chapters, durations, and transcript in one table. |

The same sources are rendered live in the running app: the requirements hub at
`/reqs` (plus `/reqs/architecture`, `/reqs/milestones`, `/reqs/decisions`, and
`/reqs/evals`) renders these files — and `docs/decisions/decisions.json`
directly — with raw HTML disabled, so the deployed product documents itself
and doubles as its own capture target.

Every decision carries an **origin** that distinguishes what the human directed
from what the agent proposed and the human approved, each backed by a verbatim
quote. That split is the point: it makes the division of labour between human
and agent auditable rather than asserted.

### Editing the log

`docs/decisions/decisions.json` is the only file edited by hand. After changing
it:

```bash
npm run docs
```

That regenerates `docs/DECISIONS.md` and `docs/dashboard/decisions-data.js`,
and fails loudly if a record is missing its required provenance evidence.

To view the dashboard, open it directly. It needs no server:

```bash
open docs/dashboard/index.html
```

## Validation

Requires Node 24 (`D019`). Install once, then `npm run validate` is the whole
gate:

```bash
git clone https://github.com/lucasdickey/pinata.git
cd pinata
npm ci
npm run validate
```

| Command | What it proves |
| --- | --- |
| `npm run lint` | ESLint plus repository integrity: everything parses, dependencies stay within the approved pinned set, generated files still say so. |
| `npm run typecheck` | `tsc --noEmit` over the app, tests, and configs. |
| `npm test` | The Vitest suite in `test/` — provenance rules, repository integrity, and component tests. |
| `npm run docs:check` | The committed artifacts match what the generator would write. Fails on stale docs. |
| `npm run build` | The Next.js production build succeeds. |
| `npm run e2e` | Playwright Chromium against the production server on `127.0.0.1:3100`. |
| `npm run validate` | All six stages, in that order. This is the gate, and CI runs the identical command under Node 24. |

The gate needs no credentials to pass. Tests that require real configuration —
the editor password, Turso, Blob, Browserless — read it from a git-ignored
`.env.local` and **skip** when it is absent, which is how CI stays green with no
repository secrets. So a green CI run proves the public surfaces; the
credentialed paths are proven by running the same gate locally with `.env.local`
present, and against the deployment. See [`AGENTS.md`](AGENTS.md) section 3.

The suite tests the provenance rules themselves, not just the rendering: a
decision tagged as human-directed with no quote behind it fails the build. See
[`AGENTS.md`](AGENTS.md) section 3 for the full contract.

The gate grew exactly as planned when the product stack landed: TypeScript,
Vitest, a Next.js build, and Playwright end-to-end joined the same single
command, and the runtime standardized on Node 24 — without adding a second
entry point. That transition is recorded as
[`D019`](docs/DECISIONS.md#d019--standardize-on-node-24-across-app-ci-and-vercel)
and
[`D020`](docs/DECISIONS.md#d020--product-stack-transition-vitest-and-playwright-join-the-single-validate-gate).

## Developing

```bash
npm run dev    # Next.js on http://127.0.0.1:3100
```

Port 3100 is reserved for this project; the dev and production servers bind
only to localhost.

## Deployment

Production lives at **https://yourpinata.dev** (`www.yourpinata.dev`
redirects there; the older `pinata-tau.vercel.app` and
`pinata-lucasdickeys-projects.vercel.app` addresses serve the same
deployment), on the Vercel project `pinata`, Node 24, Next.js preset, Fluid
compute on (`D100`). Share founder links from `yourpinata.dev`: the share
control builds each link from the page's own address (`D089`). The first production deployment is recorded as
[`D068`](docs/DECISIONS.md#d068--deploy-to-vercel-production-behind-sso-protection-fixing-the-framework-preset-and-adding-a-protection-bypass-for-automation-secret-for-the-smoke).

Seven environment variable **names** must exist in the Vercel Production
environment (values are managed in Vercel and never committed):
`BROWSERLESS_TOKEN`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`BLOB_READ_WRITE_TOKEN`, `EDITOR_PASSWORD`, `SESSION_SECRET`, and
`CRON_SECRET`. The last one protects the capture sweep (`D076`): the daily
cron in `vercel.json` calls `/api/captures/sweep` with
`Authorization: Bearer $CRON_SECRET`, and the route also accepts an optional
`CAPTURE_SWEEP_SECRET` sent as the `x-pinata-sweep-secret` header for any
other scheduler or a hand-run sweep. With neither variable set the sweep
route answers 404. `PINATA_AUTH_DISABLED` must never be set in any Vercel
environment; that bypass is local-only (`D052`). The same goes for
`PINATA_SERVER_CAPTURE=off`, which turns server-driven capture off (nothing
is continued after create or retry, and the sweep only counts) so the client
fallback driver is the only thing dispatching; `playwright.config.ts` runs
the production server under test with it off, and it is local/test only.

### Runbook

Migrations are **not** run by the build. Code that expects a new column
deploys in seconds and fails on its first read, so the database moves first,
then the code. Every migration so far only adds (columns with defaults, new
tables, insert/update triggers), so the older deployment keeps working
against the newer schema; that is what makes this order safe.

1. Check the Vercel project before the first deploy of a new stream of work:
   - **Settings → Functions → Fluid compute is on.** Four routes export
     `maxDuration = 300`, which Hobby accepts only with Fluid compute;
     without it the deploy is rejected.
   - **The seven Production variables above exist**, `CRON_SECRET`
     included (the sweep answers 404 without it), and neither
     `PINATA_AUTH_DISABLED` nor `PINATA_SERVER_CAPTURE` is set.
     `PINATA_AUTH_DISABLED` is also refused in code on Vercel (`D098`).
   - **Protection Bypass for Automation exists** (`D068`). Vercel exposes it
     to functions as `VERCEL_AUTOMATION_BYPASS_SECRET`, which the capture
     hand-off (`D095`) sends in case the deployment URL is protected. With
     protection off, as it is today (`D100`), the header is harmless.
   - `vercel ls pinata` shows the last deployment as Ready. If recent
     pushes produced no deployment or a failed one, read that build log
     first; fixing whatever stopped it will let everything since through
     at once.
2. Land the change with `npm run validate` green under Node 24.
3. **Migrate the shared database:** `npm run db:migrate` from a checkout of
   the commit being deployed, with `.env.local` pointing at the production
   Turso database (local and production share it — see Known weaknesses).
   Before the first run after a gap, list what is applied with
   `SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at`:
   Drizzle skips any migration older than the newest recorded one, so an
   out-of-order row would silently hide a pending migration.
4. Deploy. Pushing to `main` deploys production automatically through the
   GitHub integration — which is why step 3 comes before the push, not
   after. To deploy the exact checked-out commit by hand instead:
   `vercel deploy --prod --yes` (the CLI attaches the local git metadata, so
   the deployment record and the `/reqs` pages show the same commit SHA).
5. Verify: `vercel ls pinata --prod` shows the new deployment Ready and
   aliased; `vercel inspect <deployment-url>` names the commit; the deployed
   `/reqs` pages display that same SHA. Then run the production smoke below.
6. Roll back by redeploying the previous Ready deployment from the Vercel
   dashboard (`…` → Redeploy) or by deploying the earlier commit. Additive
   migrations do not need reversing for a rollback.

Do not run the local gate (`npm run e2e`, `npm run validate`, or the
integration suites with `.env.local` present) while testing production:
they write to the same database and Blob store and take the same two
capture slots.

### Deployment protection is off

`D068` recorded Vercel SSO protection as `all_except_custom_domains`. It has
since been turned off (`D100`), so every deployment URL — production,
preview, and per-deployment — is publicly reachable, and a founder link
opens for anyone who holds it. Editor routes still require the password;
founder routes still require the link's token. Two consequences:

- Preview deployments of any branch are public too and use the same
  Production-scoped secrets and shared database, guarded only by the same
  editor password.
- If protection is turned back on, founders must be sent links on
  `yourpinata.dev`: a custom domain is the one address
  `all_except_custom_domains` leaves open.

### Production smoke

Both smoke tools were written while deployment protection was on. They send
the project's Protection Bypass for Automation secret as the
`x-vercel-protection-bypass` header, and each also asserts that a visitor
without it is sent to Vercel's SSO page — an assertion that now fails,
because protection is off (`D100`). Until the smoke is updated to the
current posture, expect that one check to fail and read the rest. With the secret in an environment variable or a local
0600-permission file (never in the repository):

```bash
# API-level smoke: protection posture, /reqs hub + commit SHA, login, the
# real Chickpea project (root + /pricing + /about + /privacy, 8 captures)
# driven to ready through the deployment's own dispatch route, private-asset
# authorization, pin persistence, and a scoped recapture that starts empty.
node --env-file=.env.local scripts/production-smoke.mjs \
  https://yourpinata.dev --bypass-file <file>

# Browser-level smoke (Playwright): UI sign-in, dense-cell pin at 8x with an
# explicit element choice, reload persistence, mobile/desktop isolation, and
# the unauthorized-denial matrix.
VERCEL_AUTOMATION_BYPASS_SECRET=... npx playwright test e2e/production-smoke.spec.ts
```

`scripts/chickpea-baseline.mjs` records the same-run direct-browser Chickpea
baseline (requested/final URLs, landmarks, document heights, mobile menu
state, animated regions) that a capture run is compared against.

### Known weaknesses

- **Session revocation is in-memory per serverless instance.** Logout
  invalidates the session id in the instance that served the request; a
  revoked session can remain usable until its absolute expiry if a later
  request lands on a different instance. The session lifetime is short, but
  durable revocation (a Turso-backed denylist, the same pattern as the login
  throttle) is the follow-up — tracked in `docs/NEXT.md`.
- **The automation-bypass secret skips deployment protection entirely.** It
  exists to keep CI-style smoke possible when protection is on; rotate it
  from the project settings if it may have leaked, and redeploy.
- **Turso and Blob are shared between local development and production**
  (one Vercel-integrated database and store), so local test fixtures and the
  production demo project coexist in the same tables; run-scoped cleanup and
  the oldest-seed pinning in `e2e/canvas-session.ts` keep them apart.
