# Pinata milestones

The build proceeds in three vertical slices, each gated by
`npm run validate` and paused for a live headed-browser checkpoint with the
project owner. Rendered live at `/reqs/milestones`.

## Milestone 1: Capture and organize — in progress

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
- A working preview/production deployment on Vercel.
- Validation against [Chickpea](https://chickpea.co/) and its explicit
  `/pricing`, `/about`, and `/privacy` URLs.

## Milestone 2: Pins and founder feedback — pending

The feedback loop itself.

- One page/device capture at a time on a React Flow canvas, with the
  project/page tree outside the canvas.
- Numbered pins with directional original comments, persisted in immutable
  screenshot-natural pixel coordinates, with deep pan and zoom on long
  captures.
- Nearby captured DOM elements offered as explicit metadata attachments when
  placing a pin.
- Independent desktop and mobile annotations.
- Persistent, rotatable, revocable founder capability links.
- A read/reply-only founder view: founders cannot create, move, edit, or
  delete annotations.
- Chronological, append-only two-way threads: founders reply as `founder`,
  Lucas follows up, and founder replies are immutable for everyone.
- Validation of exact placement, metadata selection, reload persistence, role
  boundaries, sharing, and replies against a real Chickpea project.

## Milestone 3: Rich marks, polish, and handoff — pending

The demoable, reviewable finish.

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
