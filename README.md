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
   at its natural pixel size. The editor places numbered pins — and later
   boxes, circles, and arrows — whose coordinates are stored in screenshot
   pixels, so they stay glued to their target at any zoom. When placing a pin,
   nearby captured elements are offered as metadata attachments.
4. **Share and reply.** A persistent, revocable link opens the project in a
   read/reply-only founder view. Threads are append-only and chronological:
   the founder replies, the editor follows up, and nobody — including the
   founder — can edit or delete a founder reply.

Guardrails: public pages only, static captures only, no runtime AI, and
directional feedback only. Full rationale lives in the decision log.

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

Production lives at **https://pinata-lucasdickeys-projects.vercel.app**
(also aliased as `pinata-tau.vercel.app`), on the Vercel project `pinata`,
Node 24, Next.js preset. The first production deployment is recorded as
[`D068`](docs/DECISIONS.md#d068--deploy-to-vercel-production-behind-sso-protection-fixing-the-framework-preset-and-adding-a-protection-bypass-for-automation-secret-for-the-smoke).

Six environment variable **names** must exist in the Vercel Production
environment (values are managed in Vercel and never committed):
`BROWSERLESS_TOKEN`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`BLOB_READ_WRITE_TOKEN`, `EDITOR_PASSWORD`, and `SESSION_SECRET`.
`PINATA_AUTH_DISABLED` must never be set in any Vercel environment; that
bypass is local-only (`D052`).

### Runbook

1. Land the change on `main` with `npm run validate` green under Node 24.
2. Pushing to `main` deploys production automatically through the GitHub
   integration. To deploy the exact checked-out commit by hand instead:
   `vercel deploy --prod --yes` (the CLI attaches the local git metadata, so
   the deployment record and the `/reqs` pages show the same commit SHA).
3. Verify: `vercel ls pinata --prod` shows the new deployment Ready and
   aliased; `vercel inspect <deployment-url>` names the commit; the deployed
   `/reqs` pages display that same SHA.
4. Roll back by redeploying the previous Ready deployment from the Vercel
   dashboard (`…` → Redeploy) or by deploying the earlier commit.

### Production smoke

Deployment protection (Vercel SSO) stays **on**. Automation reaches the
deployment through the project's Protection Bypass for Automation secret,
sent as the `x-vercel-protection-bypass` header; browsers without it get the
SSO redirect. With the secret in an environment variable or a local
0600-permission file (never in the repository):

```bash
# API-level smoke: protection posture, /reqs hub + commit SHA, login, the
# real Chickpea project (root + /pricing + /about + /privacy, 8 captures)
# driven to ready through the deployment's own dispatch route, private-asset
# authorization, pin persistence, and a scoped recapture that starts empty.
node --env-file=.env.local scripts/production-smoke.mjs \
  https://pinata-lucasdickeys-projects.vercel.app --bypass-file <file>

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
  exists to keep CI-style smoke possible while SSO stays on; rotate it from
  the project settings if it may have leaked, and redeploy.
- **Turso and Blob are shared between local development and production**
  (one Vercel-integrated database and store), so local test fixtures and the
  production demo project coexist in the same tables; run-scoped cleanup and
  the oldest-seed pinning in `e2e/canvas-session.ts` keep them apart.
