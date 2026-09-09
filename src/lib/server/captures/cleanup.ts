// Bounded cleanup state for a known orphan object (VAL-CAPTURE-009).
//
// Turso and Blob are not transactional, so a capture can upload a private
// object and then lose its finalization fence: the capture row is already
// terminal and can never reference the object, which makes the object an
// orphan. The orphan must be deleted. When that deletion itself fails, this
// module is the durable record that one specific, known object still needs
// cleanup — the bounded, retryable alternative to an untracked orphan.
//
// Two guarantees shape every write here:
//
//  1. A terminal capture row is never rewritten to track cleanup. Cleanup
//     state lives in its own table precisely so the immutable-attempts rule
//     (VAL-CAPTURE-008) is untouched.
//  2. Cleanup is bounded. `attempts` counts delete tries and `deadlineAt`
//     closes the retry window; a row past its deadline is still deleted on
//     sight by `reconcileCaptureCleanups`, never silently kept.

import { eq } from "drizzle-orm";
import { CAPTURE_CLEANUP_WINDOW_MS } from "../../boundaries";
import { schema, type Database } from "../db/client";
import type { ScreenshotStore } from "../providers/blob";

/** The one error label persisted for a failed orphan delete. */
const DELETE_FAILED = "orphan-delete-failed";

/**
 * Record that a specific uploaded object could not be deleted and still
 * needs cleanup. Idempotent on the pathname: re-recording the same orphan
 * refreshes the deadline rather than creating a second row. Never throws —
 * a cleanup bookkeeping failure must not crash a capture that already
 * reached a terminal state; the orphan is at worst re-discovered later.
 */
export async function recordOrphanCleanup(
  db: Database,
  input: { blobPath: string; captureId: string },
  now: number,
): Promise<void> {
  const deadlineAt = now + CAPTURE_CLEANUP_WINDOW_MS;
  await db
    .insert(schema.captureCleanups)
    .values({
      blobPath: input.blobPath,
      captureId: input.captureId,
      attempts: 0,
      deadlineAt,
      lastError: DELETE_FAILED,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.captureCleanups.blobPath,
      set: { deadlineAt, lastError: DELETE_FAILED, updatedAt: now },
    });
}

/**
 * Delete every recorded orphan whose retry window is still open (and any
 * past its deadline), removing its row only once the object is confirmed
 * gone. A failed delete increments the bounded attempt count and updates the
 * last-error label; it never deletes the tracking row early. Returns the
 * count of orphans deleted and still pending, for evidence.
 */
export async function reconcileCaptureCleanups(
  db: Database,
  store: ScreenshotStore,
  now: number,
): Promise<{ deleted: number; pending: number }> {
  const rows = await db.select().from(schema.captureCleanups);
  let deleted = 0;
  let pending = 0;
  for (const row of rows) {
    const result = await store.del(row.blobPath);
    // A missing object is a completed cleanup: the orphan is gone.
    if (result.ok || result.error === "not-found") {
      await db
        .delete(schema.captureCleanups)
        .where(eq(schema.captureCleanups.blobPath, row.blobPath));
      deleted += 1;
      continue;
    }
    pending += 1;
    // Past the deadline the retry effort stops, but the row stays so the
    // known orphan is never silently dropped from the books.
    if (now >= row.deadlineAt) continue;
    await db
      .update(schema.captureCleanups)
      .set({ attempts: row.attempts + 1, lastError: DELETE_FAILED, updatedAt: now })
      .where(eq(schema.captureCleanups.blobPath, row.blobPath));
  }
  return { deleted, pending };
}
