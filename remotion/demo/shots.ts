// Typed access to the demo video's shots (remotion/demo/README.md). Every
// shot is a real screen of the product, filmed by scripts/demo/film.mjs into
// public/demo/ and described in shots.json: its image per theme, the scroll
// it was taken at, and where its targets sit, in the browser's CSS pixels.
// shots.json is written by the film tool; edit the story, not the file.

import { staticFile } from "remotion";
import data from "./shots.json";

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

/** A text field, measured so typed text can be laid exactly where the field puts it. */
export interface ShotField {
  rect: Rect;
  padding: { top: number; right: number; bottom: number; left: number };
  font: { family: string; size: number; weight: string; lineHeight: number; letterSpacing: number };
  /** The field's text and fill in each theme it was filmed in. */
  colors: Partial<Record<Theme, { color: string; background: string }>>;
  multiline: boolean;
  /** What the video types into the field. */
  text?: string;
}

/** A seed mark where it lands on this shot's screen. */
export type ShotMark =
  | { kind: "pin"; tip: Point }
  | { kind: "rectangle" | "circle"; rect: Rect }
  | { kind: "arrow"; start: Point; end: Point };

export type Theme = "light" | "dark";

export interface Shot {
  scene: string;
  files: Partial<Record<Theme, string>>;
  scrollY?: number;
  targets: Record<string, Rect>;
  fields: Record<string, ShotField>;
  /** Where the capture sits on the canvas: screen = capture * scale + (x, y). */
  capture?: Point & { scale: number };
  marks?: Record<string, ShotMark>;
  filmed: { at: string; commit: string };
}

interface ShotsFile {
  viewport: { width: number; height: number };
  scale: number;
  shots: Record<string, Shot>;
  /** Text a scene kept, per theme: each filming has its own links. */
  text?: Partial<Record<Theme, { brief?: string; prompt?: string }>>;
}

const file = data as unknown as ShotsFile;

/** The browser window the shots were taken in; the composition's own size. */
export const SHOT_VIEWPORT = file.viewport;
export const SHOTS: Readonly<Record<string, Shot>> = file.shots;
/** Text a scene kept for the video: the agent prompt and the brief it reads. */
export const SHOT_TEXT: Partial<Record<Theme, { brief?: string; prompt?: string }>> = file.text ?? {};

export function getShot(id: string): Shot {
  const shot = SHOTS[id];
  if (!shot) throw new Error(`No shot "${id}" in remotion/demo/shots.json; film it with npm run demo:film.`);
  return shot;
}

/**
 * A shot's image for a theme, falling back to the other theme if only one
 * was filmed. On the site that is /demo/…; in Remotion Studio, the same
 * public file through its static server.
 */
export function shotSrc(shot: Shot, theme: Theme): string {
  const src = shot.files[theme] ?? shot.files.light ?? shot.files.dark;
  if (!src) throw new Error("A shot has no image.");
  return staticFile(src);
}

/** The newest filming date across every shot, for the caption under the video. */
export function lastFilmed(): string {
  return Object.values(SHOTS)
    .map((shot) => shot.filmed.at)
    .sort()
    .at(-1)!;
}

export const center = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
