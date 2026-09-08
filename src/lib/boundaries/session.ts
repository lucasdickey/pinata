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
