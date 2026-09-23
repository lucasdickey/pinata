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
- The pins e2e writes real pins to the shared local store by design (the
  corner-fixture pin is reused across runs; the other tests add at most
  three pins per run), so roughly sixty full local `npm run validate` runs
  would approach the 200-per-capture annotation quota on the seeded desktop
  capture (`D059`). Deletion or a scratch capture per run would make this
  free.
- Resize handles on a small selected mark (`D079`, `D082`, `D083`, reduced
  by `D096`). Handles now show only on the selected mark and only once it is
  at least 48 CSS pixels on screen, which removes the crowding on every
  unselected mark and on tiny ones. Between about 48 and 72 screen pixels a
  selected box or circle can still have its top-left handle over the number
  badge; stacking the badge above the corner handle wants a pass checked by
  eye.
- Two-finger scroll on a trackpad zooms rather than pans (`D058`'s
  scroll-to-zoom). React Flow's `panOnScroll` would make a tall page scroll
  naturally at the cost of Ctrl+wheel to zoom with a mouse; it is the
  owner's call, left open in `D096`.
- Production still sits behind Vercel's sign-in wall on every `vercel.app`
  address (`D099`); founders need a custom domain before a link can reach
  them.
- A founder link is shown to the editor once. Letting the editor copy the
  current link again would mean storing the token recoverably, a change to
  the capability posture (`D018`, `D089`) that `D097` declined to make
  quietly.
