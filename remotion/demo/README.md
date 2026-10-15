# The landing's demo video

The video under the hero on yourpinata.dev is the real product, filmed screen
by screen and played back with a cursor, typing, a drawn circle, and a camera
that leans in on what matters (D140). Nothing in it is drawn to look like
Pinata: every screen is a screenshot of Pinata itself, taken from a local
build on a scratch database by a script, so the video can be brought up to
date one part at a time as the product changes.

## How it fits together

```
scripts/seed/            the demo data: a pricing page, its four marks and replies (scripts/seed/README.md)
scripts/demo/story.mjs   the story, scene by scene: what to click and type, which screens to keep
scripts/demo/film.mjs    films the story into the files below
public/demo/*.webp       the screens, one per shot and theme, 1440 × 900 at 1.5×
remotion/demo/shots.json what is on each screen: its targets, text fields, marks, and when it was filmed
remotion/demo/timeline.ts the script of the video: beats over those screens
remotion/demo/PinataDemo.tsx draws a frame: the screen, the camera, the cursor, the typing, the captions
src/components/demo-video.tsx the player on the landing, its chapters, and the still for reduced motion
```

Three layers, each changed for its own reason:

| You want to | Change | Then |
| --- | --- | --- |
| show the product as it is now | nothing; film again | `npm run demo:film -- --scenes <scene>` |
| change what happens in the product (new step, other clicks) | `scripts/demo/story.mjs` | film that scene |
| change the video's pacing, camera, captions, or order | `remotion/demo/timeline.ts` | nothing to film |
| change the demo data (a mark, a note, a reply) | `scripts/seed/chickpea.json` and `src/lib/example-capture.ts` | film every scene |

## The scenes

| Scene | Starts at seed stage | Shots | Shows |
| --- | --- | --- | --- |
| `capture` | `empty` | `capture-form`, `capture-typed`, `capture-progress`, `capture-ready` | New project, the address typed, capturing, both devices ready |
| `annotate` | `captured` | `annotate-canvas`, `annotate-pin`, `annotate-pin-saved`, `annotate-circle`, `annotate-done` | A pin on the toggle, a circle on the price, then the arrow and box |
| `share` | `marked` | `share-canvas`, `share-panel`, `share-created`, `share-copied` | Share with founder: create the link, copy it |
| `founder` | `shared` | `founder-open`, `founder-selected`, `founder-typed`, `founder-replied` | The founder's view: open pin 1, reply in place |
| `reply` | `replied` | `reply-unread`, `reply-open` | Back in the workspace: 1 new, the reply in the thread |
| `agent` | `replied` | `agent-canvas`, `agent-panel`, `agent-created`, `agent-copied` | Agent link: create it, copy the prompt; the video then shows the brief the link returns |

The video's five chapters (Capture, Annotate, Share, Reply, Hand off) are
defined in `timeline.ts`; the `founder` and `reply` scenes are both in the
Reply chapter.

## Updating part of the video

```bash
npm run build                                  # the films are taken from the production build
npm run demo:film -- --list                    # which scenes are stale, and the commits that made them so
npm run demo:film -- --scenes share            # film one scene again, in both themes
npm run demo:film -- --scenes founder,reply    # or several; scenes run in story order
npm run demo:film                              # or all of them
```

A run starts its own scratch Pinata on 127.0.0.1:3100 for each theme (stop any
other server there first), seeds it straight to the first chosen scene's
stage, and films forward. Scenes between two chosen ones run without saving
shots, to carry the state along. Shots of scenes that were not chosen are left
alone, so the video keeps them. A scene filmed in both themes that no longer
takes one of its old shots has that shot deleted.

`--list` marks a scene stale when a commit after its filming touched one of
the `sources` the scene lists in `story.mjs`. It does not watch the
stylesheet, which nearly every commit touches: after a style change, look at
the video and film the scenes that changed.

The shots record where every target sits, so when a button moves, filming
again moves the cursor with it. The beats name targets, not coordinates.

After filming, check the result in Remotion Studio (`npm run walkthrough`,
then choose `PinataDemo`; set the `theme` prop to `dark` for the other half),
run `npm test` (`test/demo-video.test.ts` fails if a beat names a target, a
field, or a shot that is gone), and commit `public/demo/` and `shots.json`
together.

## Adding a scene

1. In `story.mjs`, add the scene where it belongs in the story: an `id`, a
   `title`, the seed stage it starts `from`, its `sources`, and a `run` that
   drives the product and calls `director.shoot(id, { targets, fields, capture })`
   for each screen the video needs. `targets` are the elements the cursor
   visits; `fields` are text boxes the video types into (with the text);
   `capture: true` records where the capture sits on the canvas and where each
   seed mark lands on screen.
2. If the scene needs a starting point the seed does not reach, add a stage to
   `scripts/seed/apply.mjs` rather than building the state by hand.
3. Film it: `npm run demo:film -- --scenes <id>`.
4. Add its beats to `timeline.ts`, and a chapter if it is a new part of the
   story.

Candidates for later: the Chrome extension's capture of a signed-in screen
(D131), the mobile capture, and resolving a mark.

## What the video does to keep the product honest

- The page being reviewed is the seed's copy of chickpea.co/pricing, served
  only to the filming browser; the scratch server never contacts the real
  site, Browserless, Blob, or the shared database.
- Links read yourpinata.dev: the shots replace the scratch server's address
  in the link fields before each screenshot. The tokens are real ones from
  the scratch run, and dead.
- The typing and the circle being drawn are drawn over the screen in the
  page's own fonts and colors, then cut to the real screen once done.
- The agent's terminal is only a frame; the prompt and the brief in it are
  the product's own words, kept when the `agent` scene was filmed.
- Times in the shots (a reply's "Oct 15, 11:07 AM") are when the scene was
  filmed; scenes filmed on different days show different dates.
