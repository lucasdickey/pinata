# Seed data

A known Pinata state, kept in the repository and rebuilt on demand (D142): one
project with a captured page, four marks, a founder link, and the founder's
replies. The demo video is filmed from it (`remotion/demo/README.md`), and it
gives any local run real screenshots to look at without touching the shared
database.

## What is here

| File | What it is |
| --- | --- |
| `chickpea.json` | The seed: the project, its page, and each mark with its geometry, element, note, and replies. The same marks as the landing's example (`src/lib/example-capture.ts`); `test/seed.test.ts` keeps the two in step. |
| `site/pricing.html` | The page being reviewed: a made-up chickpea.co pricing page, laid out so its elements sit where the landing's example says they are. |
| `capture-site.mjs` | Captures that page on desktop and mobile exactly as the Chrome extension does (D131): the provider's own element pass, a full-page screenshot. |
| `apply.mjs` | Replays a seed into a running Pinata through its API, stage by stage. |
| `scratch.mjs` | Starts a throwaway Pinata (production build, file database, screenshots on disk) and applies a seed to it. |

## Stages

Each stage builds on the one before; a caller asks for the last one it needs.

| Stage | Adds |
| --- | --- |
| `empty` | nothing |
| `captured` | the project, its page captured on each device (imported as the extension sends a capture) |
| `marked` | the marks, each with its note and its element |
| `shared` | a founder link |
| `replied` | the founder's replies, posted through a founder session |
| `handed-off` | an agent link |

The seed goes through the API rather than into the database directly, so it
survives schema changes: it breaks only when the API it speaks changes, and
then it fails loudly with the status code.

## Using it

```bash
npm run build
npm run seed                          # a scratch Pinata at http://127.0.0.1:3100, seeded to "replied"
npm run seed -- --until marked        # stop at an earlier stage
```

It prints where the generated editor password is; sign in with it. Ctrl-C
stops the server and deletes its data. Nothing reaches the shared database,
Blob, or Browserless: `scratch.mjs` sets every provider variable itself,
empty where it must be off, because Next.js never lets `.env.local` override a
variable the shell already set. Screenshots go to a folder on disk through
`PINATA_LOCAL_BLOB_DIR` (D141), which the server honors only beside a
`file:` database and never on Vercel.

From code: `startScratch()` in `scratch.mjs`, then `applySeed({ browser,
base, password, until })` in `apply.mjs`, which returns the project, each
page's capture ids, each mark's annotation id, and the founder and agent
links.

## Changing it

- **A new mark, note, or reply:** edit `chickpea.json` and the landing's
  example in `src/lib/example-capture.ts` together (the test fails if they
  differ), then film the demo again.
- **A new kind of state** (a resolved mark, a second version of a capture, a
  second page): add a stage to `apply.mjs` after the ones it builds on, and the
  data it needs to `chickpea.json`.
- **A different page:** add an HTML file under `site/` and a page entry
  pointing at it. Keep it self-contained: the capture browser refuses every
  request but the page itself.
- **Another seed** for a different story: a new JSON file next to this one,
  passed to `apply.mjs` or `scratch.mjs` as the last argument.
