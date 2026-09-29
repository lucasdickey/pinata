// Fixture data for the landing page's static example of a marked-up capture
// (VAL-LANDING-002, D066). This is the whole data source of the example: it
// lives in the repo, is bundled at build time, and triggers no /api/* request
// and no database access. Shapes deliberately mirror the real domain views
// (PinAnnotationView / PinElementSnapshot in src/lib/annotations.ts) so the
// example teaches the product truthfully. It carries one mark of each kind
// (D103): a pin, a circle, an arrow, and a box. Thread entries are depicted
// as saved content only; the example has no reply control.

import { DESKTOP_VIEWPORT } from "./boundaries";

/** One saved comment in the example thread. */
export interface ExampleThreadEntry {
  /** The server-side display label, as the real product assigns it. */
  author: "Lucas" | "founder";
  body: string;
}

/** Inert capture-time DOM context, mirroring PinElementSnapshot. */
export interface ExampleElement {
  kind: string;
  tag: string;
  role: string;
  text: string;
  path: string[];
  rect: { x: number; y: number; width: number; height: number };
}

/**
 * The geometry of one example mark, in the same shapes the real annotation
 * views use (D079, D082, D083): a pin's tip, a box's rect, a circle's square,
 * an arrow's two ends. Every coordinate is screenshot-natural CSS pixels in
 * the example frame.
 */
export type ExampleMarkGeometry =
  | { kind: "pin"; tip: { x: number; y: number } }
  | { kind: "rectangle"; rect: { x: number; y: number; width: number; height: number } }
  | { kind: "circle"; circle: { x: number; y: number; size: number } }
  | { kind: "arrow"; arrow: { start: { x: number; y: number }; end: { x: number; y: number } } };

/** One numbered mark of any kind, with its comment, context, and thread. */
export type ExampleMark = ExampleMarkGeometry & {
  number: number;
  body: string;
  element: ExampleElement | null;
  thread: ExampleThreadEntry[];
};

/** The depicted capture viewport: the standard Desktop capture frame. */
export const EXAMPLE_CAPTURE_FRAME = {
  width: DESKTOP_VIEWPORT.width,
  height: DESKTOP_VIEWPORT.height,
} as const;

/**
 * The example page's layout, shared by the drawn page and the marks so each
 * mark lands on exactly the element its snapshot names.
 */
export const EXAMPLE_LAYOUT = {
  toggle: { x: 540, y: 300, width: 360, height: 52 },
  /** The toggle's right half: the "Annual (save 20%)" switch pin 1 is about. */
  annual: { x: 720, y: 304, width: 176, height: 44 },
  cards: [
    { x: 150, y: 400, width: 360, height: 440, name: "Starter", price: "$0", cta: "Start free" },
    { x: 540, y: 400, width: 360, height: 440, name: "Team", price: "$12", cta: "Start trial" },
    { x: 930, y: 400, width: 360, height: 440, name: "Pro", price: "$29", cta: "Start free" },
  ],
  /** The "Most popular" tag riding on the Team card's top edge. */
  popular: { x: 640, y: 384, width: 160, height: 32 },
  /** The Pro card's call to action, near the bottom of the frame. */
  proCta: { x: 958, y: 770, width: 304, height: 52 },
} as const;

export const EXAMPLE_CAPTURE: {
  projectTitle: string;
  pageUrl: string;
  device: string;
  version: number;
  marks: ExampleMark[];
} = {
  projectTitle: "Chickpea review",
  pageUrl: "https://chickpea.co/pricing",
  device: "Desktop",
  version: 2,
  marks: [
    {
      kind: "pin",
      number: 1,
      tip: { x: 884, y: 318 },
      body: "This billing toggle reads the same in both states — which one is active?",
      element: {
        kind: "button",
        tag: "button",
        role: "switch",
        text: "Annual (save 20%)",
        path: ["main", "section.pricing", "div.billing-toggle"],
        rect: { x: 720, y: 304, width: 176, height: 44 },
      },
      thread: [
        {
          author: "Lucas",
          body: "This billing toggle reads the same in both states — which one is active?",
        },
        {
          author: "founder",
          body: "Good catch — monthly is the default. We'll add a pressed state this sprint.",
        },
      ],
    },
    {
      kind: "circle",
      number: 2,
      circle: { x: 538, y: 460, size: 128 },
      body: "Per person or per team? The price doesn't say which.",
      element: {
        kind: "text",
        tag: "p",
        role: "paragraph",
        text: "$12/mo",
        path: ["main", "section.pricing", "article.plan-team", "p.price"],
        rect: { x: 568, y: 505, width: 150, height: 58 },
      },
      thread: [
        { author: "Lucas", body: "Per person or per team? The price doesn't say which." },
      ],
    },
    {
      kind: "arrow",
      number: 3,
      arrow: { start: { x: 806, y: 400 }, end: { x: 944, y: 448 } },
      body: "Move “Most popular” to Pro — it's the plan you want picked.",
      element: {
        kind: "heading",
        tag: "h3",
        role: "heading",
        text: "Pro",
        path: ["main", "section.pricing", "article.plan-pro", "h3"],
        rect: { x: 958, y: 436, width: 60, height: 32 },
      },
      thread: [
        { author: "Lucas", body: "Move “Most popular” to Pro — it's the plan you want picked." },
      ],
    },
    {
      kind: "rectangle",
      number: 4,
      rect: { x: 944, y: 758, width: 332, height: 76 },
      body: "The Pro card's CTA sits below the fold on smaller laptops — worth lifting.",
      element: {
        kind: "link",
        tag: "a",
        role: "link",
        text: "Start free",
        path: ["main", "section.pricing", "article.plan-pro", "a.cta"],
        rect: { x: 958, y: 770, width: 304, height: 52 },
      },
      thread: [
        {
          author: "Lucas",
          body: "The Pro card's CTA sits below the fold on smaller laptops — worth lifting.",
        },
        {
          author: "founder",
          body: "Agreed. Moving it above the feature list in the next deploy.",
        },
      ],
    },
  ],
};
