// @vitest-environment jsdom
// The pinata brand mark has exactly one source (src/lib/brand-mark.ts),
// rendered in two places: inline by <PinataLogo> on the landing page and as
// the favicon file app/icon.svg (VAL-LANDING-001, D069). This suite locks the
// two renderings together, keeps the mark self-contained (zero external
// assets), and pins its colors to the visual tokens.
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PinataLogo } from "../src/components/pinata-logo";
import { BRAND_MARK } from "../src/lib/brand-mark";

const iconSvg = readFileSync(join(process.cwd(), "app/icon.svg"), "utf8");
const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match) throw new Error(`token ${name} is not a 6-digit hex color in app/globals.css`);
  return match[1]!.toLowerCase();
}

describe("the pinata brand mark", () => {
  test("the landing logo is inline SVG built from the shared mark source", () => {
    render(<PinataLogo />);
    const logo = screen.getByRole("img", { name: "pinata logo" });
    expect(logo.tagName.toLowerCase()).toBe("svg");
    expect(logo).toHaveAttribute("viewBox", BRAND_MARK.viewBox);
    // Inline and self-contained: no raster element, no external reference.
    expect(logo.querySelector("image")).toBeNull();
    expect(logo.innerHTML).not.toMatch(/https?:\/\//);
    const paths = [...logo.querySelectorAll("path")];
    expect(paths.map((p) => p.getAttribute("d"))).toEqual([
      BRAND_MARK.bodyPath,
      BRAND_MARK.inkPath,
    ]);
    // The eye patch is a hole in both shapes; only even-odd keeps it open.
    for (const path of paths) {
      expect(path).toHaveAttribute("fill-rule", BRAND_MARK.fillRule);
    }
  });

  test("the favicon file is the same mark from the same source", () => {
    expect(iconSvg).toContain(`viewBox="${BRAND_MARK.viewBox}"`);
    expect(iconSvg).toContain(`d="${BRAND_MARK.bodyPath}" fill="${BRAND_MARK.bodyFill}"`);
    expect(iconSvg).toContain(`d="${BRAND_MARK.inkPath}" fill="${BRAND_MARK.inkFill}"`);
    expect(iconSvg).toContain(BRAND_MARK.tileFill);
    expect(iconSvg).toContain(`rx="${BRAND_MARK.tileRadius}"`);
    expect(iconSvg.match(/fill-rule="evenodd"/g)).toHaveLength(2);
  });

  test("the mark draws the llama pin: a body with sparks and a head with an open eye", () => {
    // The body silhouette is the pin plus two sparks (three outer contours)
    // with the eye patch and pupil inside it; the head is one contour with
    // the eye patch cut out and the pupil filled. Subpath counts lock that
    // structure so a re-trace cannot silently lose the eye or a spark.
    expect(BRAND_MARK.bodyPath.match(/M /g)).toHaveLength(5);
    expect(BRAND_MARK.inkPath.match(/M /g)).toHaveLength(3);
    // Every coordinate stays inside the 64-unit tile.
    for (const path of [BRAND_MARK.bodyPath, BRAND_MARK.inkPath]) {
      for (const n of path.match(/-?\d+(\.\d+)?/g) ?? []) {
        expect(Number(n)).toBeGreaterThanOrEqual(0);
        expect(Number(n)).toBeLessThanOrEqual(64);
      }
    }
  });

  test("the mark fetches nothing external and stays on the color tokens", () => {
    // The xmlns namespace URI is an identifier, not a fetched asset.
    const withoutNamespace = iconSvg.replaceAll('xmlns="http://www.w3.org/2000/svg"', "");
    expect(withoutNamespace).not.toMatch(/https?:\/\//);
    expect(iconSvg).not.toContain("<image");
    expect(iconSvg).not.toContain("url(");
    // app/icon.svg cannot consume CSS custom properties, so the brand colors
    // live in brand-mark.ts once — and must equal the tokens.
    expect(BRAND_MARK.tileFill).toBe(token("--surface"));
    expect(BRAND_MARK.bodyFill).toBe(token("--brand-spark"));
    expect(BRAND_MARK.inkFill).toBe(token("--brand-ink"));
  });
});
