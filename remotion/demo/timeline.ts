// The demo video's script (remotion/demo/README.md): beats of real shots,
// each with what happens on it — where the cursor goes and clicks, what gets
// typed, which mark gets drawn, where the camera looks. Positions come from
// the shots themselves (shots.json), so when a screen is filmed again and
// its buttons move, the cursor follows them without an edit here.
//
// Beats only name shots and their targets. Editing the story of the video
// means editing BEATS; changing what a screen looks like means filming it
// again (npm run demo:film -- --scenes <scene>).

import { Easing, interpolate } from "remotion";
import { center, getShot, type Point, type Rect, type Shot } from "./shots";

export const FPS = 30;
export const WIDTH = 1440;
export const HEIGHT = 900;

/** A named target on the beat's shot, a mark's spot, or a fixed point. */
export type Target = string | Point | { mark: string; end?: "start" | "end" };

export type CursorStep =
  /** Arrive at `move` by frame `at`, over `frames` (16 by default). */
  | { move: Target; at: number; frames?: number; offset?: Point }
  /** Press and release at frame `click`. */
  | { click: number }
  /** Press at a mark's start, pull to its end over `frames`, release. */
  | { drag: string; at: number; frames: number };

export interface CameraStep {
  /** What to look at: a target or a rectangle, in the shot's pixels. */
  focus: Target | Rect;
  zoom: number;
  at?: number;
  frames?: number;
}

export interface Beat {
  shot: string;
  frames: number;
  /** How this beat's shot replaces the last one; a cut fades for 3 frames. */
  enter?: { kind: "fade" | "scroll"; frames: number };
  /** A chapter starts here. */
  chapter?: ChapterId;
  camera?: CameraStep | CameraStep[];
  cursor?: CursorStep[];
  /** Type the field's text (from shots.json) from frame `at`. */
  type?: { field: string; at: number; perFrame?: number };
  /** Draw a mark as the cursor drags it, from frame `at` over `frames`. */
  draw?: { mark: string; at: number; frames: number };
  /** Show a key being pressed. */
  key?: { label: string; at: number };
  /** The agent's terminal slides in at frame `at`. */
  terminal?: { at: number };
  /** The closing card. */
  end?: boolean;
}

export const CHAPTERS = [
  { id: "capture", label: "Capture", title: "Capture the page" },
  { id: "annotate", label: "Annotate", title: "Pin it where it happens" },
  { id: "share", label: "Share", title: "Send the founder one link" },
  { id: "reply", label: "Reply", title: "The founder replies in place" },
  { id: "handoff", label: "Hand off", title: "Hand it to a coding agent" },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]["id"];

const TOP_LEFT: Rect = { x: 60, y: 60, width: 760, height: 470 };

/** The video, beat by beat. */
export const BEATS: Beat[] = [
  // 1 · Capture
  {
    shot: "capture-form",
    frames: 54,
    chapter: "capture",
    camera: { focus: { x: 380, y: 560, width: 680, height: 330 }, zoom: 1.45, frames: 1 },
    cursor: [{ move: "address", at: 6, frames: 1, offset: { x: 250, y: 6 } }],
    type: { field: "address", at: 8, perFrame: 1.3 },
  },
  {
    shot: "capture-typed",
    frames: 26,
    cursor: [{ move: "submit", at: 14 }, { click: 17 }],
  },
  {
    shot: "capture-progress",
    frames: 40,
    camera: { focus: { x: 90, y: 120, width: 800, height: 330 }, zoom: 1.5, frames: 14 },
    cursor: [{ move: { x: 760, y: 470 }, at: 20, frames: 18 }],
  },
  {
    shot: "capture-ready",
    frames: 42,
    enter: { kind: "fade", frames: 6 },
    cursor: [{ move: { x: 217, y: 262 }, at: 30, frames: 20 }, { click: 33 }],
  },

  // 2 · Annotate
  {
    shot: "annotate-canvas",
    frames: 40,
    chapter: "annotate",
    enter: { kind: "fade", frames: 8 },
    camera: [
      { focus: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, zoom: 1, frames: 10 },
      { focus: { x: 420, y: 380, width: 640, height: 400 }, zoom: 1.4, at: 10, frames: 24 },
    ],
    cursor: [{ move: { mark: "toggle" }, at: 30, frames: 22 }, { click: 34 }],
  },
  {
    shot: "annotate-pin",
    frames: 66,
    camera: { focus: { x: 600, y: 420, width: 520, height: 320 }, zoom: 1.6, frames: 16 },
    cursor: [{ move: { x: 1010, y: 770 }, at: 18, frames: 16 }],
    type: { field: "comment", at: 10, perFrame: 1.7 },
    key: { label: "Enter", at: 58 },
  },
  {
    shot: "annotate-pin-saved",
    frames: 44,
    camera: { focus: { x: 360, y: 260, width: 1060, height: 600 }, zoom: 1.3, frames: 16 },
    cursor: [{ move: "circleTool", at: 34, frames: 22 }, { click: 37 }],
  },
  {
    shot: "annotate-pin-saved",
    frames: 30,
    camera: { focus: { x: 360, y: 440, width: 640, height: 400 }, zoom: 1.5, frames: 14 },
    cursor: [
      { move: { mark: "price", end: "start" }, at: 10, frames: 10 },
      { drag: "price", at: 12, frames: 14 },
    ],
    draw: { mark: "price", at: 12, frames: 14 },
  },
  {
    shot: "annotate-circle",
    frames: 56,
    camera: { focus: { x: 440, y: 470, width: 520, height: 320 }, zoom: 1.6, frames: 14 },
    type: { field: "comment", at: 6, perFrame: 1.7 },
    key: { label: "Enter", at: 46 },
  },
  {
    shot: "annotate-done",
    frames: 56,
    enter: { kind: "fade", frames: 10 },
    camera: { focus: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, zoom: 1.08, frames: 20 },
    cursor: [{ move: { x: 1040, y: 640 }, at: 24, frames: 20 }],
  },

  // 3 · Share
  {
    shot: "share-canvas",
    frames: 32,
    chapter: "share",
    camera: { focus: TOP_LEFT, zoom: 1.7, frames: 16 },
    cursor: [{ move: "pill", at: 24, frames: 20 }, { click: 27 }],
  },
  {
    shot: "share-panel",
    frames: 28,
    cursor: [{ move: "create", at: 18 }, { click: 21 }],
  },
  {
    shot: "share-created",
    frames: 34,
    cursor: [{ move: "copy", at: 20 }, { click: 23 }],
  },
  {
    shot: "share-copied",
    frames: 30,
  },

  // 4 · Reply
  {
    shot: "founder-open",
    frames: 44,
    chapter: "reply",
    enter: { kind: "fade", frames: 10 },
    camera: { focus: { x: 0, y: 0, width: 1100, height: 560 }, zoom: 1.3, frames: 1 },
    cursor: [{ move: "pin", at: 30, frames: 22, offset: { x: -300, y: 0 } }, { click: 33 }],
  },
  {
    shot: "founder-selected",
    frames: 58,
    enter: { kind: "scroll", frames: 14 },
    camera: { focus: { x: 640, y: 240, width: 800, height: 560 }, zoom: 1.45, frames: 16 },
    cursor: [{ move: "send", at: 12, frames: 12, offset: { x: 90, y: 60 } }],
    type: { field: "reply", at: 10, perFrame: 1.8 },
  },
  {
    shot: "founder-typed",
    frames: 20,
    enter: { kind: "fade", frames: 3 },
    cursor: [{ move: "send", at: 12, frames: 10 }, { click: 15 }],
  },
  {
    shot: "founder-replied",
    frames: 36,
  },
  {
    shot: "reply-unread",
    frames: 40,
    enter: { kind: "fade", frames: 10 },
    camera: { focus: { x: 880, y: 240, width: 540, height: 360 }, zoom: 1.7, frames: 1 },
    cursor: [{ move: "pin", at: 26, frames: 20 }, { click: 29 }],
  },
  {
    shot: "reply-open",
    frames: 48,
  },

  // 5 · Hand off
  {
    shot: "agent-canvas",
    frames: 30,
    chapter: "handoff",
    enter: { kind: "fade", frames: 8 },
    camera: { focus: TOP_LEFT, zoom: 1.6, frames: 1 },
    cursor: [{ move: "pill", at: 20, frames: 18 }, { click: 23 }],
  },
  {
    shot: "agent-panel",
    frames: 28,
    cursor: [{ move: "create", at: 18 }, { click: 21 }],
  },
  {
    shot: "agent-created",
    frames: 40,
    camera: { focus: { x: 530, y: 160, width: 760, height: 600 }, zoom: 1.4, frames: 14 },
    cursor: [{ move: "copy", at: 26, frames: 18 }, { click: 29 }],
  },
  {
    shot: "agent-copied",
    frames: 130,
    terminal: { at: 12 },
  },

  // The close, which fades back into the opening frame so the loop is seamless.
  {
    shot: "capture-form",
    frames: 72,
    end: true,
    camera: { focus: { x: 380, y: 560, width: 680, height: 330 }, zoom: 1.45, frames: 1 },
  },
];

/** A beat with its place on the clock. */
export interface TimedBeat extends Beat {
  index: number;
  start: number;
}

export const TIMELINE: TimedBeat[] = BEATS.reduce<TimedBeat[]>((out, beat, index) => {
  const previous = out.at(-1);
  out.push({ ...beat, index, start: previous ? previous.start + previous.frames : 0 });
  return out;
}, []);

export const DURATION = TIMELINE.at(-1)!.start + TIMELINE.at(-1)!.frames;

/** Each chapter's first frame, for the player's chapter buttons. */
export const CHAPTER_STARTS: Record<ChapterId, number> = Object.fromEntries(
  TIMELINE.filter((beat) => beat.chapter).map((beat) => [beat.chapter, beat.start]),
) as Record<ChapterId, number>;

/** The chapter playing at a frame. */
export function chapterAt(frame: number): ChapterId {
  let current: ChapterId = CHAPTERS[0].id;
  for (const beat of TIMELINE) {
    if (beat.start > frame) break;
    if (beat.chapter) current = beat.chapter;
  }
  return current;
}

/** The beat playing at a frame. */
export function beatAt(frame: number): TimedBeat {
  let found = TIMELINE[0]!;
  for (const beat of TIMELINE) {
    if (beat.start > frame) break;
    found = beat;
  }
  return found;
}

/** A target's spot on a shot. */
export function resolveTarget(target: Target, shot: Shot): Point {
  if (typeof target === "string") {
    const rect = shot.targets[target];
    if (!rect) throw new Error(`Shot has no target "${target}".`);
    return center(rect);
  }
  if ("mark" in target) {
    const mark = shot.marks?.[target.mark];
    if (!mark) throw new Error(`Shot has no mark "${target.mark}".`);
    if (mark.kind === "pin") return mark.tip;
    if (mark.kind === "arrow") return target.end === "end" ? mark.end : mark.start;
    return target.end === "end"
      ? { x: mark.rect.x + mark.rect.width, y: mark.rect.y + mark.rect.height }
      : { x: mark.rect.x, y: mark.rect.y };
  }
  return target;
}

const ease = Easing.inOut(Easing.cubic);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** A position held or moved to at a frame. */
interface Key {
  frame: number;
  at: Point;
}

/** The cursor's whole path, and when it is pressed. */
function buildCursor(): { keys: Key[]; down: [number, number][] } {
  // The cursor starts wherever the first move puts it, already there.
  const keys: Key[] = [];
  const down: [number, number][] = [];
  for (const beat of TIMELINE) {
    const shot = getShot(beat.shot);
    for (const step of beat.cursor ?? []) {
      if ("move" in step) {
        const to = resolveTarget(step.move, shot);
        const point = { x: to.x + (step.offset?.x ?? 0), y: to.y + (step.offset?.y ?? 0) };
        const end = beat.start + step.at;
        const last = keys.at(-1);
        if (!last) {
          keys.push({ frame: 0, at: point });
          continue;
        }
        const start = Math.max(end - (step.frames ?? 16), last.frame);
        keys.push({ frame: start, at: last.at }, { frame: end, at: point });
      } else if ("click" in step) {
        const frame = beat.start + step.click;
        down.push([frame, frame + 5]);
      } else {
        const from = resolveTarget({ mark: step.drag, end: "start" }, shot);
        const to = resolveTarget({ mark: step.drag, end: "end" }, shot);
        const start = beat.start + step.at;
        keys.push({ frame: start, at: from }, { frame: start + step.frames, at: to });
        down.push([start, start + step.frames]);
      }
    }
  }
  return { keys, down };
}

const CURSOR = buildCursor();

/** Where the cursor is at a frame, and whether it is pressed. */
export function cursorAt(frame: number): Point & { down: boolean; pressedAt: number | null } {
  const { keys, down } = CURSOR;
  let at = keys[0]!.at;
  for (let i = 1; i < keys.length; i += 1) {
    const a = keys[i - 1]!;
    const b = keys[i]!;
    if (frame <= a.frame) break;
    if (frame >= b.frame) {
      at = b.at;
      continue;
    }
    const t = interpolate(frame, [a.frame, b.frame], [0, 1], { ...clamp, easing: ease });
    at = { x: a.at.x + (b.at.x - a.at.x) * t, y: a.at.y + (b.at.y - a.at.y) * t };
    break;
  }
  const press = down.find(([from, to]) => frame >= from && frame < to);
  const last = down.filter(([from]) => from <= frame).at(-1);
  return { ...at, down: Boolean(press), pressedAt: last ? last[0] : null };
}

/** The camera: how far in, and which point of the shot sits mid-frame. */
export interface Camera {
  zoom: number;
  x: number;
  y: number;
}

function cameraFor(step: CameraStep, shot: Shot): Camera {
  const focus = step.focus;
  const point =
    typeof focus === "object" && "width" in focus ? center(focus) : resolveTarget(focus as Target, shot);
  return { zoom: step.zoom, x: point.x, y: point.y };
}

interface CameraMove {
  from: number;
  to: number;
  camera: Camera;
}

function buildCamera(): CameraMove[] {
  const moves: CameraMove[] = [];
  for (const beat of TIMELINE) {
    const shot = getShot(beat.shot);
    const steps = beat.camera ? (Array.isArray(beat.camera) ? beat.camera : [beat.camera]) : [];
    for (const step of steps) {
      const from = beat.start + (step.at ?? 0);
      moves.push({ from, to: from + Math.max(1, step.frames ?? 18), camera: cameraFor(step, shot) });
    }
  }
  return moves;
}

const CAMERA = buildCamera();
const WHOLE: Camera = { zoom: 1, x: WIDTH / 2, y: HEIGHT / 2 };

/** The camera at a frame, easing from each move to the next. */
export function cameraAt(frame: number): Camera {
  let camera = CAMERA[0]?.camera ?? WHOLE;
  for (const move of CAMERA) {
    if (frame < move.from) break;
    const t = interpolate(frame, [move.from, move.to], [0, 1], { ...clamp, easing: ease });
    camera = {
      zoom: camera.zoom + (move.camera.zoom - camera.zoom) * t,
      x: camera.x + (move.camera.x - camera.x) * t,
      y: camera.y + (move.camera.y - camera.y) * t,
    };
  }
  return camera;
}

/**
 * The camera as a CSS transform on the shot's pixels: zoom about the focus,
 * kept inside the shot so no edge of the frame ever shows past it.
 */
export function cameraTransform(camera: Camera): string {
  const { zoom } = camera;
  const tx = Math.min(0, Math.max(WIDTH - WIDTH * zoom, WIDTH / 2 - camera.x * zoom));
  const ty = Math.min(0, Math.max(HEIGHT - HEIGHT * zoom, HEIGHT / 2 - camera.y * zoom));
  return `translate(${tx}px, ${ty}px) scale(${zoom})`;
}

/**
 * The lines of the agent brief the terminal shows: the headings, each
 * mark's element, and the notes and replies, without the long instructions
 * and per-screenshot details a viewer could not read at video speed.
 */
export function briefExcerpt(brief: string): string[] {
  const lines: string[] = [];
  let skipping = false;
  for (const raw of brief.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) skipping = line === "## What to do";
    if (skipping || line === "") continue;
    if (/^- (Site|Generated|Status|Position|Circle|Arrow|Box|Bounds|Path|Nearby)\b|^Screenshot:|^Desktop · /.test(line)) {
      continue;
    }
    lines.push(line);
  }
  return lines;
}
