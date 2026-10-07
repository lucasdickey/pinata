// Adding pages to an existing project (D129).
//
// The same shape as creation, for the pages that were left out of it: one
// transaction writes the idempotency record, the new pages after the
// existing ones, and one pending Desktop plus one pending Mobile attempt per
// new page — or nothing at all. An address the project already has is
// skipped, not repeated, and reported back by row. The project's limits
// hold across the addition: its unique pages (MAX_UNIQUE_PAGE_URLS) and its
// persisted attempts (MAX_CAPTURE_ATTEMPTS_PER_PROJECT), so adding pages
// cannot grow a project past what creation and retries already allow.

import { createHash } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import {
  DESKTOP_VIEWPORT,
  MAX_CAPTURE_ATTEMPTS_PER_PROJECT,
  MAX_UNIQUE_PAGE_URLS,
  MOBILE_VIEWPORT,
} from "../../boundaries";
import { schema, type Database } from "../db/client";
import { defaultCreateProjectDeps, type CreatedPage } from "./create";
import type { PageAdditionRow, ProjectRowError } from "./submission";

/** Idempotency scope for adding pages to a project. */
export const PAGE_ADD_SCOPE = "project-add-pages";

/** A new page's first attempt, as at creation. */
const INITIAL_ATTEMPT = 1;

/** Attempts one new page commits: Desktop and Mobile. */
const ATTEMPTS_PER_PAGE = 2;

export interface AddedPages {
  publicId: string;
  /** The pages written, in the order they were submitted. */
  added: CreatedPage[];
  /** Submitted row indexes whose address the project already had. */
  skipped: number[];
}

export type AddPagesResult =
  | {
      ok: true;
      created: boolean;
      /** The project's internal id, for driving its new attempts. */
      projectId: string;
      result: AddedPages;
    }
  | { ok: false; error: "not-found" }
  | { ok: false; error: "conflict" }
  | { ok: false; error: "limits"; errors: ProjectRowError[] };

export interface AddPagesDeps {
  now: () => number;
  newId: () => string;
}

export const defaultAddPagesDeps: AddPagesDeps = {
  now: defaultCreateProjectDeps.now,
  newId: defaultCreateProjectDeps.newId,
};

function payloadDigest(publicId: string, rows: readonly PageAdditionRow[]): string {
  // The project and the normalized addresses decide the digest, so the same
  // key sent to another project, or with other rows, conflicts.
  return createHash("sha256")
    .update(JSON.stringify({ publicId, urls: rows.map((row) => row.normalizedUrl) }))
    .digest("hex");
}

async function findIdempotencyRecord(db: Database, key: string) {
  const rows = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(and(eq(schema.idempotencyKeys.scope, PAGE_ADD_SCOPE), eq(schema.idempotencyKeys.key, key)))
    .limit(1);
  return rows[0] ?? null;
}

async function liveProject(db: Database, publicId: string) {
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
  // An archived project has left the editor's list (D108); it takes no new
  // pages until it is back, the same as a deleted one.
  if (!project || project.deletedAt !== null || project.archivedAt !== null) return null;
  return project;
}

async function replay(
  db: Database,
  publicId: string,
  record: { payloadDigest: string; resultJson: string | null },
  digest: string,
): Promise<AddPagesResult> {
  if (record.payloadDigest !== digest || record.resultJson === null) {
    return { ok: false, error: "conflict" };
  }
  const project = await liveProject(db, publicId);
  if (!project) return { ok: false, error: "not-found" };
  return {
    ok: true,
    created: false,
    projectId: project.id,
    result: JSON.parse(record.resultJson) as AddedPages,
  };
}

/**
 * Add the submitted rows to a live project. A repeated key with the same
 * rows returns the original result without writing again; a repeated key
 * with other rows, or for another project, conflicts. Rows that are all
 * already in the project write nothing and report every one as skipped.
 */
export async function addPagesToProject(
  db: Database,
  publicId: string,
  rows: readonly PageAdditionRow[],
  idempotencyKey: string,
  deps: AddPagesDeps = defaultAddPagesDeps,
): Promise<AddPagesResult> {
  const digest = payloadDigest(publicId, rows);
  const existingKey = await findIdempotencyRecord(db, idempotencyKey);
  if (existingKey) return replay(db, publicId, existingKey, digest);

  const project = await liveProject(db, publicId);
  if (!project) return { ok: false, error: "not-found" };

  const pageRows = await db
    .select({ normalizedUrl: schema.pages.normalizedUrl, sortIndex: schema.pages.sortIndex })
    .from(schema.pages)
    .where(eq(schema.pages.projectId, project.id));
  const known = new Set(pageRows.map((page) => page.normalizedUrl));
  const fresh = rows.filter((row) => !known.has(row.normalizedUrl));
  const skipped = rows.filter((row) => known.has(row.normalizedUrl)).map((row) => row.index);
  if (fresh.length === 0) {
    return {
      ok: true,
      created: false,
      projectId: project.id,
      result: { publicId, added: [], skipped },
    };
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.captures)
    .innerJoin(schema.pages, eq(schema.captures.pageId, schema.pages.id))
    .where(eq(schema.pages.projectId, project.id));
  const errors: ProjectRowError[] = [];
  if (pageRows.length + fresh.length > MAX_UNIQUE_PAGE_URLS) {
    errors.push({ field: "form", index: null, code: "too-many-pages" });
  } else if ((total ?? 0) + fresh.length * ATTEMPTS_PER_PAGE > MAX_CAPTURE_ATTEMPTS_PER_PROJECT) {
    errors.push({ field: "form", index: null, code: "too-many-captures" });
  }
  if (errors.length > 0) return { ok: false, error: "limits", errors };

  const now = deps.now();
  const firstSort = pageRows.reduce((max, page) => Math.max(max, page.sortIndex), -1) + 1;
  const added: CreatedPage[] = fresh.map((row, position) => ({
    id: deps.newId(),
    requestedUrl: row.requestedUrl,
    normalizedUrl: row.normalizedUrl,
    sortIndex: firstSort + position,
    captures: [
      { id: deps.newId(), variant: "desktop", attempt: INITIAL_ATTEMPT, status: "pending" },
      { id: deps.newId(), variant: "mobile", attempt: INITIAL_ATTEMPT, status: "pending" },
    ],
  }));
  const result: AddedPages = { publicId, added, skipped };
  const viewports = { desktop: DESKTOP_VIEWPORT, mobile: MOBILE_VIEWPORT } as const;

  try {
    await db.transaction(async (tx) => {
      // The idempotency row first, as at creation: its primary key is what
      // turns two concurrent same-key requests into one addition.
      await tx.insert(schema.idempotencyKeys).values({
        scope: PAGE_ADD_SCOPE,
        key: idempotencyKey,
        payloadDigest: digest,
        resultJson: JSON.stringify(result),
        createdAt: now,
      });
      await tx.insert(schema.pages).values(
        added.map((page) => ({
          id: page.id,
          projectId: project.id,
          requestedUrl: page.requestedUrl,
          normalizedUrl: page.normalizedUrl,
          sortIndex: page.sortIndex,
          createdAt: now,
        })),
      );
      await tx.insert(schema.captures).values(
        added.flatMap((page) =>
          page.captures.map((capture) => ({
            id: capture.id,
            pageId: page.id,
            variant: capture.variant,
            attempt: capture.attempt,
            status: capture.status,
            idempotencyKey: `initial:${capture.attempt}`,
            requestedUrl: page.normalizedUrl,
            viewportWidth: viewports[capture.variant].width,
            viewportHeight: viewports[capture.variant].height,
            deviceScaleFactor: viewports[capture.variant].deviceScaleFactor,
            createdAt: now,
            updatedAt: now,
          })),
        ),
      );
      await tx
        .update(schema.projects)
        .set({ updatedAt: now })
        .where(eq(schema.projects.id, project.id));
    });
  } catch (error) {
    // The same key committed first: converge on its result.
    const winner = await findIdempotencyRecord(db, idempotencyKey);
    if (winner) return replay(db, publicId, winner, digest);
    // Another request added one of these addresses first (the unique
    // page index refused the write): the project changed under this one.
    const current = await db
      .select({ normalizedUrl: schema.pages.normalizedUrl })
      .from(schema.pages)
      .where(eq(schema.pages.projectId, project.id));
    const taken = new Set(current.map((page) => page.normalizedUrl));
    if (fresh.some((row) => taken.has(row.normalizedUrl))) return { ok: false, error: "conflict" };
    throw error;
  }

  return { ok: true, created: true, projectId: project.id, result };
}
