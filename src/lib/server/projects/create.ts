// Atomic project creation (VAL-PROJECT-001, VAL-PROJECT-006).
//
// One transaction writes the idempotency record, the project, every unique
// ordered page, and exactly one pending Desktop plus one pending Mobile
// initial attempt per page — or nothing at all. No provider work may start
// until that transaction has committed, so a rejected or failed submission
// can never leave a half-built project or an orphaned capture job.

import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { DESKTOP_VIEWPORT, MOBILE_VIEWPORT } from "../../boundaries";
import { schema, type Database } from "../db/client";
import type { ProjectSubmission } from "./submission";

/** Idempotency scope for editor project creation. */
export const PROJECT_CREATE_SCOPE = "project-create";

/** The first attempt of a (page, variant) pair; retries increment from here. */
const INITIAL_ATTEMPT = 1;

export interface CreatedCapture {
  id: string;
  variant: "desktop" | "mobile";
  attempt: number;
  status: "pending";
}

export interface CreatedPage {
  id: string;
  requestedUrl: string;
  normalizedUrl: string;
  sortIndex: number;
  captures: CreatedCapture[];
}

export interface CreatedProject {
  projectId: string;
  publicId: string;
  title: string;
  rootUrl: string;
  pages: CreatedPage[];
}

export type CreateProjectResult =
  | { ok: true; created: boolean; project: CreatedProject }
  | { ok: false; error: "conflict" };

export interface CreateProjectDeps {
  now: () => number;
  newId: () => string;
  newPublicId: () => string;
}

export const defaultCreateProjectDeps: CreateProjectDeps = {
  now: () => Date.now(),
  newId: () => randomUUID(),
  // Non-secret locator: unguessable enough to avoid enumeration, but never a
  // capability — authorization is always checked separately.
  newPublicId: () => randomBytes(9).toString("base64url"),
};

type SuccessfulSubmission = Extract<ProjectSubmission, { ok: true }>;

async function findIdempotencyRecord(db: Database, key: string) {
  const rows = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.scope, PROJECT_CREATE_SCOPE),
        eq(schema.idempotencyKeys.key, key),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function replay(
  record: { payloadDigest: string; resultJson: string | null },
  payloadDigest: string,
): CreateProjectResult {
  // Same key, different intent is a conflict: the caller must choose a new
  // key rather than silently getting someone else's project back.
  if (record.payloadDigest !== payloadDigest || record.resultJson === null) {
    return { ok: false, error: "conflict" };
  }
  return {
    ok: true,
    created: false,
    project: JSON.parse(record.resultJson) as CreatedProject,
  };
}

/**
 * Create the project, its pages, and their initial pending attempts in one
 * transaction. A repeated key with the same normalized payload returns the
 * original identities without writing again; a repeated key with a different
 * payload conflicts.
 */
export async function createProjectAtomically(
  db: Database,
  submission: SuccessfulSubmission,
  idempotencyKey: string,
  deps: CreateProjectDeps = defaultCreateProjectDeps,
): Promise<CreateProjectResult> {
  const existing = await findIdempotencyRecord(db, idempotencyKey);
  if (existing) return replay(existing, submission.payloadDigest);

  const now = deps.now();
  const projectId = deps.newId();
  const publicId = deps.newPublicId();

  const pages: CreatedPage[] = submission.pages.map((page) => ({
    id: deps.newId(),
    requestedUrl: page.requestedUrl,
    normalizedUrl: page.normalizedUrl,
    sortIndex: page.sortIndex,
    captures: [
      { id: deps.newId(), variant: "desktop", attempt: INITIAL_ATTEMPT, status: "pending" },
      { id: deps.newId(), variant: "mobile", attempt: INITIAL_ATTEMPT, status: "pending" },
    ],
  }));

  const project: CreatedProject = {
    projectId,
    publicId,
    title: submission.title,
    rootUrl: submission.rootUrl,
    pages,
  };

  const viewports = { desktop: DESKTOP_VIEWPORT, mobile: MOBILE_VIEWPORT } as const;

  try {
    await db.transaction(async (tx) => {
      // The idempotency row goes first: its primary key is what makes two
      // concurrent same-key requests resolve to one committed project.
      await tx.insert(schema.idempotencyKeys).values({
        scope: PROJECT_CREATE_SCOPE,
        key: idempotencyKey,
        payloadDigest: submission.payloadDigest,
        resultJson: JSON.stringify(project),
        createdAt: now,
      });
      await tx.insert(schema.projects).values({
        id: projectId,
        publicId,
        title: submission.title,
        rootUrl: submission.rootUrl,
        shareTokenVersion: 0,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.pages).values(
        pages.map((page) => ({
          id: page.id,
          projectId,
          requestedUrl: page.requestedUrl,
          normalizedUrl: page.normalizedUrl,
          sortIndex: page.sortIndex,
          createdAt: now,
        })),
      );
      await tx.insert(schema.captures).values(
        pages.flatMap((page) =>
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
    });
  } catch (error) {
    // A concurrent request may have committed this key first; converge on
    // that single result instead of reporting a spurious failure.
    const winner = await findIdempotencyRecord(db, idempotencyKey);
    if (winner) return replay(winner, submission.payloadDigest);
    throw error;
  }

  return { ok: true, created: true, project };
}
