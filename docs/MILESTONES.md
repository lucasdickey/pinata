# Pinata milestones

The build proceeds in vertical slices, each gated by `npm run validate` and
paused for a live headed-browser checkpoint with the project owner. Rendered
live at `/reqs/milestones`.

Status vocabulary, and the rule that governs it: a milestone is **complete**
only when its automated validation passes against the real integrations *and*
the live headed-browser checkpoint with the owner has run. Functionality that
is built and machine-validated but that the owner has not yet driven is
**awaiting checkpoint**, not complete. Findings from a checkpoint become new
contract assertions before fixes are implemented — see [Evals](/reqs/evals).

## Milestone 1: Capture and organize — complete

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

Scope trim (2026-09-08, user-directed — D050): to shorten the critical path,
milestone 1 dropped the first Vercel deployment and the standalone
variant/retry integration matrix; the variant-isolation, stabilization,
no-crawl, and partial-failure assertions moved into the surviving capture
features, so no coverage was lost. The first production deployment and the
real Chickpea project moved to milestone 2.

**Checkpoint:** ran 2026-09-09/10 against the local production build, outcome
**conditional acceptance** — capture and organization validated, with five
findings recorded as M1-LIVE-1 through M1-LIVE-5 in
[Evals](/reqs/evals). Four were fixed in the same session; the fifth was the
absence of pins, which milestone 2 answered. The owner's closing statement is
quoted verbatim in the eval catalog.

## Milestone 2: Pins and founder feedback — built, awaiting checkpoint

The feedback loop itself. Every item below is implemented and covered by the
gate; none of it has been driven by the owner in a browser.

- One page/device capture at a time on a React Flow canvas, with the
  project/page tree outside the canvas (D055, D058).
- Numbered pins with directional original comments, persisted in immutable
  screenshot-natural pixel coordinates, with deep pan and zoom on long
  captures (D056, D059, D060).
- Nearby captured DOM elements offered as explicit metadata attachments when
  placing a mark, with the choice made explicitly and the snapshot derived
  server-side (D061, D064).
- Independent desktop and mobile annotations.
- Persistent, rotatable, revocable founder capability links (D018).
- A read/reply-only founder view: founders cannot create, move, edit, or
  delete annotations.
- Chronological, append-only two-way threads: founders reply as `founder`,
  Lucas follows up, and founder replies are immutable for everyone, enforced
  by database triggers (D025).
- The first Vercel production deployment of the validated build (D068).
- The real Chickpea project in production: root plus the explicit
  `/pricing`, `/about`, and `/privacy` URL array, captured as eight ordered
  Desktop/Mobile captures, exercised by the production smoke tooling.

**What stands between this and complete:** the deployment is the one from
D068, at commit `523dcd9`. Everything below that line in this document, plus
the whole route split and the UX overhaul, has never been deployed. The
checkpoint needs a current deployment to run against, so shipping and the
checkpoint are one piece of work, listed under milestone 3.

## Milestone 3: Rich marks, polish, and handoff — in progress

The demoable, reviewable finish.

Done:

- Rectangles as resizable canvas nodes with comments, context, shared
  numbering, and a read-only founder rendering (D079).
- The UX overhaul described below, which absorbed most of this milestone's
  "polish" line: hardened empty and loading states, keyboard behaviour,
  responsive layout, capability rotation surfaced in the project header, and
  an axe sweep at two widths across the public surfaces.
- The human-readable eval catalog in `docs/EVALS.md`, kept alongside the
  formal validation contract.
- README, next-steps, the decision dashboard, the session narrative, and a
  ten-chapter interactive walkthrough at `/walkthrough` (D072, D073).

Remaining:

- **Circles and arrows.** The schema, the geometry minimums, and the
  kind-generic annotation path all allow them; only the renderers, the
  gestures, and their geometry validation are missing. Arrows carry the
  meaning a pin and a box cannot: *move this there*.
- **Ship the current build and run the milestone-2/3 checkpoint.** Three
  migrations, two new environment variables, and a function-duration setting
  stand between `main` and production; the owner then drives the real
  Chickpea project end to end. Expect findings, and expect them to become
  assertions before they become fixes.
- **Rectangle resize-handle ergonomics** at low zoom, recorded as a known
  weakness in [what's next](https://github.com/lucasdickey/pinata/blob/main/docs/NEXT.md).

## The UX overhaul (2026-09-12) — unplanned, between milestones 2 and 3

Not in the original three-slice plan. A functional UX review of the editor
and founder surfaces produced five recommendations; the owner approved all
five and added a sixth. They reshaped surfaces that milestones 2 and 3 had
already delivered, so they are recorded here rather than folded silently into
either one.

- **D074** — placing a mark went from six actions to two: no interaction
  modes, a composer anchored at the mark, and a pre-selected nearby element.
- **D075** — the feedback loop closes: marks carry open, replied, and
  resolved; unread reply counts ride the hierarchy read; the founder gets a
  list of what is waiting for them; sharing moved to the project header.
- **D076** — capture no longer needs the editor's browser tab: the server
  continues a project's captures after the response, a scheduled sweep is the
  backstop, and one automatic retry recovers a stalled attempt.
- **D077** — a project overview replaces eight separate planes: a capture
  grid with counts, a device toggle, next/previous mark across the whole
  project, and a project-scoped table and export.
- **D078** — the product speaks the user's language: marks named by their
  comment and element, internals behind a disclosure, and a reading-first
  founder view on phones.
- **D079** — rectangles (listed under milestone 3 above).

## Milestone 4: Depth on the loop — planned

What the product needs before it needs accounts. Ordered by how much each one
changes whether the tool gets used.

- **The re-review loop.** Today the conversation ends at the founder's reply.
  The missing half is what happens after they ship a change: recapture a page
  into a new version, see which marks still point at something and which are
  stranded, and settle each one. Captures are already immutable and
  versioned, so the storage shape exists; the reading of it does not.
- **Working a project at scale.** Filter and sort marks by status, device,
  and page; jump to the next unresolved one; make a fifty-mark project as
  navigable as a five-mark one.
- **The editor on a phone.** The founder's view reads well on a phone since
  D078; the editor's does not, and capturing a friend's site is something
  people do from a phone.

## Milestone 5: Accounts and multiple people — last, deliberately

Held until the milestones above are done, at the owner's direction
(2026-09-15). Everything the product does today works for one editor and
link-holding founders, and that is enough to prove the idea. Identity,
per-user projects, durable session revocation, and anything resembling
multiplayer wait until the feedback loop itself is worth sharing.

## How status moves

A milestone is complete only when its automated validation passes against the
real integrations and the live headed-browser checkpoint with the owner has
run. Findings from the owner become new contract assertions before fixes are
implemented — see [Evals](/reqs/evals).
