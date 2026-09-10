// The single source of the pinata brand mark (VAL-LANDING-001, D066). It is
// rendered in exactly two places: inline by <PinataLogo> on the landing page
// and as the favicon file app/icon.svg. test/brand-mark.test.tsx locks both
// renderings to this module.
//
// Named exception to the token-only rule: a favicon SVG file cannot consume
// CSS custom properties, so the two brand colors live here once and MUST
// equal --accent and --surface from app/globals.css (the test enforces it).
//
// The mark itself is the product's own pin teardrop — a candy-filled pin for
// "pin + annotate + at ya": an accent tile, a surface teardrop, and the
// accent starburst where the piñata breaks.

export const BRAND_MARK = {
  viewBox: "0 0 64 64",
  /** Rounded corner radius of the accent tile. */
  tileRadius: 14,
  /** Tile fill — equals --accent. */
  tileFill: "#c43448",
  /** Teardrop pin: bulb centered at (32, 27), tip at (32, 51). */
  pinPath:
    "M32 51 C24.9 40.6 19 35.1 19 27 a13 13 0 1 1 26 0 C45 35.1 39.1 40.6 32 51 Z",
  /** Pin fill — equals --surface. */
  pinFill: "#fffdf8",
  /** Five-point starburst centered on the pin bulb at (32, 27). */
  starPath:
    "M32 21 L33.5 25 L37.7 25.2 L34.4 27.8 L35.5 31.9 L32 29.5 L28.5 31.9 L29.6 27.8 L26.3 25.2 L30.5 25 Z",
  /** Starburst fill — equals --accent. */
  starFill: "#c43448",
} as const;
