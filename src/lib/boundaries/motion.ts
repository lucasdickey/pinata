// Supported-motion matrix and measurement tolerances (VAL-CAPTURE-004).
// Capture freezes or pauses what it safely can, hides carets, and records a
// warning for motion it cannot freeze, so screenshots and manifests come from
// one stabilized layout state.

export const MOTION_POLICIES = [
  "frozen",
  "paused",
  "hidden",
  "first-frame",
  "unsupported-warn",
  "as-rendered",
] as const;

export type MotionPolicy = (typeof MOTION_POLICIES)[number];

export interface MotionCase {
  case: string;
  label: string;
  policy: MotionPolicy;
}

/** The published motion-support matrix. */
export const SUPPORTED_MOTION: readonly MotionCase[] = Object.freeze([
  { case: "css-animation", label: "CSS animations", policy: "frozen" },
  { case: "css-transition", label: "CSS transitions", policy: "frozen" },
  { case: "caret", label: "Text carets", policy: "hidden" },
  { case: "web-animations", label: "Web Animations API", policy: "paused" },
  { case: "video", label: "Video elements", policy: "paused" },
  {
    case: "animated-image",
    label: "Animated images (GIF/APNG/WebP)",
    policy: "first-frame",
  },
  {
    case: "canvas-js",
    label: "Canvas/JS-driven animation",
    policy: "unsupported-warn",
  },
  { case: "sticky-parallax", label: "Sticky/parallax layers", policy: "as-rendered" },
]);

/** Anchor geometry must survive stabilization within this many CSS px. */
export const MOTION_ANCHOR_TOLERANCE_CSS_PX = 1;

/** Masked deterministic regions may differ by at most this pixel ratio. */
export const MOTION_MASKED_MAX_DIFF_RATIO = 0.001;
