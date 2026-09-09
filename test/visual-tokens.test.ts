// The global color tokens are a public-surface accessibility contract:
// user-testing round 1 (VAL-REQS-006) found the brand accent failing WCAG AA
// on links and on the white-on-accent current-page nav badge. This suite
// locks every text use of --accent to the 4.5:1 AA floor so the token cannot
// drift back under it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match) throw new Error(`token ${name} is not a 6-digit hex color in app/globals.css`);
  return match[1].toLowerCase();
}

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const AA_NORMAL_TEXT = 4.5;

describe("global color tokens meet WCAG AA", () => {
  test("the accent token passes 4.5:1 as link/heading text on both page backgrounds", () => {
    const accent = token("--accent");
    expect(contrast(accent, token("--bg"))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrast(accent, token("--surface"))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  test("the current-page nav badge (surface text on accent) passes 4.5:1", () => {
    expect(contrast(token("--surface"), token("--accent"))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  test("error text (accent on surface) passes 4.5:1", () => {
    // .field-error and .capture-error render --accent text on --surface cards.
    expect(contrast(token("--accent"), token("--surface"))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
