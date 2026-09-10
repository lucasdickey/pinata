# What I'd do next with more time

Answers the assignment's third interview question. Updated opportunistically as
scope gets cut, rather than reconstructed at the end.

## Cut during the build

Each entry links to the decision that cut it. "Cut" here means deferred: the
schema, boundary catalog, and eval scenarios for every item still exist, so
each can be picked up without redesign.

- **First Vercel deployment and the variant/retry integration matrix, out of
  milestone 1** (`D050`). The deployment landed later in milestone 2 (`D068`);
  the matrix's assertions were re-homed into the surviving capture features.
- **Founder capability links and the founder read/reply view** (`D051`), and
  **append-only two-way threads** (`D051`). Both were un-cut and shipped on
  2026-09-10 (`D073`); they are listed here because they were cut once, and
  because their end-to-end spec has not executed yet.
- **Rich marks: rectangles, circles, and arrows** (`D051`). The `annotations`
  table already has a `kind` column and the coordinate engine is
  mark-agnostic.
- **The warm, playful visual system and the one-minute demo pass** (`D051`).
- **Milestone-3 accessibility features** beyond what the `/reqs` axe sweeps
  already enforce (`D051`).
- **Production hardening**: partial-failure drills, redeployment continuity,
  capability rotation, and the dogfood project (`D051`).
- **Editor session-lifecycle and cross-surface auth/secret hardening**
  (`D051`).
- **The final production acceptance session**, replaced by a short pins
  session (`D051`).

## Would build next

In the order I would actually do them:

1. **Prove the founder loop end to end.** It shipped (`D073`) but
   `e2e/founder.spec.ts` is gated on local secrets and has never run, so link
   open, reply, follow-up, rotation, and revocation are specified rather than
   demonstrated. One local `npm run e2e` closes this.
2. **Separate the local and test store from production.** Local gate runs
   write into the same Turso database and Blob store as the production demo,
   kept apart only by run-scoped cleanup and an "oldest project" rule in the
   e2e helpers. A second database and store for local work removes a real
   risk to demo data.
3. **Answer `D054`.** A provider-side unsafe redirect during capture is
   permanently non-retryable, so a Browserless flake leaves a failed capture
   with no recovery in the UI. Distinguishing execution-time from
   admission-time redirects is a small catalog and retry-route change.
4. **Make the local auth bypass impossible to enable on a deployment.**
   `isAuthDisabled()` in `src/lib/server/auth/bypass.ts` returns true for
   `PINATA_AUTH_DISABLED=1` in any environment; only a comment stops it from
   being set in Vercel, where it would authorize every anonymous visitor as
   the editor. Deployment protection used to contain that mistake and no
   longer does (`D074`). Gate the function on not running on Vercel, and
   test it.
5. **Durable session revocation.** Logout is an in-memory denylist per
   serverless instance; a Turso-backed denylist, the same pattern as the
   login throttle, closes it.
6. **Rectangles, circles, and arrows**, inheriting the pin contract from
   `D061`: explicit context decision, revisioned mutations, tombstone
   deletes.
7. **Pin quota relief in the test suite**: a scratch capture per run or
   teardown deletion, so repeated gate runs stop consuming the 200-pin
   per-capture quota on the seeded capture.
8. **The visual design pass and keyboard placement of pins**, then the
   hardening list from `D051`.

## Known weaknesses

Honest list. Things a reviewer would find if they looked for five minutes.

- **The founder loop is shipped but unproven end to end.** Its Playwright
  spec skips without local secrets, so nothing has exercised link open,
  reply, rotation, or revocation against a real browser yet.
- **Production is publicly reachable** as of 2026-09-10 (`D074`), so the
  editor password and its durable throttle are the whole defence, and the
  unguarded `PINATA_AUTH_DISABLED` flag above is now a sharper edge than it
  was. Founder links themselves still 404 in production until the
  founder-links branch merges.
- **Local development, the e2e suite, and production share one Turso
  database and one Blob store.** See item 2 above.
- **Session revocation is in-memory per serverless instance.** See item 4
  above.
- `npm audit` reports 4 moderate-severity findings in the drizzle-kit/esbuild
  toolchain (dev-only transitive dependencies). The automated fix is a breaking
  downgrade and was deliberately not applied (`D021`). Revisit when drizzle-kit
  ships a fixed dependency line.
- ESLint covers the JavaScript surface only; TypeScript/TSX relies on
  `tsc --noEmit` because typescript-eslint is outside the approved dependency
  set (`D021`). Style-level TS issues are not machine-caught.
- **`npm ci` needs Node 24 and its bundled npm 11.** Under Node 22 with npm
  10 it stops with a lockfile sync error before installing anything. The
  `engines` field and the new `.nvmrc` say so, but nothing enforces it
  earlier than the failure.
- The controlled capture fixtures are served by a separate unprotected static
  Vercel project (`pinata-fixtures`, `D041`) with durable URLs committed in
  `test/fixtures/capture/host.json`; the publish step is now an idempotent
  re-verification. The real-provider suite still opts in via the
  `CAPTURE_*_FIXTURE_URL` environment and skips without it, so the gate never
  spends Browserless quota unless asked.
- An execution-time, provider-side `unsafe-redirect` (a transient
  final-URL inconsistency inside the provider session, not a genuinely
  unsafe target) is permanently non-retryable in the outcome catalog, so a
  provider flake leaves a failed attempt the product cannot recover. Whether
  to distinguish it from an admission-time unsafe target and offer retry is
  deferred (`D054`, pending user answer).
- The pins e2e writes real pins to the shared local store by design (the
  corner-fixture pin is reused across runs; the other tests add at most
  three pins per run), so roughly sixty full local `npm run validate` runs
  would approach the 200-per-capture annotation quota on the seeded desktop
  capture (`D059`). Deletion or a scratch capture per run would make this
  free.
- **Roughly thirty commits from 2026-09-08/09 were pushed to `main` in one
  batch**, so CI validated them as a group rather than one by one. Each was
  gated locally by `npm run validate` before commit (`D010`), but the remote
  graph does not show the early-and-often cadence `D011` asked for.
