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
and the architecture was approved during a Factory Mission planning phase.
Application code has not been written yet. The plan is three milestones:

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

Requires Node 20.9+. There is nothing to install today — the repository
currently contains the documentation tooling only, and it is deliberately
zero-dependency. `npm run validate` is the whole gate:

```bash
git clone https://github.com/lucasdickey/pinata.git
cd pinata
npm run validate
```

| Command | What it proves |
| --- | --- |
| `npm run lint` | Everything parses, the dependency lists are still empty, generated files still say so. |
| `npm run docs:check` | The committed artifacts match what the generator would write. Fails on stale docs. |
| `npm test` | The `node:test` suite in `test/`. |
| `npm run validate` | All three. This is the gate, and CI runs the identical command. |

The suite tests the provenance rules themselves, not just the rendering: a
decision tagged as human-directed with no quote behind it fails the build. See
[`AGENTS.md`](AGENTS.md) section 3 for the full contract.

When the product stack lands (Milestone 1), the gate grows — TypeScript,
Vitest, a Next.js build, and Playwright end-to-end join the same single
command, and the runtime standardizes on Node 24 — without adding a second
entry point. That transition is approved and recorded as
[`D019`](docs/DECISIONS.md#d019--standardize-on-node-24-across-app-ci-and-vercel)
and
[`D020`](docs/DECISIONS.md#d020--product-stack-transition-vitest-and-playwright-join-the-single-validate-gate).
