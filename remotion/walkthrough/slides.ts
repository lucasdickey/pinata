// The slide table: the one place that says how many slides there are, how
// long each runs, and what each one says. The Remotion composition, the
// in-app player's chapter list, and the tests all read this module, so the
// video, the navigation, and the transcript cannot disagree. Dependency-free
// on purpose: it is imported by the Next.js client bundle and by Vitest.

export const COMPOSITION_ID = "PinataWalkthrough";
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const SLIDE_IDS = [
  "title",
  "problem",
  "people",
  "project",
  "capture",
  "annotate",
  "share",
  "guardrails",
  "stack",
  "documented",
] as const;

export type SlideId = (typeof SLIDE_IDS)[number];

export interface WalkthroughSlide {
  id: SlideId;
  /** Short label for the chapter list. */
  chapter: string;
  /** The on-screen headline. */
  title: string;
  durationInFrames: number;
  /** What the slide says, in prose, for reading alongside or instead of it. */
  notes: string;
}

const seconds = (s: number) => s * FPS;

export const SLIDES: readonly WalkthroughSlide[] = Object.freeze([
  {
    id: "title",
    chapter: "pinata",
    title: "pin + annotate + at ya",
    durationInFrames: seconds(8),
    notes:
      "Pinata is a lightweight workspace for giving directional feedback on a friend's public website. You pin a note to the exact spot on a page, share one link, and the founder replies in place. The name is a portmanteau: pin, annotation, at ya.",
  },
  {
    id: "problem",
    chapter: "The problem",
    title: "Feedback comes loose from the spot it points at",
    durationInFrames: seconds(10),
    notes:
      "Today, feedback on a friend's site means scattered screenshots in a chat thread, or a heavyweight design tool for a two-minute comment. Either way the words get detached from the exact spot they refer to, and the founder is left guessing what 'the pricing table feels cramped' actually points at. Pinata keeps the note on the pixel. It is deliberately not an editing tool.",
  },
  {
    id: "people",
    chapter: "Who it's for",
    title: "Two people, one link",
    durationInFrames: seconds(10),
    notes:
      "There are two roles. The editor, Lucas, captures pages, places numbered pins, and writes directional comments after a single password prompt. The founder is a friend who receives an unguessable link, reads the annotations in place, and replies. No account, no signup. The first real recipient is the founder of chickpea.co, which is also the canonical test target.",
  },
  {
    id: "project",
    chapter: "1 · Create a project",
    title: "Start from explicit URLs. Never crawl.",
    durationInFrames: seconds(10),
    notes:
      "A project starts from one public HTTPS root URL, optionally with an explicit list of additional page URLs. Pinata captures exactly those addresses, in that order. It never discovers or follows links on its own.",
  },
  {
    id: "capture",
    chapter: "2 · Capture",
    title: "Capture each page, twice, as a still",
    durationInFrames: seconds(12),
    notes:
      "A managed headless browser, Browserless, loads each URL on a desktop viewport of 1440 by 900 and a mobile viewport of 390 by 844. It scrolls out lazy-loaded content, returns to the top, freezes animation, and takes one full-page screenshot. In the same session it extracts a small, sanitized manifest of visible elements: tag, role, short text, and position. Never HTML source, cookies, storage, or form values.",
  },
  {
    id: "annotate",
    chapter: "3 · Annotate",
    title: "Pin notes to the exact pixel",
    durationInFrames: seconds(12),
    notes:
      "Each capture opens on a pan-and-zoom canvas at the screenshot's own size. A click drops a numbered pin; a Shift-drag, or the Box tool, draws a numbered box around a region. Both are stored in screenshot pixels, so panning, zooming, and resizing never move a target, and both are named by what they say and what they point at, such as Pin 1, the comment, and the Annual toggle. Desktop and mobile captures each keep their own marks. When placing a mark, nearby captured elements are offered as context, and the editor picks one, or none.",
  },
  {
    id: "share",
    chapter: "4 · Share and reply",
    title: "Share one link. Get the reply in place.",
    durationInFrames: seconds(11),
    notes:
      "A persistent, revocable link opens the project in a read-and-reply-only founder view: on a phone the list of notes comes first, and tapping one brings the screenshot to it. The link's secret travels only in the URL fragment, and the database stores only its SHA-256 digest. Threads are append-only and chronological: the founder replies, the editor follows up, and nobody, including the founder, can edit or delete a founder reply. Either side can mark a note resolved, or reopen it, and the thread records who did so.",
  },
  {
    id: "guardrails",
    chapter: "Guardrails",
    title: "Guardrails, on purpose",
    durationInFrames: seconds(10),
    notes:
      "Public pages only. Static captures only. No runtime AI. Directional feedback only: no copy rewrites, no style changes, no IDE. No crawling. The founder owns the edits; Pinata just makes 'try tightening this' unambiguous.",
  },
  {
    id: "stack",
    chapter: "How it's built",
    title: "The stack, and the one gate",
    durationInFrames: seconds(10),
    notes:
      "Next.js, React, and TypeScript on Vercel. Turso (libSQL) with Drizzle for metadata, private Vercel Blob for screenshots, Browserless for capture, and React Flow for the canvas. One command, npm run validate, is the whole quality gate: lint, typecheck, tests, a docs freshness check, the production build, and Playwright end-to-end, in that order, locally and in CI on Node 24.",
  },
  {
    id: "documented",
    chapter: "The decision trail",
    title: "The decisions are part of the product",
    durationInFrames: seconds(11),
    notes:
      "Every material decision lives in one JSON file and is tagged with its origin: human directed, agent proposed and human approved, agent decided alone, or raised and deferred. Each tag is backed by a verbatim quote, and a record without its evidence fails the build. The log renders as a Markdown file, a browser dashboard, and live pages at /reqs in the deployed app.",
  },
]);

/** Frame at which each slide begins, in slide order. */
export const SLIDE_STARTS: readonly number[] = Object.freeze(
  SLIDES.reduce<number[]>((starts, slide, i) => {
    starts.push(i === 0 ? 0 : starts[i - 1]! + SLIDES[i - 1]!.durationInFrames);
    return starts;
  }, []),
);

export const TOTAL_FRAMES = SLIDES.reduce((sum, s) => sum + s.durationInFrames, 0);

export function slideStartFrame(index: number): number {
  const clamped = Math.min(Math.max(index, 0), SLIDES.length - 1);
  return SLIDE_STARTS[clamped]!;
}

/** Which slide is on screen at a frame; frames past the end map to the last slide. */
export function slideIndexAtFrame(frame: number): number {
  if (!Number.isFinite(frame) || frame <= 0) return 0;
  for (let i = SLIDES.length - 1; i >= 0; i--) {
    if (frame >= SLIDE_STARTS[i]!) return i;
  }
  return 0;
}

export function formatDuration(frames: number): string {
  const total = Math.round(frames / FPS);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
