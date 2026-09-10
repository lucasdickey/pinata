# What I'd do next with more time

Answers the assignment's third interview question. Updated opportunistically as
scope gets cut, rather than reconstructed at the end.

## Cut during the build

_Nothing cut yet. Entries here should link to the decision record that cut them._

## Would build next

- **Voice-over and captions for the walkthrough** (`D072`). The slide table
  already carries a prose transcript per chapter; Remotion can time captions
  from it and mix a recorded narration track, which would make the rendered
  MP4 self-explanatory without the page around it.

## Known weaknesses

_Honest list. Things a reviewer would find if they looked for five minutes._

- The `/walkthrough` route ships the Remotion runtime to the browser and
  animates with JavaScript, so it does not honor `prefers-reduced-motion` the
  way the rest of the app's CSS does (`D073`). The transcript beside the
  player is the reduced-motion path; a paused-by-default mode keyed to the
  media query is the obvious follow-up.
- The walkthrough's imagery is a derived copy of the brand board and two
  dashboard screenshots under `public/walkthrough/`. If the dashboard
  screenshots are retaken, the copies do not update on their own; the test
  only proves the files exist and match their declared sizes.

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
- Pins cannot yet be edited or deleted (`D059`): the schema already carries
  tombstones and the non-reuse numbering rule, but no route or UI mutates a
  pin beyond move. A reviewer looking for comment editing or pin removal
  will not find them.
- The pins e2e writes real pins to the shared local store by design (the
  corner-fixture pin is reused across runs; the other tests add at most
  three pins per run), so roughly sixty full local `npm run validate` runs
  would approach the 200-per-capture annotation quota on the seeded desktop
  capture (`D059`). Deletion or a scratch capture per run would make this
  free.
