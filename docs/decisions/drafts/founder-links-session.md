# Session narrative — founder links (branch `feat/founder-links`)

To be folded into `docs/SESSION-LOG.md` at PR time. Draft decision records
for this session are in `founder-links.json` (ids `DRAFT-1`..`DRAFT-6`).

## Elapsed

Roughly 1 h 15 min of build time in one sitting (2026-09-10, ~15:40Z to
~17:00Z), in a container with Node 24 available through nvm, no `.env.local`,
and no network access to Turso, Blob, or Browserless.

## What was attempted

The founder-links stream from REQUIREMENTS 6 and 7, end to end and additive:

- **Capability tokens** (`src/lib/server/founder/capability.ts`): 32 random
  bytes as 43 base64url characters; the store holds only the SHA-256 digest,
  `share_token_version` increments on every issue/rotate, `share_revoked_at`
  plus a cleared digest on revoke. Exchange is a timing-safe digest compare;
  every failure is the same null.
- **Founder sessions** (`session.ts`, `cookies.ts`, `guard.ts`, `reader.ts`):
  the editor session code mirrored with an `f1` prefix, bound to
  `{project id, version}` and re-checked against the project row on every
  request. `reader.ts` is the one editor-or-founder authorizer the asset
  route, pin-list GET, and thread route share.
- **Threads** (`src/lib/server/threads/`): append-only store with
  server-assigned labels (`editor`→`Lucas`, `founder`→`founder`), bounded
  bodies, replay-or-conflict idempotency on the existing unique index, and a
  durable per-project reply quota in `rate_limit_buckets`.
- **Routes**: `POST /api/founder/[publicId]/session` (exchange),
  `GET /api/founder/[publicId]` (hierarchy), `GET/POST/DELETE
  /api/projects/[publicId]/share` (editor status / issue-rotate / revoke),
  `GET/POST /api/captures/[captureId]/annotations/[annotationId]/thread`.
  The asset route and the annotations GET admit a bound founder.
- **Founder page** `/f/[publicId]` with `FounderView`: reads the fragment
  once, scrubs it with `history.replaceState` before the exchange, then reads
  through founder-authorized routes. The canvas mounts with the new
  `readOnly` prop (no Canvas tools group, no drafts, pins never draggable,
  `data-read-only="true"` on the region). `next.config.ts` adds
  no-referrer / noindex / no-frame / no-store headers for `/f/*` and
  `/api/founder/*`.
- **Editor side**: `FounderShareControl` per project (closed by default; link
  shown once), and `ThreadView` under the selected pin in `CapturePanel`
  with a "Follow up as Lucas" composer.

## What broke, and dead ends

- First cut of the thread store tests seeded three captures on one page with
  `attempt: 1` each and hit the `(page, variant, attempt)` unique index; the
  seed helper now numbers attempts.
- The trigger proof asserted `rejects.toThrow(/append-only/)` on the Drizzle
  call, but Drizzle wraps the driver error and the trigger message is on the
  `cause` chain; the test now walks the chain like `db-schema.test.ts` does.
- A read-only canvas test queried `within(stage()).getByTestId("capture-stage")`,
  i.e. searched an element for itself; replaced with a direct assertion.
- The founder-view component test typed the captured request body as
  `unknown`; narrowed at the assertion site.
- Considered extending the project hierarchy payload with share status and
  rejected it (DRAFT-5): it would change every fixture and put capability
  metadata on a payload the founder route also serves.
- Considered a `founder_sessions` table and rejected it (DRAFT-1): the
  project row already carries the only authority that changes on rotation.

## What could not be validated here

- Everything env-gated. There is no `.env.local` in this container, so:
  - `e2e/founder.spec.ts` (link open, founder reply, editor follow-up,
    rotation kills the old link, revocation, founder-page headers) **skips**;
    it has not run against a real server, a real Turso, or a real browser.
    A human with `.env.local` and the seeded Chickpea project must run
    `npm run e2e` (or `npx playwright test e2e/founder.spec.ts`) and watch it.
  - The other env-gated Playwright specs and the `test/integration/` suites
    also skip, exactly as they do in CI.
- Real Turso semantics of the `RETURNING` upsert in the reply throttle: proven
  against in-memory libSQL only (same pattern as the login throttle, which
  has a real-Turso integration test).
- The founder page's response headers from `next.config.ts` are asserted in
  the e2e spec only; the production build succeeded but no request was made
  against it here beyond what the ungated specs cover.
- The e2e spec leaves side effects by design: two immutable thread entries
  per run on the fixture pin (append-only, cannot be cleaned up), a fixture
  pin created once on the seeded desktop capture if none exists, and the
  seeded project's founder link rotated and then revoked.

## Judgment calls the owner should review

- No new boundary constants (DRAFT-2): founder sessions use the editor
  lifetime and renewal policy.
- Founder denials on shared routes reuse the editor's exact denial (DRAFT-3);
  a founder of another project gets a 401, never a 404.
- Revoke on a project that never issued a link is a 409; revoking twice is
  idempotent; re-issuing after a revoke clears the revocation and bumps the
  version.
- `frame-ancestors 'none'` is the only CSP directive set (DRAFT-6); a full
  nonce-based CSP is deferred.
- Manifest and context routes stay editor-only; the founder view never needs
  them.
