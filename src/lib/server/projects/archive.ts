// Archiving a project (D108).
//
// An archive takes a project out of the editor's project list and changes
// nothing else: its pages, captures, pins, threads, and founder link stay as
// they were (D110), so undoing it later (D109, deferred) is a matter of
// clearing one column. It is not a delete — deletedAt stays the tombstone.

import { eq } from "drizzle-orm";
import { schema, type Database } from "../db/client";

export type ArchiveResult =
  | { ok: true; archivedAt: number }
  | { ok: false; error: "not-found" };

/**
 * Archive one live project by its public locator. Archiving an already
 * archived project succeeds and keeps the original timestamp, so a double
 * click or a retried request changes nothing.
 */
export async function archiveProject(
  db: Database,
  publicId: string,
  now: number,
): Promise<ArchiveResult> {
  const rows = await db
    .select({
      id: schema.projects.id,
      deletedAt: schema.projects.deletedAt,
      archivedAt: schema.projects.archivedAt,
    })
    .from(schema.projects)
    .where(eq(schema.projects.publicId, publicId))
    .limit(1);
  const project = rows[0];
  if (!project || project.deletedAt !== null) return { ok: false, error: "not-found" };
  if (project.archivedAt !== null) return { ok: true, archivedAt: project.archivedAt };
  await db
    .update(schema.projects)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(schema.projects.id, project.id));
  return { ok: true, archivedAt: now };
}
