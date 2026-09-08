// Durable abuse quotas (VAL-AUTH-006, VAL-THREAD-006). Both are enforced in
// the durable store so they hold across browser tabs and application
// instances, and both recover after exactly the published window.

/** Failed editor logins allowed per window before throttling. */
export const LOGIN_MAX_FAILURES = 5;

/** Login throttle window and recovery interval: 15 minutes. */
export const LOGIN_WINDOW_MS = 900_000;

/** Founder replies accepted per window. */
export const REPLY_MAX_PER_WINDOW = 30;

/** Reply rate-limit window and recovery interval: 1 hour. */
export const REPLY_WINDOW_MS = 3_600_000;
