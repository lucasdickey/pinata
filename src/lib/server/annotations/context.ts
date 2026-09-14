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
// The ranking is a pure function with a documented, deterministic order.
// For a pin (one anchor point): containment of the point, then distance to
// the rectangle, then smaller relevant area, then deeper structural path
// (more specific), then semantic value of the element kind, then the
// capture-local id as a stable tie-break. For a rectangle draft (D079, one
// box): the share of the element that lies inside the box, so a fully
// enclosed element outranks a partially covered one; then the absolute
// overlap area, so among enclosed elements the largest (the card, not its
// caption) comes first; then the same tie-breakers as the point ranking,
// with distance measured from the box. Zero-area and non-finite rectangles
// are never candidates (the manifest boundary already excludes
// hidden/clipped content; this is the deterministic filter on top).

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

/** A draft rectangle's box in screenshot-natural CSS pixels (D079). */
export interface ContextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The elements worth ranking: unique ids, finite rects, positive area. */
function usableElements(elements: readonly ContextElement[]): ContextElement[] {
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
  return usable;
}

/**
 * The tie-breakers both rankings share once their own criteria are equal:
 * smaller area, deeper path, more semantic kind, then the id.
 */
function compareSharedTieBreakers(a: ContextElement, b: ContextElement): number {
  const areaDelta = a.rect.width * a.rect.height - b.rect.width * b.rect.height;
  if (areaDelta !== 0) return areaDelta;
  const depthDelta = b.path.length - a.path.length;
  if (depthDelta !== 0) return depthDelta;
  const kindDelta = (KIND_RANK[a.kind] ?? KIND_RANK.text!) - (KIND_RANK[b.kind] ?? KIND_RANK.text!);
  if (kindDelta !== 0) return kindDelta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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
  const ranked = usableElements(elements).sort((a, b) => {
    const containsA = contains(a.rect, point);
    const containsB = contains(b.rect, point);
    if (containsA !== containsB) return containsA ? -1 : 1;
    const distanceDelta = distance(a.rect, point) - distance(b.rect, point);
    if (distanceDelta !== 0) return distanceDelta;
    return compareSharedTieBreakers(a, b);
  });
  return ranked.slice(0, max);
}

/** The area two boxes share, 0 when they only touch or do not meet. */
export function overlapArea(a: ContextBox, b: ContextBox): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** Distance between the nearest points of two boxes (0 when they meet). */
function boxDistance(a: ContextBox, b: ContextBox): number {
  const dx = Math.max(b.x - (a.x + a.width), 0, a.x - (b.x + b.width));
  const dy = Math.max(b.y - (a.y + a.height), 0, a.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

/**
 * The deterministic nearby-candidate order for one draft rectangle (D079),
 * capped at `max`. Ranked by the share of each element inside the box
 * (descending: enclosed elements first), then by the absolute overlap area
 * (descending: the largest enclosed element first), then by distance from
 * the box for elements it does not touch, then the shared tie-breakers. The
 * first result is what the composer pre-selects. A degenerate or non-finite
 * box yields no candidates.
 */
export function rankOverlapCandidates(
  elements: readonly ContextElement[],
  box: ContextBox,
  max: number = NEARBY_CANDIDATES_MAX,
): ContextElement[] {
  if (!finiteRect(box) || box.width <= 0 || box.height <= 0 || max <= 0) return [];
  const score = (element: ContextElement) => {
    const overlap = overlapArea(element.rect, box);
    return { overlap, share: overlap / (element.rect.width * element.rect.height) };
  };
  const ranked = usableElements(elements).sort((a, b) => {
    const scoreA = score(a);
    const scoreB = score(b);
    if (scoreA.share !== scoreB.share) return scoreB.share - scoreA.share;
    if (scoreA.overlap !== scoreB.overlap) return scoreB.overlap - scoreA.overlap;
    const distanceDelta = boxDistance(a.rect, box) - boxDistance(b.rect, box);
    if (distanceDelta !== 0) return distanceDelta;
    return compareSharedTieBreakers(a, b);
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
