// Fixture data for the landing page's static example of a marked-up capture
// (VAL-LANDING-002, D066). This is the whole data source of the example: it
// lives in the repo, is bundled at build time, and triggers no /api/* request
// and no database access. Shapes deliberately mirror the real domain views
// (PinAnnotationView / PinElementSnapshot in src/lib/annotations.ts) so the
// example teaches the product truthfully; thread entries are depicted as
// saved content only — there is no reply UI (threads are deferred, D051).

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

/** One numbered pin, mirroring PinAnnotationView's natural-pixel tip. */
export interface ExamplePin {
  number: number;
  /** Pin tip in screenshot-natural CSS pixels within the example frame. */
  tip: { x: number; y: number };
  body: string;
  element: ExampleElement | null;
  thread: ExampleThreadEntry[];
}

/** The depicted capture viewport: the standard Desktop capture frame. */
export const EXAMPLE_CAPTURE_FRAME = {
  width: DESKTOP_VIEWPORT.width,
  height: DESKTOP_VIEWPORT.height,
} as const;

export const EXAMPLE_CAPTURE: {
  projectTitle: string;
  pageUrl: string;
  device: string;
  version: number;
  pins: ExamplePin[];
} = {
  projectTitle: "Chickpea review",
  pageUrl: "https://chickpea.co/pricing",
  device: "Desktop",
  version: 2,
  pins: [
    {
      number: 1,
      tip: { x: 462, y: 410 },
      body: "This billing toggle reads the same in both states — which one is active?",
      element: {
        kind: "button",
        tag: "button",
        role: "switch",
        text: "Annual (save 20%)",
        path: ["main", "section.pricing", "div.billing-toggle"],
        rect: { x: 392, y: 386, width: 176, height: 44 },
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
      number: 2,
      tip: { x: 1004, y: 596 },
      body: "The Pro card's CTA sits below the fold on smaller laptops — worth lifting.",
      element: {
        kind: "link",
        tag: "a",
        role: "link",
        text: "Start free",
        path: ["main", "section.pricing", "article.plan-pro", "a.cta"],
        rect: { x: 990, y: 560, width: 260, height: 48 },
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
