// Playwright global teardown: delete every registered run's Turso rows and
// Blob objects AFTER all workers and their pages have closed (see
// e2e/run-cleanup.ts for why deletion must not happen in afterAll).
//
// No-ops in CI: with no registry entries there is nothing to do, and with
// no local configuration there is no store to clean. Registry files whose
// deletion succeeds are removed; a run id with rows still present after the
// deletes throws, so a cleanup failure fails the run loudly instead of
// leaking into the shared store.

import { eq, inArray, like, or } from "drizzle-orm";
import { databaseFromClient, schema } from "../src/lib/server/db/client";
import { createVercelBlobStore } from "../src/lib/server/providers/blob";
import { localEnvGate, requireLocalEnvValue } from "./local-env";
import {
  clearRunCleanupEntry,
  readRunCleanupRegistry,
  type RunCleanupEntry,
} from "./run-cleanup";

const TEARDOWN_GATE = localEnvGate([
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
]);

async function deleteRun(entry: RunCleanupEntry): Promise<string[]> {
  const runId = entry.runId;
  const { createClient } = await import("@libsql/client");
  const client = createClient({
    url: requireLocalEnvValue("TURSO_DATABASE_URL"),
    authToken: requireLocalEnvValue("TURSO_AUTH_TOKEN"),
  });
  const db = databaseFromClient(client);
  const store = createVercelBlobStore({
    BLOB_READ_WRITE_TOKEN: requireLocalEnvValue("BLOB_READ_WRITE_TOKEN"),
  })!;
  const problems: string[] = [];
  try {
    // Annotations first (they reference captures), scoped to the suite's
    // own body prefixes so a hijacked or stray pin can never FK-block the
    // captures delete — and a foreign body is reported, not deleted.
    for (const prefix of entry.bodyPrefixes) {
      await db
        .delete(schema.annotations)
        .where(like(schema.annotations.originalBody, `${prefix}%`));
    }
    const captures = await db
      .select({ id: schema.captures.id, blobPath: schema.captures.blobPath })
      .from(schema.captures)
      .where(
        or(
          like(schema.captures.requestedUrl, `%${runId}%`),
          like(schema.captures.idempotencyKey, `%${runId}%`),
        ),
      );
    const captureIds = [...new Set(captures.map((row) => row.id))];
    if (captureIds.length > 0) {
      // A pin another suite wrote onto this run's plane (only possible via
      // a seeded-URL hijack) would FK-block the captures delete; report it
      // and remove it rather than leaking the whole run's rows.
      const stray = await db
        .select({ id: schema.annotations.id })
        .from(schema.annotations)
        .where(inArray(schema.annotations.captureId, captureIds));
      for (const row of stray) {
        problems.push(`run ${runId}: foreign annotation ${row.id} on a run capture removed`);
        await db.delete(schema.annotations).where(eq(schema.annotations.id, row.id));
      }
    }
    for (const row of captures) {
      if (row.blobPath) await store.del(row.blobPath);
    }
    // Lease and orphan-cleanup rows name capture ids but carry no FK;
    // delete them so the slot table stays at its steady-state size.
    for (const id of captureIds) {
      await db.delete(schema.captureLeases).where(eq(schema.captureLeases.captureId, id));
      await db.delete(schema.captureCleanups).where(eq(schema.captureCleanups.captureId, id));
      await db.delete(schema.captures).where(eq(schema.captures.id, id));
    }
    await db
      .delete(schema.idempotencyKeys)
      .where(like(schema.idempotencyKeys.key, `%${runId}%`));
    // Form-driven creations key on a fresh UUID, so the run id is matched
    // inside the stored result payload (which carries the run-scoped URLs).
    await db
      .delete(schema.idempotencyKeys)
      .where(like(schema.idempotencyKeys.resultJson, `%${runId}%`));
    await db.delete(schema.pages).where(like(schema.pages.normalizedUrl, `%${runId}%`));
    await db.delete(schema.projects).where(like(schema.projects.rootUrl, `%${runId}%`));

    // Verified absent, or the run fails here.
    const leftCaptures = await db
      .select({ id: schema.captures.id })
      .from(schema.captures)
      .where(
        or(
          like(schema.captures.requestedUrl, `%${runId}%`),
          like(schema.captures.idempotencyKey, `%${runId}%`),
        ),
      );
    if (leftCaptures.length > 0) problems.push(`run ${runId}: ${leftCaptures.length} capture rows remain`);
    const leftPages = await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(like(schema.pages.normalizedUrl, `%${runId}%`));
    if (leftPages.length > 0) problems.push(`run ${runId}: ${leftPages.length} page rows remain`);
    const leftProjects = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(like(schema.projects.rootUrl, `%${runId}%`));
    if (leftProjects.length > 0) {
      problems.push(`run ${runId}: ${leftProjects.length} project rows remain`);
    }
    for (const prefix of entry.bodyPrefixes) {
      const leftPins = await db
        .select({ id: schema.annotations.id })
        .from(schema.annotations)
        .where(like(schema.annotations.originalBody, `${prefix}%`));
      if (leftPins.length > 0) problems.push(`run ${runId}: ${leftPins.length} pins remain`);
    }
    for (const row of captures) {
      if (row.blobPath) {
        const head = await store.head(row.blobPath);
        if (head.ok) problems.push(`run ${runId}: blob ${row.blobPath} remains`);
      }
    }
  } finally {
    client.close();
  }
  return problems;
}

export default async function globalTeardown(): Promise<void> {
  const registry = readRunCleanupRegistry();
  if (registry.length === 0) return;
  if (!TEARDOWN_GATE.ready) {
    // CI: no store, and gated suites never created rows — drop the registry
    // so a later local run does not delete rows it cannot verify.
    for (const { file } of registry) clearRunCleanupEntry(file);
    return;
  }
  const failures: string[] = [];
  for (const { entry, file } of registry) {
    try {
      const problems = await deleteRun(entry);
      if (problems.length > 0) {
        failures.push(...problems);
      } else {
        clearRunCleanupEntry(file);
      }
      // eslint-disable-next-line no-console
      console.log(`[e2e teardown] ${entry.suite} run ${entry.runId}: cleaned`);
    } catch (error) {
      failures.push(`run ${entry.runId}: ${String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`e2e run cleanup failed:\n${failures.join("\n")}`);
  }
}
