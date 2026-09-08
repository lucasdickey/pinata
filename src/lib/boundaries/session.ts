// Editor session lifetime policy (VAL-AUTH-003). Values are published in
// docs/EVALS.md and docs/ARCHITECTURE.md; test/boundaries.test.ts fails if
// any of the three drift apart.

/** Absolute editor-session lifetime: 12 hours. Never valid past this. */
export const EDITOR_SESSION_ABSOLUTE_LIFETIME_MS = 43_200_000;

/**
 * Renewal threshold: 2 hours. A session may be renewed only when its
 * remaining lifetime is inside this threshold; renewal sets a fresh absolute
 * expiry of now + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS.
 */
export const EDITOR_SESSION_RENEWAL_THRESHOLD_MS = 7_200_000;

/**
 * Maximum byte size of an authentication request body (login/logout JSON),
 * measured as UTF-8. Larger bodies are rejected before parsing.
 */
export const AUTH_REQUEST_MAX_BYTES = 1_024;

/** Maximum characters accepted in the editor password field. */
export const EDITOR_PASSWORD_MAX_CHARS = 256;
