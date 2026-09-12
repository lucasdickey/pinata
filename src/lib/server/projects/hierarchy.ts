// The authorized project → page → device hierarchy (VAL-PROJECT-003,
// VAL-PROJECT-004).
//
// Everything here is read from the durable store: the browser holds no page
// list, no attempt state, and no selection authority, so the same hierarchy
// survives reload, process restart, and redeployment. Pages exist only
// because they were explicitly submitted — there is no discovery step
// anywhere in this path — and every level has a deterministic order with an
// explicit tie-breaker so two reads can never disagree.

import { asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { summarizeVariant, type VariantSummary } from "../captures/status";
import { schema, type Database } from "../db/client";
import { CAPTURE_VARIANTS } from "../db/schema";

export interface HierarchyPage {
  id: string;
  requestedUrl: string;
  normalizedUrl: string;
  sortIndex: number;
  /** Always Desktop then Mobile, even before either has an attempt row. */
  devices: VariantSummary[];
}

export interface HierarchyCounts {
  pages: number;
  attempts: number;
  ready: number;
  failed: number;
  /** Attempts still pending, capturing, or computed stale. */
  inProgress: number;
}

export interface ProjectHierarchy {
  projectId: string;
  publicId: string;
  title: string;
  rootUrl: string;
  createdAt: number;
  pages: HierarchyPage[];
  counts: HierarchyCounts;
  progress: ProjectProgress;
}

type CaptureRow = typeof schema.captures.$inferSelect;
type PageRow = typeof schema.pages.$inferSelect;
type ProjectRow = typeof schema.projects.$inferSelect;

// ---- capture progress (D076) ------------------------------------------------
// Per-project progress, computed from the same rows as the hierarchy: one
// unit per page device, judged by its newest attempt, plus a time estimate
// from what this project's finished attempts actually took.

export interface ProjectProgress {
  /** Page devices with at least one attempt. */
  total: number;
  /** Devices whose newest attempt is ready. */
  done: number;
  /** Devices whose newest attempt failed. */
  failed: number;
  /** Devices whose newest attempt is pending, capturing, or computed stale. */
  inProgress: number;
  /** The first page (in submitted order) with an attempt capturing right now. */
  capturingPage: string | null;
  /**
   * Median duration of this project's finished attempts times the devices
   * still in progress; null until at least one attempt has finished.
   */
  estimatedRemainingMs: number | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** Progress for one project from its built pages and its raw attempt rows. */
export function computeProjectProgress(
  pages: HierarchyPage[],
  captureRows: CaptureRow[],
): ProjectProgress {
  const progress: ProjectProgress = {
    total: 0,
    done: 0,
    failed: 0,
    inProgress: 0,
    capturingPage: null,
    estimatedRemainingMs: null,
  };
  for (const page of pages) {
    for (const device of page.devices) {
      const latest = device.latest;
      if (!latest) continue;
      progress.total += 1;
      if (latest.state === "ready") progress.done += 1;
      else if (latest.state === "failed") progress.failed += 1;
      else progress.inProgress += 1;
      if (latest.state === "capturing" && progress.capturingPage === null) {
        progress.capturingPage = page.normalizedUrl;
      }
    }
  }
  const durations = captureRows
    .filter((row) => row.startedAt !== null && row.finishedAt !== null)
    .map((row) => Math.max(0, row.finishedAt! - row.startedAt!));
  if (durations.length > 0) {
    progress.estimatedRemainingMs = median(durations) * progress.inProgress;
  }
  return progress;
}
// ---- end capture progress ---------------------------------------------------

function buildPages(
  pageRows: PageRow[],
  captureRows: CaptureRow[],
  now: number,
): { pages: HierarchyPage[]; counts: HierarchyCounts } {
  const byPage = new Map<string, CaptureRow[]>();
  for (const capture of captureRows) {
    const list = byPage.get(capture.pageId) ?? [];
    list.push(capture);
    byPage.set(capture.pageId, list);
  }

  const counts: HierarchyCounts = {
    pages: pageRows.length,
    attempts: 0,
    ready: 0,
    failed: 0,
    inProgress: 0,
  };

  const pages = pageRows.map((page) => {
    const rows = byPage.get(page.id) ?? [];
    const devices = CAPTURE_VARIANTS.map((variant) =>
      summarizeVariant(
        variant,
        rows.filter((row) => row.variant === variant),
        now,
      ),
    );
    for (const device of devices) {
      for (const attempt of device.attempts) {
        counts.attempts += 1;
        if (attempt.state === "ready") counts.ready += 1;
        else if (attempt.state === "failed") counts.failed += 1;
        else counts.inProgress += 1;
      }
    }
    return {
      id: page.id,
      requestedUrl: page.requestedUrl,
      normalizedUrl: page.normalizedUrl,
      sortIndex: page.sortIndex,
      devices,
    };
  });

  return { pages, counts };
}

async function hydrate(
  db: Database,
  projectRows: ProjectRow[],
  now: number,
): Promise<ProjectHierarchy[]> {
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
          .orderBy(asc(schema.captures.attempt), asc(schema.captures.id));

  const pagesByProject = new Map<string, PageRow[]>();
  for (const page of pageRows) {
    const list = pagesByProject.get(page.projectId) ?? [];
    list.push(page);
    pagesByProject.set(page.projectId, list);
  }

  return projectRows.map((project) => {
    const { pages, counts } = buildPages(
      pagesByProject.get(project.id) ?? [],
      captureRows,
      now,
    );
    // Capture progress (D076): only this project's rows feed its estimate.
    const pageIds = new Set(pages.map((page) => page.id));
    const progress = computeProjectProgress(
      pages,
      captureRows.filter((row) => pageIds.has(row.pageId)),
    );
    return {
      projectId: project.id,
      publicId: project.publicId,
      title: project.title,
      rootUrl: project.rootUrl,
      createdAt: project.createdAt,
      pages,
      counts,
      progress,
    };
  });
}

/** Every live project with its ordered pages, devices, and attempt history. */
export async function listProjectHierarchies(
  db: Database,
  now: number,
): Promise<ProjectHierarchy[]> {
  const projectRows = await db
    .select()
    .from(schema.projects)
    .where(isNull(schema.projects.deletedAt))
    .orderBy(desc(schema.projects.createdAt), asc(schema.projects.id));
  return hydrate(db, projectRows, now);
}

/**
 * One live project by its non-secret public locator. A missing or tombstoned
 * project is null so the caller can answer with the same generic denial it
 * uses for an unauthorized read.
 */
export async function readProjectHierarchy(
  db: Database,
  publicId: string,
  now: number,
): Promise<ProjectHierarchy | null> {
  const projectRows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.publicId, publicId))
    .limit(1);
  const project = projectRows[0];
  if (!project || project.deletedAt !== null) return null;
  const [hierarchy] = await hydrate(db, [project], now);
  return hierarchy ?? null;
}
