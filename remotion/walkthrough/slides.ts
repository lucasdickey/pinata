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
      "Capture a public page and pin directional feedback to the spot. Send a structured brief to a coding agent, a review link to a friend, or project notes as Markdown. The agent works outside Pinata; a friend can reply in place. The name is a portmanteau: pin, annotation, at ya.",
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
    title: "Give context to a person or agent",
    durationInFrames: seconds(10),
    notes:
      "The editor captures pages, places numbered marks, and writes directional feedback. A friend can open a person review link without an account, read the notes in place, and reply. A coding agent can open a separate, read-only brief with screenshot links, or the editor can copy the project's Markdown. Pinata does not edit the page or the agent's code.",
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
      "Each capture opens on a pan-and-zoom canvas fitted to the screenshot's width, without enlarging past its natural size. A click drops a numbered pin; a Shift-drag, or the Box tool, draws a numbered box around a region, and the Circle and Arrow tools draw the rest. Every mark is stored in screenshot pixels, so panning, zooming, and resizing never move a target, and each is named by what they say and what they point at, such as Pin 1, the comment, and the Annual toggle. Desktop and mobile captures each keep their own marks. When placing a mark, nearby captured elements are offered as context, and the editor picks one, or none.",
  },
  {
    id: "share",
    chapter: "4 · Share and reply",
    title: "Send a review link. Get replies in place.",
    durationInFrames: seconds(11),
    notes:
      "Send offers separate choices: a coding-agent link to a read-only brief with screenshots, a person review link, or a copy of project notes as Markdown. The two links are independent, persistent, and revocable; each URL appears only when created, not again when Send is reopened. A person opens the project without an account and can reply to and resolve notes in place. On a phone the note list comes first. The link's secret travels only in its URL fragment; the database stores only its SHA-256 digest. Replies remain append-only and chronological.",
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
