# Pinata evals

This is the human-readable catalog of how Pinata is evaluated, rendered live
at `/reqs/evals`. The formal, executable definition of done is the mission
validation contract (`validation-contract.md`, assertion IDs `VAL-*`); this
catalog explains the same intent in plain language so anyone can add
scenarios. When the two disagree, the contract wins.

## How evaluation works

- **One gate.** `npm run validate` runs lint and integrity, typecheck, unit
  and component tests, the deterministic docs check, the production build,
  and Chromium end-to-end tests — the same command locally and in CI.
- **Real integrations.** Milestone validation exercises the real Browserless,
  Turso, private Blob, and Vercel surfaces. Mocks support focused unit tests;
  they are never the definition of done.
- **Live checkpoints.** After each milestone's automated validation passes,
  the owner drives a headed shared-browser session while the agent inspects
  the same DOM, console, network, and persisted state.
- **Escapes become assertions.** Any issue the owner reports is written down
  as a `given / when / expected / observed` contract assertion before a fix
  is implemented.

## Chickpea scenarios

The primary real-world target is [Chickpea](https://chickpea.co/) plus its
explicit `/pricing`, `/about`, and `/privacy` URLs, captured on desktop and
mobile. Representative scenarios:

1. Full-page captures include lazy-loaded content near the bottom of the
   page, on both viewports.
2. Deep zoom on a dense pricing-table cell stays readable, and a pin dropped
   on that cell persists to the exact natural pixel after reload.
3. Choosing the right nearby element from a dense table ranks the cell ahead
   of its row and table wrappers.
4. The closed mobile menu's hidden descendants never appear as selectable
   metadata, while a visible header element does.
5. Desktop and mobile annotations of the same page stay fully independent.
6. The explicit URL array preserves its submitted order in the page tree.
7. A failed viewport capture does not discard its successful sibling, and
   retry replaces only the failed attempt.

## Dogfood scenarios

Pinata captures and annotates its own requirements hub. The dogfood URL
array, in order:

1. `/reqs`
2. `/reqs/architecture`
3. `/reqs/milestones`
4. `/reqs/decisions`
5. `/reqs/evals`

Representative scenarios:

1. Navigate the hub from the landing page without typing a URL; every route
   refreshes cleanly; an unknown `/reqs/*` address lands on a bounded 404
   with a working link home.
2. Decision cards match `docs/decisions/decisions.json` exactly, including
   provenance quotes and supersession links — there is no second decision
   dataset.
3. Capture the five routes above as a Pinata project and annotate a
   requirement from inside Pinata itself.
4. Hostile markup or unsafe links in a document render inert; external links
   identify their destination and withhold the referrer.
5. The hub stays usable at phone width, at 320 CSS pixels with 200% zoom, and
   with reduced motion preferred, with no horizontal scrolling of the page.

## Role and thread scenarios

1. A founder link opens a read/reply-only view; editing controls are absent
   visually and to assistive technology.
2. Founder replies and editor follow-ups interleave chronologically and
   cannot be edited or deleted by anyone, enforced below the application by
   database triggers.
3. Rotating a link invalidates the old link and every old session; revoking
   ends access without deleting project history.
4. A stale reply composed before logout, rotation, or revocation is rejected
   and adds nothing.

## Published boundaries

Exact, versioned runtime values — session lifetimes, URL and field limits,
capture dimensions, time and byte budgets, manifest caps, geometry minimums,
reply and login quotas, and performance budgets — are owned by the
validation-boundary catalog work (contract area `VAL-REQS-007` and the
capture/quota assertions). They are published as shared exported constants
that tests, documentation, and the deployed evals page all read from one
source. Until that work lands, this catalog deliberately states policies
without inventing numbers.

## Quality attributes under test

- Warm, playful, focused design; the whole product demos live in under a
  minute.
- No horizontal page overflow, clipped controls, or hover-only content at any
  supported width.
- Keyboard-operable controls with visible focus; reduced-motion preference
  respected.
- Bounded, actionable error states that never leave silent partial project
  state.
- No application secret or founder capability in any public response, asset,
  log, or committed file.
