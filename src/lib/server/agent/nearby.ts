// Nearby elements for the agent brief (D138): the manifest elements around a
// mark, as text, so an agent can usually place the mark without opening the
// screenshot.
//
// A full-page screenshot is tall, and a vision model downscales it until the
// text is unreadable, so an agent that wants to see a mark has to crop around
// it first and pay for every crop. The capture's persisted manifest already
// knows what sits around the mark; a handful of those elements costs a few
// dozen tokens each and answers the question the crop was going to answer.
//
// The ranking is the one the composer uses to offer candidates (context.ts):
// containment and distance for a point, overlap for a box. From that order
// this module drops what the brief already prints (the mark's own elements)
// and what reads as nothing in text (an element with no text, name, or alt),
// then keeps the first few. Pure: the route loads the manifest, this ranks it.

import { and, eq, inArray } from "drizzle-orm";
import type { PinElementSnapshot } from "../../annotations";
import { circleBounds } from "../../canvas/circle";
import type { AnnotationGeometry } from "../annotations/pins";
import {
  parseManifestElements,
  rankNearbyCandidates,
  rankOverlapCandidates,
  type ContextElement,
} from "../annotations/context";
import { schema, type Database } from "../db/client";

/** How many nearby elements one mark carries in the brief. */
export const AGENT_BRIEF_NEARBY_MAX = 4;

/** True when the element says something an agent can search the code for. */
function readable(element: ContextElement): boolean {
  return (
    element.text.trim() !== "" ||
    element.accessibleName.trim() !== "" ||
    element.hints.alt.trim() !== ""
  );
}

function rankForMark(
  elements: readonly ContextElement[],
  mark: AnnotationGeometry,
  max: number,
): ContextElement[] {
  // Ranking asks for more than it keeps, since attached and textless
  // elements are dropped afterwards.
  const want = max * 4;
  switch (mark.kind) {
    case "pin":
      return rankNearbyCandidates(elements, mark.tip, want);
    case "arrow":
      // The head is what an arrow points at; the shaft's bounds would rank
      // the whole run of the page it crosses.
      return rankNearbyCandidates(elements, mark.arrow.end, want);
    case "rectangle":
      return rankOverlapCandidates(elements, mark.rect, want);
    case "circle":
      return rankOverlapCandidates(elements, circleBounds(mark.circle), want);
  }
}

/**
 * The elements around one mark worth naming in the brief, in ranking order:
 * never one the mark is attached to, never one with nothing to read, at most
 * `max`. An empty manifest yields an empty list.
 */
export function nearbyElementsForMark(
  elements: readonly ContextElement[],
  mark: AnnotationGeometry & {
    elementSnapshot: PinElementSnapshot | null;
    alsoElements?: readonly PinElementSnapshot[];
  },
  max: number = AGENT_BRIEF_NEARBY_MAX,
): ContextElement[] {
  if (max <= 0 || elements.length === 0) return [];
  const attached = new Set<string>();
  if (mark.elementSnapshot) attached.add(mark.elementSnapshot.id);
  for (const also of mark.alsoElements ?? []) attached.add(also.id);
  const kept: ContextElement[] = [];
  for (const element of rankForMark(elements, mark, max)) {
    if (attached.has(element.id) || !readable(element)) continue;
    kept.push(element);
    if (kept.length >= max) break;
  }
  return kept;
}

/** What the brief needs about one screenshot beyond its marks. */
export interface BriefCapture {
  captureId: string;
  /** The image's pixel size, or null for a capture that never recorded one. */
  size: { width: number; height: number } | null;
  /** The capture's manifest elements; empty when it has none or it fails to parse. */
  elements: ContextElement[];
}

/**
 * The size and manifest of each ready capture named, keyed by capture id.
 * Only ready captures of the one project are read, so a brief can never
 * carry another project's manifest. Unknown ids are simply absent.
 */
export async function loadBriefCaptures(
  db: Database,
  projectId: string,
  captureIds: readonly string[],
): Promise<Map<string, BriefCapture>> {
  const result = new Map<string, BriefCapture>();
  const ids = [...new Set(captureIds)];
  if (ids.length === 0) return result;
  const rows = await db
    .select({
      id: schema.captures.id,
      status: schema.captures.status,
      documentWidth: schema.captures.documentWidth,
      documentHeight: schema.captures.documentHeight,
      domManifestJson: schema.captures.domManifestJson,
    })
    .from(schema.captures)
    .innerJoin(schema.pages, eq(schema.captures.pageId, schema.pages.id))
    .where(and(eq(schema.pages.projectId, projectId), inArray(schema.captures.id, ids)));
  for (const row of rows) {
    if (row.status !== "ready") continue;
    const size =
      row.documentWidth !== null &&
      row.documentHeight !== null &&
      row.documentWidth > 0 &&
      row.documentHeight > 0
        ? { width: row.documentWidth, height: row.documentHeight }
        : null;
    result.set(row.id, {
      captureId: row.id,
      size,
      elements: parseManifestElements(row.domManifestJson) ?? [],
    });
  }
  return result;
}
