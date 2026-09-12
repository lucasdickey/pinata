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

/**
 * Image types a capture may store. The first entry is what the capture
 * function asks Chromium to produce: PNG is lossless, so decoded pixels are
 * exactly the stabilized layout and two captures of one deterministic page
 * compare byte-for-byte.
 */
export const ALLOWED_IMAGE_CONTENT_TYPES: readonly string[] = Object.freeze([
  "image/png",
  "image/webp",
]);

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

/**
 * Automatic retries the server creates in a row for one page variant after a
 * retryable failure or a stale attempt, counted since the last attempt a
 * person asked for. Once spent, the next failure waits for a manual retry.
 */
export const MAX_AUTOMATIC_CAPTURE_RETRIES = 1;

/**
 * A `capturing` attempt older than this computes to stale (5 minutes). The
 * durable concurrency lease for an attempt expires at the same age, so an
 * abandoned claim frees its Browserless slot exactly when the attempt becomes
 * retryable — one published value governs both views of abandonment.
 */
export const STALE_CAPTURE_AGE_MS = 300_000;

/** First delay between capture-progress polls while work is in progress. */
export const CAPTURE_POLL_INITIAL_INTERVAL_MS = 2_000;

/** Longest delay between capture-progress polls (backoff ceiling). */
export const CAPTURE_POLL_MAX_INTERVAL_MS = 10_000;

/**
 * Longest a client polls one capture workload before stopping (10 minutes).
 * The deadline exceeds the stale age so an abandoned attempt is always
 * observed as computed stale before the poller stands down.
 */
export const CAPTURE_POLL_DEADLINE_MS = 600_000;

/**
 * Orphan-cleanup work stops retrying after this window (1 hour). A known
 * orphan past its deadline is deleted by the cleanup path on sight, never
 * kept: the bound is on retry effort, not on the obligation to delete.
 */
export const CAPTURE_CLEANUP_WINDOW_MS = 3_600_000;

/** Hard byte cap on a capture mutation request body (variant plus key). */
export const CAPTURE_REQUEST_MAX_BYTES = 1_024;
