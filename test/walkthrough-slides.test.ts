// The walkthrough slide table (D072) is read by three consumers — the
// Remotion composition, the in-app player's chapter list, and the transcript
// — so its invariants are locked here: exactly ten slides, unique ids in the
// declared order, contiguous frame ranges, a frame-to-slide lookup that
// agrees with those ranges, every borrowed image present on disk, and the
// video's palette equal to the application's tokens.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { SCREENSHOT_SIZES, WALKTHROUGH_ASSETS } from "../remotion/walkthrough/assets";
import {
  FPS,
  HEIGHT,
  SLIDES,
  SLIDE_IDS,
  SLIDE_STARTS,
  TOTAL_FRAMES,
  WIDTH,
  formatDuration,
  slideIndexAtFrame,
  slideStartFrame,
} from "../remotion/walkthrough/slides";
import { THEME } from "../remotion/walkthrough/theme";
import { BRAND_MARK } from "../src/lib/brand-mark";

const ROOT = process.cwd();
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match) throw new Error(`token ${name} is not a 6-digit hex color in app/globals.css`);
  return match[1]!.toLowerCase();
}

describe("the walkthrough slide table", () => {
  test("has exactly ten slides, in the declared id order, each with copy", () => {
    expect(SLIDES).toHaveLength(10);
    expect(SLIDES.map((s) => s.id)).toEqual([...SLIDE_IDS]);
    for (const slide of SLIDES) {
      expect(slide.chapter.trim().length).toBeGreaterThan(0);
      expect(slide.title.trim().length).toBeGreaterThan(0);
      expect(slide.notes.trim().length).toBeGreaterThan(40);
      expect(Number.isInteger(slide.durationInFrames)).toBe(true);
      expect(slide.durationInFrames).toBeGreaterThanOrEqual(FPS * 5);
    }
  });

  test("frame ranges are contiguous and sum to the composition length", () => {
    expect(SLIDE_STARTS[0]).toBe(0);
    for (let i = 1; i < SLIDES.length; i++) {
      expect(SLIDE_STARTS[i]).toBe(SLIDE_STARTS[i - 1]! + SLIDES[i - 1]!.durationInFrames);
    }
    const last = SLIDES.length - 1;
    expect(SLIDE_STARTS[last]! + SLIDES[last]!.durationInFrames).toBe(TOTAL_FRAMES);
    expect(WIDTH / HEIGHT).toBeCloseTo(16 / 9, 5);
  });

  test("slideIndexAtFrame agrees with the starts at every boundary", () => {
    for (let i = 0; i < SLIDES.length; i++) {
      const start = slideStartFrame(i);
      expect(slideIndexAtFrame(start)).toBe(i);
      expect(slideIndexAtFrame(start + SLIDES[i]!.durationInFrames - 1)).toBe(i);
      if (i > 0) expect(slideIndexAtFrame(start - 1)).toBe(i - 1);
    }
    expect(slideIndexAtFrame(-5)).toBe(0);
    expect(slideIndexAtFrame(Number.NaN)).toBe(0);
    expect(slideIndexAtFrame(TOTAL_FRAMES + 100)).toBe(SLIDES.length - 1);
    expect(slideStartFrame(-1)).toBe(0);
    expect(slideStartFrame(99)).toBe(SLIDE_STARTS[SLIDES.length - 1]);
  });

  test("formatDuration renders m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(FPS * 65)).toBe("1:05");
    expect(formatDuration(TOTAL_FRAMES)).toMatch(/^\d+:\d{2}$/);
  });
});

describe("the walkthrough's borrowed imagery", () => {
  test("every asset the slides reference exists under public/", () => {
    for (const [key, path] of Object.entries(WALKTHROUGH_ASSETS)) {
      expect(path.startsWith("walkthrough/"), `${key} must live under public/walkthrough`).toBe(true);
      expect(existsSync(join(ROOT, "public", path)), `${key} → public/${path}`).toBe(true);
    }
  });

  test("the scrolled screenshots' declared natural sizes match the files", () => {
    // PNG IHDR: width and height are the two big-endian uint32s at byte 16.
    const size = (path: string) => {
      const buf = readFileSync(join(ROOT, "public", path));
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    };
    expect(size(WALKTHROUGH_ASSETS.landing)).toEqual(SCREENSHOT_SIZES.landing);
    expect(size(WALKTHROUGH_ASSETS.dashboard)).toEqual(SCREENSHOT_SIZES.dashboard);
  });
});

describe("the walkthrough palette", () => {
  test("light tokens equal the application's custom properties", () => {
    expect(THEME.bg).toBe(token("--bg"));
    expect(THEME.surface).toBe(token("--surface"));
    expect(THEME.ink).toBe(token("--ink"));
    expect(THEME.inkSoft).toBe(token("--ink-soft"));
    expect(THEME.accent).toBe(token("--accent"));
    expect(THEME.accentSoft).toBe(token("--accent-soft"));
    expect(THEME.line).toBe(token("--line"));
    expect(THEME.codeBg).toBe(token("--code-bg"));
    expect(THEME.accent).toBe(BRAND_MARK.tileFill);
  });
});
