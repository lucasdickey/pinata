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

// D104: the dark theme is the same contract on a dark sheet. Its values are
// written twice (the device preference and a saved choice); both copies must
// agree, and every text pairing must clear AA.
function block(selector: RegExp): Record<string, string> {
  const match = css.match(selector);
  if (!match) throw new Error(`block ${selector} not found in app/globals.css`);
  const values: Record<string, string> = {};
  for (const [, name, value] of match[1]!.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    values[name!] = value!.toLowerCase();
  }
  return values;
}

const savedDark = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
const deviceDark = block(
  /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/,
);

describe("dark color tokens meet WCAG AA (D104)", () => {
  test("the device-preference and saved-choice blocks carry identical values", () => {
    expect(Object.keys(savedDark).length).toBeGreaterThanOrEqual(12);
    expect(deviceDark).toEqual(savedDark);
  });

  test("ink and secondary text pass 4.5:1 on every dark surface", () => {
    for (const surface of ["--bg", "--surface", "--raised"]) {
      expect(contrast(savedDark["--ink"]!, savedDark[surface]!)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      expect(contrast(savedDark["--ink-soft"]!, savedDark[surface]!)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      );
    }
  });

  test("the accent passes 4.5:1 as text on every dark surface and behind surface text", () => {
    for (const surface of ["--bg", "--surface", "--raised"]) {
      expect(contrast(savedDark["--accent"]!, savedDark[surface]!)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      );
    }
    expect(contrast(savedDark["--surface"]!, savedDark["--accent"]!)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  test("the large-text gray clears 3:1 and decision status colors clear 4.5:1", () => {
    expect(contrast(savedDark["--ink-quiet"]!, savedDark["--bg"]!)).toBeGreaterThanOrEqual(3);
    for (const status of ["--status-accepted", "--status-superseded", "--status-pending"]) {
      expect(contrast(savedDark[status]!, savedDark["--surface"]!)).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      );
    }
  });
});
