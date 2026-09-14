// The landing-page pinata logo: inline SVG built from the one shared mark
// source (src/lib/brand-mark.ts), so the logo and the favicon (app/icon.svg)
// can never drift apart, and no external image asset is ever fetched
// (VAL-LANDING-001). Purely presentational; safe to render from server or
// client components.
import { BRAND_MARK } from "../lib/brand-mark";

export function PinataLogo({ size = 72 }: { size?: number }) {
  return (
    <svg
      className="pinata-logo"
      viewBox={BRAND_MARK.viewBox}
      width={size}
      height={size}
      role="img"
      aria-label="pinata logo"
    >
      <rect width="64" height="64" rx={BRAND_MARK.tileRadius} fill={BRAND_MARK.tileFill} />
      <path d={BRAND_MARK.bodyPath} fill={BRAND_MARK.bodyFill} fillRule={BRAND_MARK.fillRule} />
      <path d={BRAND_MARK.inkPath} fill={BRAND_MARK.inkFill} fillRule={BRAND_MARK.fillRule} />
    </svg>
  );
}
