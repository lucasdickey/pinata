// DOM manifest schema policy (VAL-CAPTURE-005/006): exact keys, bounded
// enums/strings, depth and precision limits, and the two hard caps.

/** Version persisted alongside each manifest as `dom_manifest_version`. */
export const MANIFEST_SCHEMA_VERSION = 1;

/** Maximum collected elements per manifest. */
export const MAX_MANIFEST_ELEMENTS = 500;

/** Maximum persisted manifest size: 256 KiB of exact UTF-8 JSON. */
export const MAX_MANIFEST_BYTES = 262_144;

/** Maximum characters of short visible text per element. */
export const MANIFEST_TEXT_MAX_CHARS = 120;

/** Maximum characters of accessible name per element. */
export const MANIFEST_ACCESSIBLE_NAME_MAX_CHARS = 120;

/** Maximum class hints retained per element. */
export const MANIFEST_MAX_CLASSES = 8;

/** Maximum characters of any single safe hint value (`id`, class, `testId`). */
export const MANIFEST_HINT_MAX_CHARS = 64;

/**
 * Maximum consecutive combining marks kept on one base character. A longer
 * run is a stacked-diacritic ("zalgo") string that renders far outside its
 * own box, so the excess is dropped rather than stored.
 */
export const MANIFEST_MAX_COMBINING_MARKS = 8;

/**
 * Absolute bound on any rectangle coordinate or extent, in CSS px. Well above
 * a maximum-height document, so it only ever rejects a value that cannot
 * describe a real captured layout.
 */
export const MANIFEST_RECT_MAX_PX = 100_000;

/** Maximum structural-path segments per element. */
export const MANIFEST_PATH_MAX_DEPTH = 12;

/** Decimal places retained on rectangle coordinates. */
export const MANIFEST_RECT_DECIMALS = 2;

/** The exact key set of a manifest element; no other keys may appear. */
export const MANIFEST_ELEMENT_KEYS: readonly string[] = Object.freeze([
  "id",
  "kind",
  "tag",
  "role",
  "text",
  "accessibleName",
  "hints",
  "path",
  "rect",
]);

/** The exact key set of an element's `hints` object. */
export const MANIFEST_HINT_KEYS: readonly string[] = Object.freeze([
  "id",
  "classes",
  "alt",
  "title",
  "testId",
]);

/** The bounded element-kind enum (the useful semantic candidate set). */
export const MANIFEST_ELEMENT_KINDS: readonly string[] = Object.freeze([
  "landmark",
  "heading",
  "link",
  "control",
  "image",
  "table-cell",
  "details",
  "summary",
  "text",
]);
