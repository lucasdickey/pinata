# Pinata milestones

The build proceeds in three vertical slices, each gated by
`npm run validate` and paused for a live headed-browser checkpoint with the
project owner. Rendered live at `/reqs/milestones`.

## Milestone 1: Capture and organize — validated 2026-09-10

The foundation: a working application skeleton that can capture real pages and
keep them organized.

- Node 24, Next.js, and TypeScript with the repository's decision-history
  apparatus and the single `npm run validate` gate preserved.
- This requirements hub at `/reqs`, rendered from repository sources, with
  decisions rendered directly from the decision log.
- Environment-secret-backed password prompt with server-side authorization.
- Projects with a logical URL/page/device hierarchy from a root public HTTPS
  URL plus optional explicit URL arrays. No crawling.
- Browserless captures: independent static full-page desktop and mobile
  images with lazy-content pre-scroll, frozen motion, bounded height and
  time, and rejection of non-public or unsafe targets.
- A bounded, sanitized DOM metadata manifest from the same browser session as
  each screenshot.
- Private Vercel Blob for images; Turso/libSQL for metadata.
- Local validation of capture and organization against controlled fixtures and
  live public pages, including [Chickpea](https://chickpea.co/) and its
  explicit `/pricing`, `/about`, and `/privacy` URL array, run against the
  production build on `127.0.0.1:3100`.

Scope trim (2026-09-08, user-directed — D050): to shorten the critical path,
milestone 1 drops the first Vercel deployment and the standalone
variant/retry integration matrix; the variant-isolation, stabilization,
no-crawl, and partial-failure assertions moved into the surviving capture
features, so no coverage was lost. The first production deployment and the
real Chickpea project now live in milestone 2.

Status: the live checkpoint ran on 2026-09-09/10 against the local production
build (see [Evals](/reqs/evals), "Milestone 1 live checkpoint"). Capture and
organization were validated with conditional acceptance; four escapes were
fixed in session and one question stays open (D054, the non-retryable
provider-side unsafe redirect).

## Milestone 2: Pins and founder feedback — shipped, pending its live checkpoint

The feedback loop itself.

Descope (2026-09-09, user-directed — D051): after the milestone-1 checkpoint
the roadmap was cut to what the product exists for. The bullets marked
*shipped* below are in the production deployment and covered by the
production smoke (D068). The bullets marked *deferred* are the founder loop;
they merged on 2026-09-10 as pull request #2 (D073), so every bullet below
is now shipped. What remains for this milestone is proof rather than code:
the founder end-to-end spec has never executed (it needs local secrets), and
the short live pins checkpoint on production with the owner is still to run.

- *Shipped.* One page/device capture at a time on a React Flow canvas, with the
  project/page tree outside the canvas.
- *Shipped.* Numbered pins with directional original comments, persisted in immutable
  screenshot-natural pixel coordinates, with deep pan and zoom on long
  captures.
- *Shipped.* Nearby captured DOM elements offered as explicit metadata attachments when
  placing a pin.
- *Shipped.* Independent desktop and mobile annotations.
- *Shipped 2026-09-10 (D073, merged as pull request #2).* Persistent, rotatable, revocable founder capability links.
- *Shipped 2026-09-10 (D073, merged as pull request #2).* A read/reply-only founder view: founders cannot create, move, edit, or
  delete annotations.
- *Shipped 2026-09-10 (D073, merged as pull request #2).* Chronological, append-only two-way threads: founders reply as `founder`,
  Lucas follows up, and founder replies are immutable for everyone.
- *Shipped (D068).* The first Vercel production deployment of the validated build.
- *Shipped (D068); placement, metadata, persistence, and role boundaries proven by the smoke; sharing and replies wait on the founder loop.* The real Chickpea project in production: root plus the explicit
  `/pricing`, `/about`, and `/privacy` URL array, captured as eight ordered
  Desktop/Mobile captures, and used to validate exact placement, metadata
  selection, reload persistence, role boundaries, sharing, and replies.

## Milestone 3: Rich marks, polish, and handoff — deferred (D051)

The demoable, reviewable finish. Deferred wholesale by D051 except the
documentation bullets, which were completed at closeout (D069); the final
production acceptance session is replaced by the short pins checkpoint in
milestone 2.

- Rectangles and circles as resizable canvas nodes; straight arrows with
  draggable endpoints; directional comments on every mark kind.
- The warm, playful, focused workspace design across editor and founder
  views.
- Hardened capture errors, quotas, empty and loading states, keyboard
  behavior, responsive layout, capability rotation, and accessibility.
- The human-readable eval catalog in `docs/EVALS.md`, kept alongside the
  formal validation contract.
- README, next-steps, the decision dashboard, and the session narrative
  completed for the interview demo.
- Final deployed validation with real Browserless, Turso, Blob, and Chickpea
  flows, ending in a live acceptance session.

## How status moves

A milestone is complete only when its automated validation passes against the
real integrations and the live headed-browser checkpoint with the owner has
run. Findings from the owner become new contract assertions before fixes are
implemented — see [Evals](/reqs/evals).
