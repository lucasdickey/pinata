// Capture workload policy: dimensions, time, bytes, attempts, concurrency,
// staleness, and redirect hops (VAL-CAPTURE-003/004/007/008). The totals are
// constrained by the Browserless free tier (2 concurrent browsers, 120-second
// maximum session) and the observed ~13,000 px Chickpea mobile page.

export interface ViewportPolicy {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

/** Desktop capture: 1440 × 900 CSS px at DPR 1. */
export const DESKTOP_VIEWPORT: ViewportPolicy = Object.freeze({
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
});

/** Mobile capture: 390 × 844 CSS px at DPR 1, with mobile UA/touch emulation. */
export const MOBILE_VIEWPORT: ViewportPolicy = Object.freeze({
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
});

/** Tallest capturable document, in CSS px. */
export const MAX_DOCUMENT_HEIGHT_PX = 16_384;

/** Largest capturable document area, in CSS px². */
export const MAX_DOCUMENT_PIXELS = 25_000_000;

/** Largest accepted screenshot: 8 MiB. */
export const MAX_IMAGE_BYTES = 8_388_608;

/** Largest accepted Browserless function response: 16 MiB. */
export const MAX_PROVIDER_RESPONSE_BYTES = 16_777_216;

/** Per-navigation wait budget. */
export const NAVIGATION_TIMEOUT_MS = 30_000;

/** Network-idle wait budget after navigation. */
export const NETWORK_IDLE_TIMEOUT_MS = 5_000;

/** Lazy-loading scroll increment, in CSS px. */
export const LAZY_SCROLL_STEP_PX = 800;

/** Maximum lazy-loading scroll steps (covers a maximum-height page). */
export const LAZY_SCROLL_MAX_STEPS = 24;

/** Settle delay per lazy-loading scroll step. */
export const LAZY_SCROLL_STEP_DELAY_MS = 250;

/** Whole-capture deadline; must stay under the provider's 120 s session cap. */
export const TOTAL_CAPTURE_TIMEOUT_MS = 90_000;

/** Redirect hops revalidated before a capture fails as an unsafe chain. */
export const MAX_REDIRECT_HOPS = 5;

/** Persisted capture attempts (initial plus retries) per project. */
export const MAX_CAPTURE_ATTEMPTS_PER_PROJECT = 64;

/** Active captures at once, matching the Browserless concurrency limit. */
export const MAX_ACTIVE_CAPTURES = 2;

/** A `capturing` attempt older than this computes to stale (5 minutes). */
export const STALE_CAPTURE_AGE_MS = 300_000;

/** Hard byte cap on a capture mutation request body (variant plus key). */
export const CAPTURE_REQUEST_MAX_BYTES = 1_024;
