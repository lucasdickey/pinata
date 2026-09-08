// Real-Turso proof for atomic project creation (VAL-PROJECT-001,
// VAL-PROJECT-006). Focused tests run against an in-memory database; this
// suite exercises the configured Turso database, including the concurrency a
// single local connection cannot reproduce.
//
// It runs only when the Turso environment is present (locally via
// `node --env-file=.env.local node_modules/vitest/vitest.mjs run
// test/integration`) and skips silently otherwise. Every durable row carries
// a unique non-secret run id and is deleted with verified cleanup. No
// credential or connection detail is ever printed.

import { randomBytes } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";
import { createDatabase, schema } from "../../src/lib/server/db/client";
import {
  createProjectAtomically,
  PROJECT_CREATE_SCOPE,
  type CreateProjectDeps,
} from "../../src/lib/server/projects/create";
import { validateProjectSubmission } from "../../src/lib/server/projects/submission";

const hasDatabaseEnv = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
const RUN_ID = `valrun-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const createdKeys: string[] = [];

function runDeps(suffix: string): CreateProjectDeps {
  let counter = 0;
  return {
    now: () => Date.now(),
    newId: () => `${RUN_ID}-${suffix}-${(counter += 1)}`,
    newPublicId: () => `${RUN_ID}-${suffix}-public`,
  };
}

function submissionOf(rootUrl: string, urls?: string[]) {
  const result = validateProjectSubmission({ title: `${RUN_ID} review`, rootUrl, urls });
  if (!result.ok) throw new Error("fixture submission must be valid");
  return result;
}

function idempotencyKey(suffix: string): string {
  const key = `${RUN_ID}-${suffix}`;
  createdKeys.push(key);
  return key;
}

describe.skipIf(!hasDatabaseEnv)("real Turso project transactions", () => {
  test("one transaction persists the project, ordered pages, and both variants", async () => {
    const db = createDatabase(process.env)!;
    const submission = submissionOf("https://chickpea.co", [
      "https://chickpea.co/pricing#plans",
      "https://chickpea.co/about",
      "https://chickpea.co/",
    ]);
    const result = await createProjectAtomically(
      db,
      submission,
      idempotencyKey("atomic"),
      runDeps("atomic"),
    );
    if (!result.ok) throw new Error("expected creation to succeed");
    expect(result.created).toBe(true);

    const pageRows = await db
      .select()
      .from(schema.pages)
      .where(eq(schema.pages.projectId, result.project.projectId));
    expect(
      pageRows.sort((a, b) => a.sortIndex - b.sortIndex).map((page) => page.normalizedUrl),
    ).toEqual([
      "https://chickpea.co/",
      "https://chickpea.co/pricing",
      "https://chickpea.co/about",
    ]);

    const captureRows = await db
      .select()
      .from(schema.captures)
      .where(
        inArray(
          schema.captures.pageId,
          pageRows.map((page) => page.id),
        ),
      );
    expect(captureRows).toHaveLength(6);
    expect(captureRows.every((capture) => capture.status === "pending")).toBe(true);
    expect(captureRows.every((capture) => capture.blobPath === null)).toBe(true);
    for (const page of pageRows) {
      const variants = captureRows
        .filter((capture) => capture.pageId === page.id)
        .map((capture) => capture.variant)
        .sort();
      expect(variants).toEqual(["desktop", "mobile"]);
    }
  }, 60_000);

  test("concurrent same-key requests commit exactly one project", async () => {
    const db = createDatabase(process.env)!;
    const submission = submissionOf("https://chickpea.co", ["https://chickpea.co/privacy"]);
    const key = idempotencyKey("race");

    const settled = await Promise.allSettled([
      createProjectAtomically(db, submission, key, runDeps("race-a")),
      createProjectAtomically(db, submission, key, runDeps("race-b")),
    ]);
    const winners = settled.flatMap((outcome) =>
      outcome.status === "fulfilled" && outcome.value.ok ? [outcome.value.project] : [],
    );
    expect(winners.length).toBeGreaterThanOrEqual(1);
    for (const project of winners) expect(project.projectId).toBe(winners[0]!.projectId);

    const projectRows = await db
      .select()
      .from(schema.projects)
      .where(like(schema.projects.id, `${RUN_ID}-race-%`));
    expect(projectRows).toHaveLength(1);

    // A conflicting payload under the same key never wins.
    const conflict = await createProjectAtomically(
      db,
      submissionOf("https://chickpea.co", ["https://chickpea.co/about"]),
      key,
      runDeps("race-c"),
    );
    expect(conflict).toEqual({ ok: false, error: "conflict" });
  }, 60_000);

  test("the unique page constraint holds against the real database", async () => {
    const db = createDatabase(process.env)!;
    const result = await createProjectAtomically(
      db,
      submissionOf("https://chickpea.co"),
      idempotencyKey("unique"),
      runDeps("unique"),
    );
    if (!result.ok) throw new Error("expected creation to succeed");
    await expect(
      db.insert(schema.pages).values({
        id: `${RUN_ID}-unique-dup`,
        projectId: result.project.projectId,
        requestedUrl: "https://chickpea.co/",
        normalizedUrl: "https://chickpea.co/",
        sortIndex: 9,
        createdAt: Date.now(),
      }),
    ).rejects.toThrow();
  }, 60_000);
});

afterAll(async () => {
  if (!hasDatabaseEnv) return;
  const db = createDatabase(process.env)!;
  // Reverse dependency order, scoped to this run's ids only.
  const projectRows = await db
    .select()
    .from(schema.projects)
    .where(like(schema.projects.id, `${RUN_ID}-%`));
  if (projectRows.length > 0) {
    const pageRows = await db
      .select()
      .from(schema.pages)
      .where(
        inArray(
          schema.pages.projectId,
          projectRows.map((project) => project.id),
        ),
      );
    if (pageRows.length > 0) {
      await db.delete(schema.captures).where(
        inArray(
          schema.captures.pageId,
          pageRows.map((page) => page.id),
        ),
      );
      await db.delete(schema.pages).where(
        inArray(
          schema.pages.id,
          pageRows.map((page) => page.id),
        ),
      );
    }
    await db.delete(schema.projects).where(
      inArray(
        schema.projects.id,
        projectRows.map((project) => project.id),
      ),
    );
  }
  for (const key of createdKeys) {
    await db
      .delete(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.key, key));
  }

  // Verified cleanup: nothing from this run may remain.
  const remainingProjects = await db
    .select()
    .from(schema.projects)
    .where(like(schema.projects.id, `${RUN_ID}-%`));
  const remainingPages = await db
    .select()
    .from(schema.pages)
    .where(like(schema.pages.id, `${RUN_ID}-%`));
  const remainingCaptures = await db
    .select()
    .from(schema.captures)
    .where(like(schema.captures.id, `${RUN_ID}-%`));
  const remainingKeys = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(like(schema.idempotencyKeys.key, `${RUN_ID}-%`));
  expect({
    projects: remainingProjects.length,
    pages: remainingPages.length,
    captures: remainingCaptures.length,
    keys: remainingKeys.length,
    scope: PROJECT_CREATE_SCOPE,
  }).toEqual({ projects: 0, pages: 0, captures: 0, keys: 0, scope: PROJECT_CREATE_SCOPE });
}, 60_000);
