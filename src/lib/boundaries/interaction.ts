// Client interaction bounds (VAL-UI-003, VAL-CANVAS-008, VAL-MARK-007).

/** Every client request resolves to a terminal state within this budget. */
export const CLIENT_REQUEST_TIMEOUT_MS = 15_000;

/** Shared minimum pointer/touch hit target: WCAG 2.2 AA (2.5.8) minimum. */
export const MIN_HIT_TARGET_CSS_PX = 24;
