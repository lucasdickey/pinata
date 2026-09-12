// Server-only project-scoped annotation read (D077; rectangles since D079).
//
// The workspace's overview, its Next/Previous pin stepping, and the
// project-wide table all need every live pin of a project at once, in the
// order the workspace visits planes: pages in submitted order, Desktop then
// Mobile, older attempts before newer ones, pins by number inside each. The
// hierarchy read already produces that plane order, and listPins already
// answers "the live pins of one ready capture" with the viewer's unread
// counts, so this module walks the one and calls the other rather than
// repeating either query. Read-only; nothing here writes.

import { readProjectHierarchy } from "../projects/hierarchy";
import type { Database } from "../db/client";
import { listPins, type AnnotationRecord } from "./pins";
import { EDITOR_VIEWER, type Viewer } from "./seen";

/** Where an annotation's capture sits in the project. */
export interface ProjectAnnotationLocation {
  pageId: string;
  normalizedUrl: string;
  variant: string;
  attempt: number;
}

/** An annotation (pin or rectangle, D079) plus where its capture sits. */
export type ProjectAnnotationRecord = AnnotationRecord & ProjectAnnotationLocation;

export type ListProjectPinsResult =
  | { ok: true; annotations: ProjectAnnotationRecord[] }
  | { ok: false; error: "not-found" };

/**
 * Every live pin in one project, in page, device, version, number order.
 * A missing or tombstoned project is not-found, like every project read.
 */
export async function listProjectPins(
  db: Database,
  publicId: string,
  now: number,
  viewer: Viewer = EDITOR_VIEWER,
): Promise<ListProjectPinsResult> {
  const project = await readProjectHierarchy(db, publicId, now, viewer);
  if (!project) return { ok: false, error: "not-found" };
  const annotations: ProjectAnnotationRecord[] = [];
  for (const page of project.pages) {
    for (const device of page.devices) {
      // The hierarchy lists attempts newest first; the export and the
      // stepping order read older versions before newer ones.
      const attempts = [...device.attempts].sort((a, b) => a.attempt - b.attempt);
      for (const attempt of attempts) {
        // Only a ready capture can carry pins; listPins refuses the rest.
        if (attempt.state !== "ready") continue;
        const listed = await listPins(db, attempt.id, viewer);
        if (!listed.ok) continue;
        for (const annotation of listed.annotations) {
          annotations.push({
            ...annotation,
            pageId: page.id,
            normalizedUrl: page.normalizedUrl,
            variant: device.variant,
            attempt: attempt.attempt,
          });
        }
      }
    }
  }
  return { ok: true, annotations };
}
