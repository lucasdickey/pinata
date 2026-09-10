// Server-only nearby-DOM context for pin drafts (VAL-PIN-003, VAL-PIN-008).
//
// Candidates come only from the immutable, sanitized manifest persisted with
// the capture — never from the source site's live DOM, never from a
// client-supplied metadata object. The draft panel offers this ranked list;
// Lucas explicitly chooses one capture-local element id or "No element"
// (null), and the server re-derives the bounded inert snapshot from the
// manifest at save time. A snapshot is therefore always exactly one element
// of the capture's own manifest, or exactly null.
//
// The ranking is a pure function with a documented, deterministic order:
// containment of the anchor point, then distance to the rectangle, then
// smaller relevant area, then deeper structural path (more specific), then
// semantic value of the element kind, then the capture-local id as a stable
// tie-break. Zero-area and non-finite rectangles are never candidates (the
// manifest boundary already excludes hidden/clipped content; this is the
// deterministic filter on top).

import { NEARBY_CANDIDATES_MAX } from "../../boundaries";
import {
  captureManifestSchema,
  type CaptureManifestElement,
} from "../captures/result";

/** One manifest element as offered to (and persisted from) the pin flow. */
export type ContextElement = CaptureManifestElement;

/**
 * The elements of a capture's persisted manifest JSON, re-validated on read
 * against the versioned exact-key schema. Null when there is no manifest or
 * the persisted JSON fails validation — in which case no element id can
 * resolve and only the explicit "No element" decision remains valid.
 */
export function parseManifestElements(json: string | null): ContextElement[] | null {
  if (!json) return null;
  try {
    const parsed = captureManifestSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data.elements : null;
  } catch {
    return null;
  }
}

/** Semantic value per manifest kind: lower ranks earlier on exact ties. */
const KIND_RANK: Record<string, number> = {
  control: 0,
  link: 1,
  heading: 2,
  "table-cell": 3,
  summary: 4,
  details: 5,
  image: 6,
  text: 7,
  landmark: 8,
};

function finiteRect(rect: ContextElement["rect"]): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
}

function contains(rect: ContextElement["rect"], point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** Distance from the point to the nearest point of the rectangle (0 inside). */
function distance(rect: ContextElement["rect"], point: { x: number; y: number }): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * The deterministic nearby-candidate order for one anchor point, capped at
 * `max` (the shared NEARBY_CANDIDATES_MAX by default). Input order never
 * affects output order; duplicate ids collapse to the first occurrence.
 */
export function rankNearbyCandidates(
  elements: readonly ContextElement[],
  point: { x: number; y: number },
  max: number = NEARBY_CANDIDATES_MAX,
): ContextElement[] {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || max <= 0) return [];
  const seen = new Set<string>();
  const usable: ContextElement[] = [];
  for (const element of elements) {
    if (seen.has(element.id)) continue;
    if (!finiteRect(element.rect) || element.rect.width <= 0 || element.rect.height <= 0) {
      continue;
    }
    seen.add(element.id);
    usable.push(element);
  }
  const ranked = [...usable].sort((a, b) => {
    const containsA = contains(a.rect, point);
    const containsB = contains(b.rect, point);
    if (containsA !== containsB) return containsA ? -1 : 1;
    const distanceDelta = distance(a.rect, point) - distance(b.rect, point);
    if (distanceDelta !== 0) return distanceDelta;
    const areaDelta = a.rect.width * a.rect.height - b.rect.width * b.rect.height;
    if (areaDelta !== 0) return areaDelta;
    const depthDelta = b.path.length - a.path.length;
    if (depthDelta !== 0) return depthDelta;
    const kindDelta = (KIND_RANK[a.kind] ?? KIND_RANK.text!) - (KIND_RANK[b.kind] ?? KIND_RANK.text!);
    if (kindDelta !== 0) return kindDelta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return ranked.slice(0, max);
}

/**
 * The persisted context snapshot for one explicit decision: a deep copy of
 * the named manifest element, or null for "No element" and for ids the
 * capture's manifest does not contain (the caller treats an unknown id as an
 * invalid save, so a snapshot can never be invented or rebound).
 */
export function deriveSnapshot(
  elements: readonly ContextElement[],
  elementId: string | null,
): ContextElement | null {
  if (elementId === null) return null;
  const found = elements.find((element) => element.id === elementId);
  return found ? (JSON.parse(JSON.stringify(found)) as ContextElement) : null;
}
