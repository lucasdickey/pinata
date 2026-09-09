// Durable Browserless concurrency admission (VAL-CAPTURE-007).
//
// At most MAX_ACTIVE_CAPTURES provider jobs may overlap across every client
// and every application instance, so the gate cannot be an in-process
// counter: it lives in the shared durable store as one row per slot. Claiming
// a slot is a single atomic conditional upsert, so two instances racing the
// same slot cannot both win it.
//
// Lease lifetime deliberately equals STALE_CAPTURE_AGE_MS: the attempt a
// lease belongs to computes to stale at exactly the moment its slot becomes
// reclaimable, so abandonment is one published age, not two. Expired leases
// are reclaimed in place; there is no sweeper and no separate stale column.
//
// Release is conditional on the capture id: a worker that lost its lease to
// expiry can never free the slot a newer attempt has reclaimed.

import { count, eq, gte, lt } from "drizzle-orm";
import { MAX_ACTIVE_CAPTURES, STALE_CAPTURE_AGE_MS } from "../../boundaries";
import { schema, type Database } from "../db/client";

export type ClaimLeaseResult =
  | { ok: true; slot: number }
  /** Every slot is held by unexpired work; the attempt stays pending. */
  | { ok: false; error: "quota" };

/** Drizzle wraps driver errors, so scan the whole cause chain. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (/unique constraint/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

/**
 * Take one durable concurrency slot for an attempt, or report that the
 * published active-capture limit is full. Tries each slot with one atomic
 * upsert that only reclaims a slot whose lease has already expired; a lost
 * race on one slot falls through to the next.
 *
 * Claiming is idempotent per attempt: one capture holds at most one slot
 * (enforced by the unique capture_id), so a retried dispatch of the same
 * attempt reuses the slot it already holds rather than consuming a second.
 */
export async function claimCaptureLease(
  db: Database,
  captureId: string,
  now: number,
): Promise<ClaimLeaseResult> {
  const expiresAt = now + STALE_CAPTURE_AGE_MS;
  for (let slot = 0; slot < MAX_ACTIVE_CAPTURES; slot += 1) {
    try {
      const claimed = await db
        .insert(schema.captureLeases)
        .values({ slot, captureId, expiresAt, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.captureLeases.slot,
          set: { captureId, expiresAt, createdAt: now, updatedAt: now },
          where: lt(schema.captureLeases.expiresAt, now),
        })
        .returning({ slot: schema.captureLeases.slot });
      if (claimed.length === 1) return { ok: true, slot: claimed[0]!.slot };
    } catch (error) {
      // The only unique key a claim can violate is capture_id (the slot
      // conflict is handled by the upsert), which means this attempt already
      // holds a slot — a concurrent dispatch of the same attempt won one.
      if (isUniqueViolation(error)) {
        const held = await db
          .select({ slot: schema.captureLeases.slot })
          .from(schema.captureLeases)
          .where(eq(schema.captureLeases.captureId, captureId))
          .limit(1);
        if (held[0]) return { ok: true, slot: held[0].slot };
      }
      throw error;
    }
  }
  return { ok: false, error: "quota" };
}

/**
 * Free the slot this attempt holds, if it still holds one. Conditional on
 * the capture id, so a late release after lease expiry cannot free a slot
 * another attempt has since reclaimed.
 */
export async function releaseCaptureLease(db: Database, captureId: string): Promise<void> {
  await db
    .delete(schema.captureLeases)
    .where(eq(schema.captureLeases.captureId, captureId));
}

/**
 * How many slots are held by live leases — evidence and tests only. A lease
 * is live until the reclaim predicate (`expires_at < now`) could take it, so
 * the boundary matches the claim path exactly: live at its expiry instant,
 * reclaimable one millisecond later.
 */
export async function countActiveCaptureLeases(db: Database, now: number): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.captureLeases)
    .where(gte(schema.captureLeases.expiresAt, now));
  return total ?? 0;
}
