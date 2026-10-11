# Recommendations log

Ideas the agent has put forward that were not taken up yet. Each entry says
what was recommended, why, what it would cost, and what would make it worth
doing. When one is acted on or turned down, it stays here with its outcome and
the decision record that settled it, so the trail reads whole.

This is not the decision log. `docs/DECISIONS.md` records what was chosen; this
file records what was suggested and is still open. A recommendation that is
raised with the owner and consciously postponed also gets a `user-deferred`
record in `docs/decisions/decisions.json`, which points here.

Format: newest at the bottom. One heading per recommendation, with its date, the
decision record that deferred it, and a status line (`open`, `done`, `declined`).

---

## R001 — Serve crops of a screenshot from Pinata

- Raised: 2026-10-11, alongside `D136`. Deferred in `D137`.
- Status: open.

**What.** A route such as `/a/<token>/captures/<id>?x=&y=&w=&h=`, or a
per-mark image link, that returns a cropped region of the stored screenshot.

**Why.** An agent that needs to see a mark on a tall full-page screenshot has
to crop around it before looking, because a vision model shrinks the whole
image to roughly 1,568 px on its long edge and the text becomes unreadable. The
agent does that crop with local tooling today (a script, sometimes a library
install), which costs it tool calls and time on every mark. A crop served by
Pinata removes that overhead. It does not reduce the image tokens themselves:
a legible crop costs a vision model about the same as any image it reads at
full detail, roughly 1,500 tokens.

**Cost.** The repository has no image codec. Stored captures are PNG from
Browserless and WebP from the extension (`D133`), so a pure-JavaScript PNG
library would not cover uploads. The honest choice is `sharp`, a native
dependency, which falls outside the pinned allowlist (`D021`) and would need
its own decision record and a check that the Vercel function size stays
within limits.

**Worth doing when.** The brief's text (element, path, nearby elements, image
size: `D136`) turns out not to be enough, and agents are still seen cropping
on most marks.

---

## R002 — Make a crop once, when a mark is saved

- Raised: 2026-10-11, alongside `D136`. Deferred in `D137`.
- Status: open.

**What.** When a mark is created or moved, cut a crop around it once and store
it in Blob beside the capture; the brief links the crop directly.

**Why.** Same benefit as R001, with the work moved from every agent read to
one write per mark. The brief then needs no crop parameters and the agent no
geometry.

**Cost.** The same codec need as R001, plus a little more storage per mark (a
1,400 × 800 PNG crop is typically 100 to 300 KB) and an invalidation rule when
a mark moves. A mark on a resolved pin would keep its crop until the capture
is cleaned up.

**Worth doing when.** R001 is wanted and the per-read cost of cropping on a
serverless function matters more than the storage.

---

## R003 — Store viewport-height tiles at capture time

- Raised: 2026-10-11, alongside `D136`. Deferred in `D137`.
- Status: open.

**What.** During the one Browserless session (`D016`), also take clipped
screenshots one viewport tall, store them as tiles, and have the brief link
the tile a mark sits on with the mark's position re-expressed relative to
that tile.

**Why.** No new dependency: Chromium takes clipped screenshots natively. Every
tile is already the size a vision model reads at full detail, so an agent
never crops.

**Cost.** More Blob storage per capture (a 13,000 px page is about fifteen
desktop tiles), pressure on the 120-second free-tier session budget, and the
extension's uploads (`D131`) would need the same tiling done in the extension
with a canvas. A mark that straddles two tiles needs both linked.

**Worth doing when.** The capture pipeline is being revisited anyway, or
Browserless time is no longer the tightest budget.
