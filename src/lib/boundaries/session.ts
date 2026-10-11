// Editor session lifetime policy (VAL-AUTH-003). Values are published in
// docs/EVALS.md and docs/ARCHITECTURE.md; test/boundaries.test.ts fails if
// any of the three drift apart.

/**
 * Absolute editor-session lifetime: 7 days (D130). Never valid past this.
 * The Chrome extension's sign-in (D132) follows the same policy.
 */
export const EDITOR_SESSION_ABSOLUTE_LIFETIME_MS = 604_800_000;

/**
 * Renewal threshold: 6 days. A session may be renewed only when its
 * remaining lifetime is inside this threshold; renewal sets a fresh absolute
 * expiry of now + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS. With a 7-day lifetime
 * that renews any session at least a day old, so signing in again is needed
 * only after 7 days without using Pinata.
 */
export const EDITOR_SESSION_RENEWAL_THRESHOLD_MS = 518_400_000;

/**
 * Maximum byte size of an authentication request body (login/logout JSON),
 * measured as UTF-8. Larger bodies are rejected before parsing.
 */
export const AUTH_REQUEST_MAX_BYTES = 1_024;

/** Maximum characters accepted in the editor password field. */
export const EDITOR_PASSWORD_MAX_CHARS = 256;
