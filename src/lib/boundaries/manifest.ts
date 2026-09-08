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
