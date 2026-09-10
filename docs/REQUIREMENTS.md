# Pinata requirements

Pinata is a lightweight visual feedback workspace for public websites. This
page is the product requirements source; it is rendered live at `/reqs` on the
deployed application. Companion sources: [Architecture](/reqs/architecture),
[Milestones](/reqs/milestones), [Decisions](/reqs/decisions), and
[Evals](/reqs/evals).

## The name

Pinata is a portmanteau: **pin + annotate + at ya**. You pin an annotation to
the exact spot on a page, and it comes back *at ya* — the founder — with the
context attached. The name was directed by the project's owner on day one and
recorded as decision D001 with the verbatim request: "call it pinata (a
portmanteau for pin attotation at ya)". The pun is the product thesis: pinned
annotation, delivered at you.

## The problem

Giving directional feedback on a friend's website today means scattered
screenshots in a chat thread, or a heavyweight design tool for what is really
a two-minute comment. The words get detached from the exact spot on the page
they refer to, and the founder is left guessing what "the pricing table feels
cramped" actually points at.

Pinata keeps the feedback pinned to the page. It is deliberately **not** an
editing tool: no copy rewrites, no style changes, no IDE. The founder owns the
edits; Pinata makes "try tightening this" unambiguous.

## Who it serves

- **The editor (Lucas).** Creates projects, captures pages, places pins and
  markups, and writes directional comments. Authenticates with a single
  password prompt verified server-side against an environment secret.
- **The founder.** A friend who receives an unguessable project link, reads
  the annotations in place, and replies. No account, no signup. The first real
  recipient is the founder of Chickpea.

## Build status

Requirements 1, 2, 3, 5, 8, and 9 below, and the pin part of 4, are in the
current build and proven on the production deployment. The rest of 4
(rectangles, circles, and arrows), 6 (threads), and 7 (founder links) describe
the product vision; they were deferred by D051 after the milestone-1
checkpoint, and the founder loop (6 and 7) is being built on a separate branch
(D070). Until it lands, Pinata is usable by the editor alone.

## Functional requirements

1. **Projects from explicit URLs.** A project starts from one public HTTPS
   root URL plus an optional explicit URL array. Pinata does not crawl,
   discover, or auto-capture navigation links — never crawls, ever.
2. **Static captures, two viewports.** Each URL is captured once on desktop
   (1440 × 900) and once on mobile (390 × 844) as a full-page static image.
   Lazy content is scrolled out, visual motion is frozen for capture, and
   page height, time, and byte budgets are bounded.
3. **A bounded DOM manifest.** In the same browser session, Pinata extracts a
   small, sanitized manifest of visible semantic elements — tag, role, short
   visible text, accessible name, structural path, and document-space
   rectangle. It never collects HTML source, cookies, storage, form values,
   hidden content, or cross-origin iframe internals.
4. **Precise annotations.** Pins, rectangles, circles, and arrows sit on a
   pan/zoom canvas at screenshot-natural pixel coordinates, so panning,
   zooming, and resizing never move a target. Desktop and mobile captures are
   independent coordinate planes. Current build: pins only; rectangles,
   circles, and arrows are deferred (D051).
5. **Captured context.** When placing a mark, the editor sees nearby captured
   DOM elements and explicitly picks one — or "no element". The snapshot is
   descriptive context, never an executable selector or an editing mechanism.
6. **Append-only two-way threads.** The founder replies as `founder`, the
   editor follows up, and the chronology is immutable for everyone. Database
   triggers reject updates and deletes against thread entries. Deferred
   (D051); in progress on a separate branch (D070).
7. **Persistent, revocable sharing.** Founder links are high-entropy bearer
   capabilities that persist until the editor rotates or revokes them. The
   database stores digests, never tokens. Deferred (D051); in progress on a
   separate branch (D070).
8. **A public requirements hub.** Requirements, architecture, milestones,
   decisions, and evals are readable in the deployed app at `/reqs` and its
   sub-routes, rendered from the repository sources listed above.
9. **A branded landing page.** The root route shows the pinata mark directly
   above the URL capture entry, a brief value proposition, and a fully static
   example of a marked-up capture (numbered pins, a comment thread, and a DOM
   metadata panel from bundled fixture data). Anonymous submissions park in
   the tab and route to sign-in; a signed-in editor gets the same page with
   the project form active and the project list below.

## Scope

In scope for the MVP: static full-page captures of public pages; explicit URL
arrays; directional, human-authored feedback; a single editor plus link-based
founders; the Chickpea review as the first real project. The current build
(D051) is the editor half of that: capture, canvas, pins, and comments, with
the founder half deferred to the branch named above.

## Non-goals

Pinata deliberately does not do any of the following:

- source editing, copy rewrites, or style mutation — it is not an editing tool
  or an IDE;
- runtime AI or any token-consuming product feature;
- crawling or link discovery;
- authenticated or private website capture;
- interaction, animation, or video recording;
- arbitrary folders, all-pages-on-one-canvas, or cross-page connections;
- freehand drawing or curved arrows;
- real-time multiplayer or presence;
- native applications.

## Evaluation targets

The canonical real-world target is [Chickpea](https://chickpea.co/), with the
explicit URL array:

1. [https://chickpea.co/](https://chickpea.co/)
2. [https://chickpea.co/pricing](https://chickpea.co/pricing)
3. [https://chickpea.co/about](https://chickpea.co/about)
4. [https://chickpea.co/privacy](https://chickpea.co/privacy)

Chickpea captures are internal test and demo material with source
attribution, not reusable marketing assets.

## Dogfooding

Pinata reviews itself: the deployed requirements hub is captured and annotated
as a Pinata project, in this exact order:

1. `/reqs`
2. `/reqs/architecture`
3. `/reqs/milestones`
4. `/reqs/decisions`
5. `/reqs/evals`

## Security and privacy posture

The browser never holds infrastructure credentials. All database, storage, and
capture calls pass through authorized server routes. Founder capability pages
send no referrer and permit no indexing. No secret value may appear in code,
logs, screenshots, or committed artifacts. The full boundary list lives in
[Architecture](/reqs/architecture); the executable definition of done is the
mission validation contract summarized in [Evals](/reqs/evals).
