# Pinata brand

The visual and verbal identity of Pinata, gathered from what is already in the
repository and adhered to going forward.

The values below are copied from their sources so the file reads on its own,
but the sources stay authoritative: `app/globals.css` for tokens,
`src/lib/brand-mark.ts` for the mark, `docs/decisions/decisions.json` for
why. Tests lock the contrast ratios and the mark; if a value here disagrees
with a test, the test is right and this file is stale.

**Keep this file current.** Any material branding decision (a new color, a
typeface, a change to the mark or the character, a new tagline, a casing or
voice rule) gets a record in `decisions.json` and an edit here, in the same
commit. See the last section for the checklist.

---

## 1. Name, taglines, and voice

**The name.** "Pinata", capitalized, everywhere in running text, headings,
page titles, the footer, and the logo's spoken name (`aria-label`). The only
lowercase "pinata" is the logo wordmark itself, the repository, and the
package name (D127). The product name carries no tilde. "Piñata" with the
tilde refers to the object and the character: "the piñata character", "the
piñata orange".

**What the name means.** pin + annotation + at ya. The README and the page
metadata spell it out as `pin + annotation + at ya`; the brand board sets it
under the wordmark as `Pin. Annotate. At ya.`; the landing hero sets it as
**Pin** + **annotate** + at **ya** with the key syllables emphasized. All
three are the same idea; pick the form that fits the surface.

**Footer line.** "A little feedback goes a long way."

**Casing.** Sentence case for every label, heading, link, and button. No CSS
that forces lowercase or uppercase on copy (D127 removed the last of it).

**Voice.** Plain, short, and directional. Pinata is for saying "try
tightening this", not for making the edit; the founder owns the edits
(README, D012). Write the way the landing does:

- "A two-minute comment should take two minutes."
- "Capture the page." "Pin it where it happens." "Send one link."
- "Give your feedback a place to land."

Speak the user's language, not the system's (D078): a pin is named by its
comment and the element it points at, and internals sit behind a disclosure.
Sections on the landing open with a short plain line (the eyebrow), then a
large light heading, then the content.

---

## 2. The mark

One source, `src/lib/brand-mark.ts`, renders the mark everywhere: inline on
the landing (`<PinataLogo>`), as the favicon (`app/icon.svg`), and in the
walkthrough. `test/brand-mark.test.tsx` locks the landing and favicon to it.
No raster logo is ever fetched on a page (VAL-LANDING-001).

**What it is.** A map-pin teardrop whose bulb is the piñata character's head
in profile: two tall rounded ears, a white eye patch with a round pupil, the
pin's tip in spark orange, and two orange sparks flying off to the upper
right where the piñata breaks. It sits on a white rounded tile (64 × 64
viewBox, corner radius 14). Both paths are vector traces of the app-icon
tile and use the even-odd fill rule so the eye patch stays open.

| Part | Value | Equals token |
| --- | --- | --- |
| Tile fill | `#ffffff` | `--surface` (light) |
| Body and sparks | `#fe512d` | `--brand-spark` |
| Head | `#0d0d0d` | `--brand-ink` |

The tile stays white in dark mode on purpose (D104); the mark is ink on a
light tile and is not redrawn for dark.

**Rules.**

- Do not redraw, restyle, or recolor the mark. Scale it; that is all.
- The spark orange `#fe512d` is a mark color, never a text color. Text that
  needs the brand color uses `--accent` (section 3).
- The character stays head-and-pin. It is never drawn as a full-bodied
  animal (the illustration prompts say so explicitly).

**Naming the animal.** The code and tests call the head a llama; the
illustration prompts described it to the image model as a donkey so the
tall ears would survive. In copy, say "the piñata character" or "the
mascot" and do not name the species until the owner picks one.

**Brand board and derived assets.** The exploration sheet is
`docs/brand/logo-exploration-2026-09-06.png`. Renders cut from it live in
`public/walkthrough/` (horizontal and stacked logo, wordmark with and
without tagline, circle marks on orange and on dark, light and dark app
icons, the "p" letter, the loading spark). They are used only by the
walkthrough video.

**Wordmark.** Lowercase "pinata" in a heavy rounded geometric sans, near
black, with the tagline beneath in a light, letter-spaced sans. It exists
only as a raster on the board and is not used in the app. The top bar sets
the lowercase "pinata" in Inter beside the mark, with "Pinata home" as the
link's spoken name.

---

## 3. Color

Direction from paper.design (D102): a warm off-white sheet, near-black type,
hairline rules, and the interface almost monochrome so the screenshot being
reviewed carries the color. One accent, reserved for marks and a few
purposeful signals.

### Light theme (default)

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#fcfcf9` | The sheet. Page background. |
| `--surface` | `#ffffff` | Cards, inputs, the mark's tile. |
| `--raised` | `#f3f2eb` | A cream one step down: resting buttons, selected rows, inline code. |
| `--ink` | `#141414` | Body text, links, headings, selected controls. |
| `--ink-strong` | `#000000` | Primary button hover. |
| `--ink-soft` | `#666666` | Secondary text (5.59:1 on the sheet). |
| `--ink-quiet` | `#868682` | Large text only, 24px and up: the second tone of a headline (3.56:1). Never body copy. |
| `--accent` | `#c9381a` | The brand spark deepened until it clears 4.5:1 on `--bg`, `--surface`, and `--raised`. Marks and open badges, unread counts, errors, destructive states, and mark-linked thread rules. |
| `--accent-soft` | `#fbe7df` | Tints behind accent content. |
| `--focus` | `#2d6fcd` | Focus rings. The one blue in the interface. |
| `--line` | `#e2e1dc` | Hairline rules and card borders. |
| `--line-strong` | `#cfcec8` | Control borders. |
| `--code-bg` | `#f3f2eb` | Code blocks. |
| `--brand-ink` | `#0d0d0d` | Mark only. |
| `--brand-spark` | `#fe512d` | Mark only. |
| `--status-accepted` | `#1a7f37` | Decision status text. |
| `--status-superseded` | `#9a6700` | Decision status text. |
| `--status-pending` | `#57606a` | Decision status text. |

### Dark theme

Paper's dark sheet as direction (D104). Follows the device unless the visitor
has saved a choice.

| Token | Value |
| --- | --- |
| `--bg` | `#181818` |
| `--surface` | `#1f1f1e` |
| `--raised` | `#2a2a27` |
| `--ink` | `#efefe4` |
| `--ink-strong` | `#ffffff` |
| `--ink-soft` | `#a8a8a2` |
| `--ink-quiet` | `#7c7c77` |
| `--accent` | `#ff6b47` |
| `--accent-soft` | `#3a211a` |
| `--focus` | `#81adec` |
| `--line` | `#2e2e2b` |
| `--line-strong` | `#464641` |
| `--code-bg` | `#262623` |
| `--status-accepted` | `#4ac26b` |
| `--status-superseded` | `#d4a72c` |
| `--status-pending` | `#9198a1` |

`--brand-ink` and `--brand-spark` do not change with the theme.

### Rules

- **Reserve the accent for marks and their context.** Pins, circles, arrows,
  boxes, open number badges, unread counts, errors and destructive actions
  or states may use it. The rule beside a mark-linked comment thread may
  use it to tie the message to its mark. Navigation, selected rows and
  controls, add actions, links, the wordmark, and headings use ink, not
  accent (D102, D137).
- **Two oranges, two jobs.** `--brand-spark #fe512d` is the mark's and the
  illustrations' orange and carries no contrast contract. `--accent` is the
  same hue deepened (light) or lifted (dark) so it passes WCAG AA as text.
  Never put `--brand-spark` behind or as text.
- **Measured before chosen.** Every text pairing clears 4.5:1 (3:1 for large
  text). `test/visual-tokens.test.ts` fails the gate if `--accent`,
  `--ink-soft`, `--ink-quiet`, or the status colors drift under the floor,
  and asserts the two dark blocks in the stylesheet stay identical (D047,
  D104).
- **One blue.** `--focus` is the only blue, and it only draws focus rings
  and text selection.
- **No raw hex in components.** Colors go through the tokens. The named
  exceptions are the mark source (a favicon file cannot read custom
  properties) and the illustration mats below.

### Color that stays fixed in both themes

- Captured screenshots and the landing's example page: they depict someone
  else's light website, as a real capture would (D104).
- The mark's white tile.
- The illustration mats: ivory `#f6f0e7` behind the hero art and `#f7f2e9`
  behind the process cards, so the black character stays legible on dark
  (D107).
- The walkthrough video's palette. It adds two colors from the brand board
  for its dark slides only: night `#151312` and ember `#ff5a2d`
  (`remotion/walkthrough/theme.ts`, locked to the light tokens by
  `test/walkthrough-slides.test.ts`).

### The halftone wash (D119)

The one place the orange spreads: two decorative halftone washes on the
public landing, behind the hero and around the sign-in mascot. Pure CSS,
colored through `--accent` so it follows the theme (orange on cream in
light, orange on black in dark), dots that grow where the wash is strong
and vanish where it fades. It is decoration: `aria-hidden`, no pointer
events, hidden under forced-colors mode, and never behind body text.

---

## 4. Typography

**Face.** Inter, self-hosted as one variable file
(`public/fonts/inter-latin-wght-normal.woff2`, SIL Open Font License in
`public/fonts/Inter-OFL.txt`). No page makes a third-party font request.
Paper's own typeface, Matter, is commercial and was not copied (D102).

```
--font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif
--font-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace
```

**Base.** 16px, line-height 1.55, letter-spacing 0.003em, Inter's `cv11`
(single-storey a), antialiased.

**Weights.** Light where the type is large, firmer as it gets small. The
variable file makes the in-between weights available; use them.

| Weight | Where |
| --- | --- |
| 360 | Display headlines: the landing hero and section headings. |
| 400 | Body. |
| 420 | `h1`, `h2` by default. |
| 450 to 480 | Controls: buttons, the top bar, button-like links. |
| 500 to 550 | `h3`, `h4`, emphasis, badge numbers, panel headings. 550 is the workhorse. |
| 580 | `strong`. |
| 600 to 650 | Rare. The extension popup's title. |
| 700 and up | Not in the app. The walkthrough video uses 700 and 800 for legibility at video scale only. |

**Scale.**

| Role | Size | Tracking | Line height |
| --- | --- | --- | --- |
| Landing display (`h1` and the statement) | `clamp(2.5rem, 6.4vw, 4rem)` | -0.025em | 1.02 |
| Illustrated hero display | `clamp(2.5rem, 4.5vw, 3.45rem)` | -0.025em | 1.07 |
| Landing section `h2` | `clamp(1.75rem, 4vw, 2.75rem)` | -0.02em | 1.08 |
| In-app page heading | `clamp(1.9rem, 4vw, 2.5rem)` | -0.025em | 1.08 |
| `h1`, `h2` default | inherited | -0.02em | 1.15 |
| `h3`, `h4` | 1rem to 1.25rem | -0.005em | 1.3 |
| Lead paragraph | 1.125rem | | 1.6 |
| Body | 1rem | 0.003em | 1.55 |
| Secondary, rows, panel text | 0.95rem, 0.9rem, 0.85rem | | |
| Captions, meta, eyebrows | 0.8rem, 0.78rem | | |
| Key caps | 0.7rem | | 1 |

**Patterns.**

- The two-tone headline: the name in `--ink`, the promise in `--ink-quiet`,
  same size, same weight (360), the promise capped at about 21 characters a
  line.
- Headings get `text-wrap: balance`; paragraphs get `text-wrap: pretty`.
- Links are ink with a 1px underline at 35% ink, offset 0.2em, that firms to
  full ink on hover. The underline, not a color, marks a link.
- Monospace is for code and addresses only, at 0.85em to 0.92em of the
  surrounding text, on `--code-bg`.
- Numbers that line up (counts, timers) use `font-variant-numeric:
  tabular-nums`.

---

## 5. Shape, surface, and spacing

**Hairlines.** Rules and borders are `--hairline`: 1px, and 0.5px (one
device pixel) on high-density screens.

**Radii.** `--radius-sm` 4px (buttons, key caps, focus rings),
`--radius` 8px (cards, raised panels), `--radius-lg` 12px, inputs 6px. The
illustration mats are softer: 1.5rem on the process cards, and a hand-cut
blob on the hero mat, rotated two degrees.

**Measures.** `--max` 46rem for a reading column; `--wide` 72rem for the
landing and the editor workspace.

**Controls.**

- Secondary button: `--raised` fill, hairline `--line-strong` border,
  4px radius, weight 480, padding 0.3rem 0.8rem. Hover darkens toward the
  border color.
- Primary button (`type="submit"` or `.button-primary`): solid `--ink`,
  text in `--bg`, hover to `--ink-strong`. One per form.
- Pressing any button scales it to 97% for 150ms. Disabled is 50% opacity.
- Inputs: `--surface` fill, hairline `--line-strong` border, 6px radius.
- Focus: a 2px `--focus` outline, offset 2px, on every focusable element.
- Icon buttons in the canvas toolbar: square, quiet at rest, cream on
  hover, solid ink while pressed. Their tooltips name the control and draw
  the shortcut as a key cap.
- Navigation in rails and lists reads as rows split by hairlines, not
  stacked buttons. Selected rows and tools are solid ink.

**Surfaces.** Cards are `--surface` with a hairline `--line` border and the
8px radius. Raised things (menus, the floating toolbar pill) are `--raised`.
There are almost no shadows: only the pin badge's small drop shadow and a
one-pixel white halo under mark strokes so they read on any screenshot.

**Rhythm.** One spacing rule per region. In the editor panel every heading
gets the same space above it and none above the first (D113). On the
landing, sections are separated by `clamp(3.5rem, 9vw, 7rem)`.

---

## 6. Motion

- Color, border, opacity, and underline changes: 150ms ease-out.
- Transforms (the press, a lifting pin, a sliding panel): 140ms to 220ms
  ease-out.
- Tooltips appear after a 400ms hover pause, at once on keyboard focus
  (D118). They fade; they do not move.
- One entrance animation, the hover card for a mark, 140ms after a 260ms
  pause.
- Reduced motion is respected: the landing demo falls back to the static
  example, and nothing else animates.

---

## 7. Marks on the canvas

The marks are where the accent lives. They are drawn the same way on the
canvas, in the landing example, and in the walkthrough.

| Mark | Drawn as |
| --- | --- |
| Pin | An `--accent` teardrop with a `--surface` stroke and a small drop shadow; the number rides in the bulb in `--surface` at weight 550. |
| Circle, arrow, box | An `--accent` stroke of constant screen width at any zoom, round caps, a one-pixel white halo. |
| Selected | The stroke turns to `--ink`. |
| Draft | Dashed. |
| Resolved | The badge uses `--ink-soft` behind `--bg` digits to keep its small number AA-readable; a box's badge is squared. |

The number badge in the panel list matches the badge on the canvas, so a
row and its mark are tied at a glance (D113).

---

## 8. Illustration

The paper-cut style (D107) extends the character into editorial
illustrations on the public landing only: a split hero, three process
steps, a pencil mascot beside sign-in, a resting footer mascot, and a sheet
of decorative elements (burst marks, confetti, a curved arrow, an
annotation circle, a looped streamer, a sparkle, chain links, paper
fringe). Files live in `public/illustrations/`; the prompts that generated
them are in `docs/brand/homepage-illustration-prompts.json` and are the
style guide for any new piece:

- Flat near-black `#0d0d0d` and vivid orange `#fe512d`, with ivory and pale
  peach secondary shapes.
- Subtly imperfect curves, crisp edges, almost no texture.
- Zero shadows, glow, bloom, gradients, or enclosing tile. Transparent
  background with a generous clear perimeter.
- No text or lettering inside an illustration.
- The character keeps its exact identity: the head, two tall rounded ears,
  the white muzzle with one black dot, the orange pin bottom. Never a full
  body.
- Sophisticated, minimal, independent-software feel; playful but restrained.

The app itself (the editor, the founder view, the requirements hub) is
illustration-free. Illustrations sit on light ivory mats in both themes.

---

## 9. Theming

Light is the default. With no saved choice the page follows
`prefers-color-scheme`; the toggle (a sun or moon icon button named "Dark
mode") saves `light` or `dark` under the `pinata:theme` key in
localStorage, and a script in `<head>` applies it before first paint
(D104, `src/lib/theme.ts`). The dark values are written twice in the
stylesheet (device preference and saved choice) and must match. Native
controls follow through `color-scheme`.

---

## 10. Accessibility is part of the brand

- Text clears WCAG AA: 4.5:1, or 3:1 at 24px and up. Small text
  uses `--ink-soft`, and resolved badge digits clear 4.5:1 in both themes.
  Locked by `test/visual-tokens.test.ts`.
- Every focusable element shows the `--focus` ring.
- Decoration (the washes, the illustrations) is `aria-hidden` and
  disappears under forced-colors mode; the page reads fine without it.
- The public surfaces pass an axe sweep in both themes (`e2e/theme.spec.ts`).
- Working labels keep their exact names so screen readers and tests hear
  the same thing; sentence case is applied in the markup, not by CSS.

---

## 11. Surfaces that diverge, and why

- **The decision dashboard** (`docs/dashboard/index.html`) uses a
  GitHub-like palette and the system font. It is a zero-dependency internal
  tool that opens over `file://`, kept deliberately separate from the
  product (D004). Leave it.
- **The Chrome extension popup** (`extension/popup.css`) mirrors the token
  names and most values but uses the system font (no bundled Inter), fills
  its primary button with the accent instead of ink, and draws focus rings
  in the accent instead of blue. Bring it in line if it ever grows beyond a
  utility popup.
- **The walkthrough video** uses weights 700 and 800 and the board's night
  and ember colors on dark slides, for legibility at video scale.

---

## 12. Changing the brand

A material branding decision is any change to: the name or how it is cased,
a tagline, the voice rules, the mark or the character, a token value, the
typeface or the weight scale, the illustration style, or what the accent is
allowed to color. When one lands:

1. Record it in `docs/decisions/decisions.json` with its origin, and run
   `npm run docs`.
2. Change the source: `app/globals.css` for tokens (both dark blocks),
   `src/lib/brand-mark.ts` for the mark, `remotion/walkthrough/theme.ts`
   for the walkthrough.
3. Update the tests that lock the old value: `test/visual-tokens.test.ts`,
   `test/brand-mark.test.tsx`, `test/walkthrough-slides.test.ts`.
4. Update this file in the same commit, and cite the decision ID.

Decisions behind this file: D001 (the name), D012 (what Pinata is and is
not), D047 (accent to AA), D066 (the mark as the landing's logo), D078
(speak the user's language), D102 (direction from paper.design), D104 (dark
theme), D107 (illustration set), D113 (panel rhythm), D118 (Geist
interaction patterns), D119 (halftone wash), D127 (sentence case and
"Pinata"), D136 (this file), D137 (AA and accent scope).
