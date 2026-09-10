# What I'd do next with more time

Answers the assignment's third interview question. Updated opportunistically as
scope gets cut, rather than reconstructed at the end.

## Cut during the build

_Nothing cut yet. Entries here should link to the decision record that cut them._

## Would build next

_To be filled in as the shape of the MVP becomes clear._

## Known weaknesses

_Honest list. Things a reviewer would find if they looked for five minutes._

- `npm audit` reports 4 moderate-severity findings in the drizzle-kit/esbuild
  toolchain (dev-only transitive dependencies). The automated fix is a breaking
  downgrade and was deliberately not applied (`D021`). Revisit when drizzle-kit
  ships a fixed dependency line.
- ESLint covers the JavaScript surface only; TypeScript/TSX relies on
  `tsc --noEmit` because typescript-eslint is outside the approved dependency
  set (`D021`). Style-level TS issues are not machine-caught.
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
