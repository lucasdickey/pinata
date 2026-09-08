// Authorized editor reads of the project hierarchy. Every list comes from
// the durable store, never from browser-local state, and every level has an
// explicit deterministic order with a tie-breaker so two reads of the same
// data can never disagree (VAL-PROJECT-001).

import { asc, desc, inArray, isNull } from "drizzle-orm";
import { schema, type Database } from "../db/client";

export interface ProjectPageView {
  id: string;
  requestedUrl: string;
  normalizedUrl: string;
  sortIndex: number;
  captures: { id: string; variant: string; attempt: number; status: string }[];
}

export interface ProjectView {
  projectId: string;
  publicId: string;
  title: string;
  rootUrl: string;
  createdAt: number;
  pages: ProjectPageView[];
}

/** Every live project with its ordered pages and capture attempts. */
export async function listProjects(db: Database): Promise<ProjectView[]> {
  const projectRows = await db
    .select()
    .from(schema.projects)
    .where(isNull(schema.projects.deletedAt))
    .orderBy(desc(schema.projects.createdAt), asc(schema.projects.id));
  if (projectRows.length === 0) return [];

  const pageRows = await db
    .select()
    .from(schema.pages)
    .where(
      inArray(
        schema.pages.projectId,
        projectRows.map((row) => row.id),
      ),
    )
    .orderBy(asc(schema.pages.sortIndex), asc(schema.pages.id));

  const captureRows =
    pageRows.length === 0
      ? []
      : await db
          .select()
          .from(schema.captures)
          .where(
            inArray(
              schema.captures.pageId,
              pageRows.map((row) => row.id),
            ),
          )
          .orderBy(
            asc(schema.captures.variant),
            asc(schema.captures.attempt),
            asc(schema.captures.id),
          );

  const capturesByPage = new Map<string, ProjectPageView["captures"]>();
  for (const capture of captureRows) {
    const list = capturesByPage.get(capture.pageId) ?? [];
    list.push({
      id: capture.id,
      variant: capture.variant,
      attempt: capture.attempt,
      status: capture.status,
    });
    capturesByPage.set(capture.pageId, list);
  }

  const pagesByProject = new Map<string, ProjectPageView[]>();
  for (const page of pageRows) {
    const list = pagesByProject.get(page.projectId) ?? [];
    list.push({
      id: page.id,
      requestedUrl: page.requestedUrl,
      normalizedUrl: page.normalizedUrl,
      sortIndex: page.sortIndex,
      captures: capturesByPage.get(page.id) ?? [],
    });
    pagesByProject.set(page.projectId, list);
  }

  return projectRows.map((project) => ({
    projectId: project.id,
    publicId: project.publicId,
    title: project.title,
    rootUrl: project.rootUrl,
    createdAt: project.createdAt,
    pages: pagesByProject.get(project.id) ?? [],
  }));
}
