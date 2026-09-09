// Server-side manifest bounding (VAL-CAPTURE-005, VAL-CAPTURE-006).
//
// The in-page pass already sanitizes and bounds what it collects, but that
// code ran in a remote sandbox against a page we do not control, and its
// output reached us over a network. So the caps that actually gate the write
// are re-applied here, on this side of the boundary, before anything is
// serialized or persisted.
//
// The two policies duplicate deliberately: the page-side one keeps the
// response small, this one keeps the *database* correct even if the response
// was not what the function was supposed to send. Where they differ, this one
// wins, and it degrades rather than fails — a hostile string is trimmed and a
// hostile rectangle drops its element, instead of failing a capture whose
// screenshot is perfectly good.

import {
  MANIFEST_ACCESSIBLE_NAME_MAX_CHARS,
  MANIFEST_ELEMENT_KINDS,
  MANIFEST_HINT_MAX_CHARS,
  MANIFEST_MAX_CLASSES,
  MANIFEST_MAX_COMBINING_MARKS,
  MANIFEST_PATH_MAX_DEPTH,
  MANIFEST_RECT_DECIMALS,
  MANIFEST_RECT_MAX_PX,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_TEXT_MAX_CHARS,
  MAX_MANIFEST_BYTES,
  MAX_MANIFEST_ELEMENTS,
} from "../../boundaries";
import type { CaptureManifest, CaptureManifestElement } from "./result";

/** Bound on the persisted page title; it is inert text like any other field. */
export const DOCUMENT_TITLE_MAX_CHARS = 200;

/** Segments a structural path may contain: a safe tag name and an index. */
const PATH_SEGMENT = /^[a-z][a-z0-9-]{0,31}:[0-9]{1,6}$/;

const KINDS = new Set(MANIFEST_ELEMENT_KINDS);

function forbiddenCode(code: number): boolean {
  return (
    code < 0x20 ||
    code === 0x7f ||
    (code >= 0x80 && code <= 0x9f) ||
    code === 0x61c ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0xfeff
  );
}

function combiningCode(code: number): boolean {
  return (
    (code >= 0x300 && code <= 0x36f) ||
    (code >= 0x483 && code <= 0x489) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20f0) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}

/**
 * Strip everything that could escape a JSON, log, header, or path boundary,
 * collapse whitespace, and bound the result by code point so a surrogate pair
 * is never cut in half.
 */
export function sanitizeManifestString(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length === 0 || max <= 0) return "";
  let filtered = "";
  let marks = 0;
  for (const ch of value) {
    if (filtered.length >= max * 8) break;
    const code = ch.codePointAt(0)!;
    if (forbiddenCode(code)) continue;
    if (combiningCode(code)) {
      marks += 1;
      if (marks > MANIFEST_MAX_COMBINING_MARKS) continue;
    } else {
      marks = 0;
    }
    filtered += ch;
  }
  const collapsed = filtered.replace(/\s+/g, " ").trim();
  let out = "";
  for (const ch of collapsed) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

function roundRect(value: number): number {
  const factor = 10 ** MANIFEST_RECT_DECIMALS;
  return Math.round(value * factor) / factor;
}

function boundedRect(rect: CaptureManifestElement["rect"]): CaptureManifestElement["rect"] | null {
  for (const value of [rect.x, rect.y, rect.width, rect.height]) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (Math.abs(value) > MANIFEST_RECT_MAX_PX) return null;
  }
  if (rect.width < 0 || rect.height < 0) return null;
  return {
    x: roundRect(rect.x),
    y: roundRect(rect.y),
    width: roundRect(rect.width),
    height: roundRect(rect.height),
  };
}

function sanitizePath(path: readonly string[]): string[] {
  const out: string[] = [];
  for (const segment of path) {
    if (out.length >= MANIFEST_PATH_MAX_DEPTH) break;
    const value = sanitizeManifestString(segment, MANIFEST_HINT_MAX_CHARS);
    out.push(PATH_SEGMENT.test(value) ? value : "element:0");
  }
  return out;
}

/** One element reduced to the exact key set with every value inside bounds. */
function sanitizeElement(
  element: CaptureManifestElement,
  index: number,
): CaptureManifestElement | null {
  const rect = boundedRect(element.rect);
  if (!rect) return null;
  const classes: string[] = [];
  for (const value of element.hints.classes) {
    if (classes.length >= MANIFEST_MAX_CLASSES) break;
    const cleaned = sanitizeManifestString(value, MANIFEST_HINT_MAX_CHARS);
    if (cleaned) classes.push(cleaned);
  }
  const id = sanitizeManifestString(element.id, 16);
  return {
    id: /^[A-Za-z0-9_-]{1,16}$/.test(id) ? id : `e${index + 1}`,
    kind: KINDS.has(element.kind) ? element.kind : "text",
    tag: sanitizeManifestString(element.tag, 32),
    role: sanitizeManifestString(element.role, MANIFEST_HINT_MAX_CHARS),
    text: sanitizeManifestString(element.text, MANIFEST_TEXT_MAX_CHARS),
    accessibleName: sanitizeManifestString(
      element.accessibleName,
      MANIFEST_ACCESSIBLE_NAME_MAX_CHARS,
    ),
    hints: {
      id: sanitizeManifestString(element.hints.id, MANIFEST_HINT_MAX_CHARS),
      classes,
      alt: sanitizeManifestString(element.hints.alt, MANIFEST_ACCESSIBLE_NAME_MAX_CHARS),
      title: sanitizeManifestString(element.hints.title, MANIFEST_ACCESSIBLE_NAME_MAX_CHARS),
      testId: sanitizeManifestString(element.hints.testId, MANIFEST_HINT_MAX_CHARS),
    },
    path: sanitizePath(element.path),
    rect,
  };
}

/**
 * An even stride over the vertically ordered elements, returned in their
 * original order. Keeping the first and last of that ordering is what makes
 * top, middle, and bottom coverage survive truncation deterministically.
 */
export function sampleForCoverage<T extends { rect: { x: number; y: number } }>(
  elements: readonly T[],
  keep: number,
): T[] {
  if (keep >= elements.length) return [...elements];
  if (keep <= 0) return [];
  const indexed = elements.map((element, index) => ({ element, index }));
  const vertical = [...indexed].sort(
    (a, b) =>
      a.element.rect.y - b.element.rect.y ||
      a.element.rect.x - b.element.rect.x ||
      a.index - b.index,
  );
  const picked: typeof indexed = keep === 1 ? [vertical[0]!] : [];
  if (keep > 1) {
    for (let i = 0; i < keep; i += 1) {
      picked.push(vertical[Math.round((i * (vertical.length - 1)) / (keep - 1))]!);
    }
  }
  const seen = new Set<number>();
  const unique: typeof indexed = [];
  for (const entry of picked) {
    if (seen.has(entry.index)) continue;
    seen.add(entry.index);
    unique.push(entry);
  }
  return unique.sort((a, b) => a.index - b.index).map((entry) => entry.element);
}

export interface BoundedManifest {
  manifest: CaptureManifest;
  /** The exact UTF-8 JSON that will be persisted. */
  json: string;
  bytes: number;
  /** True when anything was dropped, here or in the page. */
  truncated: boolean;
  /** Elements dropped by this pass, as opposed to by the page. */
  dropped: number;
}

function serialize(manifest: CaptureManifest): { json: string; bytes: number } {
  const json = JSON.stringify(manifest);
  return { json, bytes: Buffer.byteLength(json, "utf8") };
}

/**
 * Sanitize, bound, and serialize a provider manifest. The result always obeys
 * both published caps: at most `MAX_MANIFEST_ELEMENTS` elements and at most
 * `MAX_MANIFEST_BYTES` of exact persisted UTF-8 JSON.
 */
export function boundManifest(input: CaptureManifest): BoundedManifest {
  const sanitized: CaptureManifestElement[] = [];
  let dropped = 0;
  const ids = new Set<string>();
  input.elements.forEach((element, index) => {
    const clean = sanitizeElement(element, index);
    if (!clean) {
      dropped += 1;
      return;
    }
    if (ids.has(clean.id)) clean.id = `e${index + 1}`;
    if (ids.has(clean.id)) {
      dropped += 1;
      return;
    }
    ids.add(clean.id);
    sanitized.push(clean);
  });

  let truncated = input.truncated || dropped > 0;
  let elements = sanitized;
  if (elements.length > MAX_MANIFEST_ELEMENTS) {
    elements = sampleForCoverage(elements, MAX_MANIFEST_ELEMENTS);
    truncated = true;
  }

  let measured = serialize({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    truncated,
    elements,
  });
  while (measured.bytes > MAX_MANIFEST_BYTES && elements.length > 0) {
    const keep = elements.length > 1 ? Math.floor(elements.length * 0.8) : 0;
    elements = sampleForCoverage(elements, keep);
    truncated = true;
    measured = serialize({ schemaVersion: MANIFEST_SCHEMA_VERSION, truncated, elements });
  }

  const manifest: CaptureManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    truncated,
    elements,
  };
  const final = serialize(manifest);
  return {
    manifest,
    json: final.json,
    bytes: final.bytes,
    truncated,
    dropped,
  };
}
