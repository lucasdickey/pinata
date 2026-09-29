// The walkthrough paints with the application's own tokens so the video and
// the product look like one thing. The light values MUST equal the custom
// properties in app/globals.css (test/walkthrough-slides.test.ts enforces
// it); the two dark values come from the brand exploration board that the
// title slide borrows (public/walkthrough/brand-board.webp).
export const THEME = {
  bg: "#fcfcf9",
  surface: "#ffffff",
  ink: "#141414",
  inkSoft: "#666666",
  accent: "#c9381a",
  accentSoft: "#fbe7df",
  line: "#e2e1dc",
  codeBg: "#f3f2eb",
  /** Near-black from the brand board. */
  night: "#151312",
  /** The board's orange, used only as a highlight on dark surfaces. */
  ember: "#ff5a2d",
} as const;

/** Provenance colors, copied from docs/decisions/decisions.json `origins`. */
export const ORIGIN_COLORS = {
  "user-directed": "#2f6feb",
  "agent-proposed-user-approved": "#8957e5",
  "agent-autonomous": "#bf8700",
  "user-deferred": "#6e7781",
} as const;

/** The application's face (D102): Inter, self-hosted under public/fonts. */
export const FONT =
  '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
