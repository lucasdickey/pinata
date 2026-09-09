// Durable Browserless concurrency admission (VAL-CAPTURE-007).
//
// The active-capture limit is enforced by lease slots in the durable store,
// not by an in-process counter, so it holds across clients and application
// instances. These tests prove the exact boundaries: at-limit claims pass,
// limit-plus-one fails and writes nothing, a released slot is immediately
// reclaimable, an abandoned lease becomes reclaimable exactly when the
// attempt computes stale, and a late release can never free a slot another
// attempt reclaimed. The cross-handle case uses two independent database
// handles over one file — the shape of two application instances sharing
// Turso.

import { createClient, type Client } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, describe, expect, test } from "vitest";
import { MAX_ACTIVE_CAPTURES, STALE_CAPTURE_AGE_MS } from "../../src/lib/boundaries";
import {
  claimCaptureLease,
  countActiveCaptureLeases,
  releaseCaptureLease,
} from "../../src/lib/server/captures/leases";
import { captureAttemptState } from "../../src/lib/server/captures/status";
import { databaseFromClient, type Database } from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

const T0 = 1_800_000_000_000;

let dbs: TestDb[] = [];
let tempDirs: string[] = [];

afterEach(async () => {
  for (const testDb of dbs) testDb.client.close();
  dbs = [];
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  tempDirs = [];
});

async function trackedTestDb(): Promise<TestDb> {
  const testDb = await createTestDb();
  dbs.push(testDb);
  return testDb;
}

/** Two handles over one file-backed database: two "instances", one store. */
async function twoInstances(): Promise<{ a: Database; b: Database; clients: Client[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), "pinata-lease-"));
  tempDirs.push(dir);
  const file = path.join(dir, "leases.db");
  const first = createClient({ url: `file:${file}` });
  const dbA = databaseFromClient(first);
  await migrate(dbA, { migrationsFolder: "drizzle" });
  const second = createClient({ url: `file:${file}` });
  const dbB = databaseFromClient(second);
  dbs.push({ client: first, db: dbA }, { client: second, db: dbB });
  return { a: dbA, b: dbB, clients: [first, second] };
}

describe("claim boundaries", () => {
  test("at-limit claims pass and the limit-plus-one claim fails without writing", async () => {
    const { db } = await trackedTestDb();
    for (let slot = 0; slot < MAX_ACTIVE_CAPTURES; slot += 1) {
      const claim = await claimCaptureLease(db, `cap-${slot}`, T0);
      expect(claim).toEqual({ ok: true, slot });
    }
    const overflow = await claimCaptureLease(db, "cap-overflow", T0);
    expect(overflow).toEqual({ ok: false, error: "quota" });
    // The refused claim changed nothing: exactly the held slots exist.
    expect(await countActiveCaptureLeases(db, T0)).toBe(MAX_ACTIVE_CAPTURES);
  });

  test("a released slot is immediately reclaimable", async () => {
    const { db } = await trackedTestDb();
    await claimCaptureLease(db, "cap-a", T0);
    await claimCaptureLease(db, "cap-b", T0);
    await releaseCaptureLease(db, "cap-a");
    expect(await countActiveCaptureLeases(db, T0)).toBe(1);
    const claim = await claimCaptureLease(db, "cap-c", T0);
    expect(claim.ok).toBe(true);
  });

  test("one attempt never holds two slots, even on a repeated claim", async () => {
    const { db } = await trackedTestDb();
    const first = await claimCaptureLease(db, "cap-a", T0);
    const second = await claimCaptureLease(db, "cap-a", T0 + 1_000);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(await countActiveCaptureLeases(db, T0 + 1_000)).toBe(1);
  });
});

describe("expiry matches the computed-stale boundary", () => {
  test("an unexpired lease is never reclaimable, even at its exact expiry", async () => {
    const { db } = await trackedTestDb();
    await claimCaptureLease(db, "cap-a", T0);
    await claimCaptureLease(db, "cap-b", T0);
    const expiry = T0 + STALE_CAPTURE_AGE_MS;
    // The reclaim predicate is strict: at the expiry instant itself the
    // lease still holds, one millisecond later it does not.
    expect(await claimCaptureLease(db, "cap-c", expiry)).toEqual({
      ok: false,
      error: "quota",
    });
    const reclaimed = await claimCaptureLease(db, "cap-c", expiry + 1);
    expect(reclaimed.ok).toBe(true);
  });

  test("a lease expires at exactly the age its attempt computes stale", async () => {
    const { db } = await trackedTestDb();
    await claimCaptureLease(db, "cap-a", T0);
    await claimCaptureLease(db, "cap-b", T0);
    // The row the lease belongs to: claimed at T0, abandoned mid-capture.
    const row = { status: "capturing", updatedAt: T0 };
    // Not yet stale: the slot still counts.
    expect(captureAttemptState(row, T0 + STALE_CAPTURE_AGE_MS)).toBe("capturing");
    expect(await countActiveCaptureLeases(db, T0 + STALE_CAPTURE_AGE_MS)).toBe(2);
    // Past the age the attempt is stale AND its slot is reclaimable — one
    // published age governs both views of abandonment.
    const past = T0 + STALE_CAPTURE_AGE_MS + 1;
    expect(captureAttemptState(row, past)).toBe("stale");
    const claim = await claimCaptureLease(db, "cap-c", past);
    expect(claim.ok).toBe(true);
  });

  test("a late release cannot free a slot another attempt reclaimed", async () => {
    const { db } = await trackedTestDb();
    await claimCaptureLease(db, "cap-a", T0);
    // cap-b's lease is younger, so it is still live when cap-a's lapses.
    await claimCaptureLease(db, "cap-b", T0 + STALE_CAPTURE_AGE_MS);
    const past = T0 + STALE_CAPTURE_AGE_MS + 1;
    // cap-a's lease expired; cap-c reclaims the slot.
    const reclaim = await claimCaptureLease(db, "cap-c", past);
    expect(reclaim.ok).toBe(true);
    // The abandoned worker wakes up and releases: it must free nothing.
    await releaseCaptureLease(db, "cap-a");
    const held = await claimCaptureLease(db, "cap-d", past);
    expect(held).toEqual({ ok: false, error: "quota" });
    expect(await countActiveCaptureLeases(db, past)).toBe(MAX_ACTIVE_CAPTURES);
  });
});

describe("the limit holds across application instances", () => {
  test("two handles over one store share the same slot budget", async () => {
    const { a, b } = await twoInstances();
    const first = await claimCaptureLease(a, "cap-instance-a", T0);
    expect(first.ok).toBe(true);
    // The second instance sees the first instance's claim: only one slot
    // remains, and it goes to the second instance's first claim.
    const second = await claimCaptureLease(b, "cap-instance-b", T0);
    expect(second.ok).toBe(true);
    expect((second as { slot: number }).slot).not.toBe((first as { slot: number }).slot);
    // From either instance, the limit-plus-one claim is refused.
    expect(await claimCaptureLease(a, "cap-third", T0)).toEqual({ ok: false, error: "quota" });
    expect(await claimCaptureLease(b, "cap-fourth", T0)).toEqual({ ok: false, error: "quota" });
    // A release through one instance frees the slot for the other.
    await releaseCaptureLease(a, "cap-instance-a");
    const afterRelease = await claimCaptureLease(b, "cap-fifth", T0);
    expect(afterRelease.ok).toBe(true);
  });
});
