// The demo video's reference holds together (D140): every beat names a shot
// that was filmed in both themes and is on disk, every target, field, and
// mark a beat uses exists on its shot, the chapters run in order, the close
// fades back into the opening frame, and every shot belongs to a scene the
// film tool knows how to film again.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { SHOTS, getShot } from "../remotion/demo/shots";
import {
  BEATS,
  CHAPTER_STARTS,
  CHAPTERS,
  DURATION,
  HEIGHT,
  TIMELINE,
  WIDTH,
  briefExcerpt,
  cameraAt,
  cameraTransform,
  chapterAt,
  cursorAt,
  resolveTarget,
} from "../remotion/demo/timeline";
import { SCENES } from "../scripts/demo/story.mjs";
import { STAGES } from "../scripts/seed/apply.mjs";

const PUBLIC = join(process.cwd(), "public");

describe("the shots", () => {
  test("every beat's shot was filmed in both themes, and the files are on disk", () => {
    for (const beat of BEATS) {
      const shot = getShot(beat.shot);
      for (const theme of ["light", "dark"] as const) {
        const file = shot.files[theme];
        expect(file, `${beat.shot} has no ${theme} filming`).toMatch(/^\/demo\/[a-z-]+\.(light|dark)\.webp$/);
        expect(existsSync(join(PUBLIC, file!)), `${file} is missing`).toBe(true);
        // A shot is a compressed screen, not a stray full-size capture.
        expect(statSync(join(PUBLIC, file!)).size).toBeLessThan(250_000);
      }
    }
  });

  test("every shot belongs to a scene the film tool can film again", () => {
    const scenes = new Set(SCENES.map((scene: { id: string }) => scene.id));
    for (const [id, shot] of Object.entries(SHOTS)) {
      expect(scenes.has(shot.scene), `${id} belongs to unknown scene ${shot.scene}`).toBe(true);
      expect(Date.parse(shot.filmed.at)).not.toBeNaN();
      expect(shot.filmed.commit).toMatch(/^[0-9a-f]{7,}\+?$/);
    }
    for (const scene of SCENES as { id: string; from: string }[]) {
      expect(STAGES).toContain(scene.from);
    }
  });

  test("every shot the beats use is used, and none is left over", () => {
    const used = new Set(BEATS.map((beat) => beat.shot));
    // A shot no beat shows is weight on every visitor's download.
    expect(Object.keys(SHOTS).filter((id) => !used.has(id))).toEqual([]);
  });
});

describe("the beats", () => {
  test("every target, typed field, and drawn mark exists on its beat's shot", () => {
    for (const beat of BEATS) {
      const shot = getShot(beat.shot);
      for (const step of beat.cursor ?? []) {
        if ("move" in step) expect(() => resolveTarget(step.move, shot)).not.toThrow();
        if ("drag" in step) expect(shot.marks?.[step.drag], `${beat.shot}: mark ${step.drag}`).toBeDefined();
      }
      if (beat.type) {
        const field = shot.fields[beat.type.field];
        expect(field, `${beat.shot}: field ${beat.type.field}`).toBeDefined();
        expect(field!.text?.length ?? 0).toBeGreaterThan(0);
      }
      if (beat.draw) expect(shot.marks?.[beat.draw.mark]).toBeDefined();
    }
  });

  test("typing finishes before its beat ends", () => {
    for (const beat of BEATS.filter((b) => b.type)) {
      const text = getShot(beat.shot).fields[beat.type!.field]!.text!;
      const done = beat.type!.at + text.length / (beat.type!.perFrame ?? 1.6);
      expect(done, `${beat.shot} types past its end`).toBeLessThanOrEqual(beat.frames);
    }
  });

  test("the chapters start in order and the clock adds up", () => {
    const starts = CHAPTERS.map((chapter) => CHAPTER_STARTS[chapter.id]);
    expect(starts[0]).toBe(0);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    for (const chapter of CHAPTERS) expect(chapterAt(CHAPTER_STARTS[chapter.id])).toBe(chapter.id);
    expect(DURATION).toBe(BEATS.reduce((sum, beat) => sum + beat.frames, 0));
    expect(TIMELINE.at(-1)!.end).toBe(true);
  });

  test("the close fades back into the opening frame, so the loop has no seam", () => {
    const first = BEATS[0]!;
    const last = BEATS.at(-1)!;
    expect(last.shot).toBe(first.shot);
    expect(cameraAt(DURATION - 1)).toEqual(cameraAt(0));
  });

  test("the cursor starts on screen and stays there", () => {
    for (let frame = 0; frame < DURATION; frame += 5) {
      const { x, y } = cursorAt(frame);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(WIDTH);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(HEIGHT);
    }
  });
});

describe("the camera", () => {
  test("zooming toward a corner never shows past the edge of the shot", () => {
    const parse = (transform: string) => transform.match(/-?[\d.]+/g)!.map(Number);
    for (const [x, y] of [
      [0, 0],
      [WIDTH, HEIGHT],
      [WIDTH, 0],
      [0, HEIGHT],
    ]) {
      const [tx, ty, zoom] = parse(cameraTransform({ zoom: 1.6, x: x!, y: y! }));
      expect(tx).toBeLessThanOrEqual(0);
      expect(ty).toBeLessThanOrEqual(0);
      expect(tx! + WIDTH * zoom!).toBeGreaterThanOrEqual(WIDTH);
      expect(ty! + HEIGHT * zoom!).toBeGreaterThanOrEqual(HEIGHT);
    }
  });
});

describe("the agent's terminal", () => {
  test("shows the headings, elements, notes, and replies, without the long instructions", () => {
    const brief = [
      "# Pinata brief — Chickpea review",
      "",
      "- Site: https://chickpea.co/pricing",
      "- To do: 1 pin on 1 screenshot",
      "- Generated: 2026-10-15T17:54:05.168Z",
      "",
      "## What to do",
      "",
      "1. Start from the text.",
      "",
      "## https://chickpea.co/pricing — Desktop",
      "",
      "Desktop · version 1 · 1 pin",
      "",
      "Screenshot: https://yourpinata.dev/a/token/captures/id (1440 × 1527 px, full page)",
      "",
      "### Pin 1",
      "",
      "- Status: Replied",
      "- Position: 884, 318 px natural",
      "- Element: <button> role=switch “Annual (save 20%)”",
      "- Path: `html:1 > body:1`",
      "- Nearby: <h1> “Plans for every kitchen”",
      "",
      "> This billing toggle reads the same in both states — which one is active?",
      "",
      "**founder** replied:",
      "",
      "> Good catch — monthly is the default.",
    ].join("\n");
    expect(briefExcerpt(brief)).toEqual([
      "# Pinata brief — Chickpea review",
      "- To do: 1 pin on 1 screenshot",
      "## https://chickpea.co/pricing — Desktop",
      "### Pin 1",
      "- Element: <button> role=switch “Annual (save 20%)”",
      "> This billing toggle reads the same in both states — which one is active?",
      "**founder** replied:",
      "> Good catch — monthly is the default.",
    ]);
  });
});
