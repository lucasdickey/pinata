// Client interaction bounds (VAL-UI-003, VAL-CANVAS-008, VAL-MARK-007).

/** Every client request resolves to a terminal state within this budget. */
export const CLIENT_REQUEST_TIMEOUT_MS = 15_000;

/** Shared minimum pointer/touch hit target: WCAG 2.2 AA (2.5.8) minimum. */
export const MIN_HIT_TARGET_CSS_PX = 24;

/**
 * Pointer travel, in screen px, at or below which a press/release pair on
 * the canvas is a click rather than a drag (D074). A click on the screenshot
 * drops a draft pin and a click on a saved pin selects it; anything past
 * this distance pans the camera or moves the pin. There are no interaction
 * modes, so this one number is what tells the two intents apart.
 */
export const PLACEMENT_SLOP_SCREEN_PX = 6;

/**
 * Half the width, in screen px, of the band around an arrow's shaft that
 * takes the pointer (D083). An arrow has no area, so selecting and moving it
 * is a distance-to-segment test rather than a box test, and this is the
 * distance. Twice it is the shared minimum hit target, so the band is a
 * full-size target at every zoom without the stored geometry changing.
 */
export const ARROW_HIT_TOLERANCE_CSS_PX = 12;
