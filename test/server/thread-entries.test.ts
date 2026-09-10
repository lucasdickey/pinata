// Unit tests for the append-only thread store (REQUIREMENTS 6,
// VAL-THREAD-001..004): server-assigned labels by role, bounded bodies,
// durable idempotent replay and intent conflicts, rejection against
// tombstoned and foreign pins, the documented order, and the proof that the
// database triggers — not just this module — reject UPDATE and DELETE.

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FEEDBACK_BODY_MAX_CHARS } from "../../src/lib/boundaries";
import { schema } from "../../src/lib/server/db/client";
import {
  AUTHOR_LABEL_BY_ROLE,
  appendThreadEntry,
  listThreadEntries,
} from "../../src/lib/server/threads/entries";
import { createTestDb, type TestDb } from "./test-db";

const T0 = 1_800_000_000_000;

let testDb: TestDb;
let clock = T0;
let ids = 0;
const deps = { now: () => clock, newId: () => `entry-${(ids += 1)}` };

let attempts = 0;

async function seedCapture(id: string, pageId: string, status = "ready") {
  await testDb.db.insert(schema.captures).values({
    id,
    pageId,
    variant: "desktop",
    attempt: (attempts += 1),
    status,
    idempotencyKey: `initial:${id}`,
    requestedUrl: "https://a.example/",
    viewportWidth: 1440,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    documentWidth: 1440,
    documentHeight: 2000,
    imageHash: `hash-${id}`,
    createdAt: T0,
    updatedAt: T0,
  });
}

async function seedPin(id: string, captureId: string, number: number, deletedAt: number | null = null) {
  await testDb.db.insert(schema.annotations).values({
    id,
    captureId,
    kind: "pin",
    number,
    geometryJson: JSON.stringify({ x: 10, y: 20 }),
    originalBody: "Tighten this.",
    createdAt: T0,
    updatedAt: T0,
    deletedAt,
  });
}

beforeEach(async () => {
  clock = T0;
  ids = 0;
  testDb = await createTestDb();
  await testDb.db.insert(schema.projects).values({
    id: "proj-a",
    publicId: "pub-a",
    title: "A",
    rootUrl: "https://a.example/",
    createdAt: T0,
    updatedAt: T0,
  });
  await testDb.db.insert(schema.pages).values({
    id: "page-a",
    projectId: "proj-a",
    requestedUrl: "https://a.example/",
    normalizedUrl: "https://a.example/",
    sortIndex: 0,
    createdAt: T0,
  });
  await seedCapture("cap-a", "page-a");
  await seedCapture("cap-b", "page-a");
  await seedCapture("cap-pending", "page-a", "pending");
  await seedPin("pin-1", "cap-a", 1);
  await seedPin("pin-2", "cap-a", 2);
  await seedPin("pin-gone", "cap-a", 3, T0 + 5);
  await seedPin("pin-pending", "cap-pending", 1);
});

afterEach(() => {
  testDb.client.close();
});

const ref = { captureId: "cap-a", annotationId: "pin-1" };

/** Concatenate an error's message and full cause chain for pattern checks. */
function errorText(error: unknown): string {
  let text = "";
  let current: unknown = error;
  while (current instanceof Error) {
    text += `\n${current.name}: ${current.message}`;
    current = current.cause;
  }
  return text;
}

/** Await a rejection whose message or cause chain matches `pattern`. */
async function expectRejection(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(errorText(error)).toMatch(pattern);
    return;
  }
  throw new Error(`expected rejection matching ${pattern}`);
}

describe("append", () => {
  test("a founder reply is labelled founder and an editor follow-up Lucas", async () => {
    const founder = await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "founder", body: "Agreed, will tighten.", idempotencyKey: "k-founder" },
      deps,
    );
    expect(founder).toEqual({
      ok: true,
      created: true,
      entry: {
        id: "entry-1",
        annotationId: "pin-1",
        actorRole: "founder",
        authorLabel: "founder",
        body: "Agreed, will tighten.",
        createdAt: T0,
      },
    });
    clock = T0 + 1;
    const editor = await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "editor", body: "Thanks!", idempotencyKey: "k-editor" },
      deps,
    );
    expect(editor).toMatchObject({
      ok: true,
      created: true,
      entry: { actorRole: "editor", authorLabel: "Lucas", body: "Thanks!" },
    });
    expect(AUTHOR_LABEL_BY_ROLE).toEqual({ editor: "Lucas", founder: "founder" });
  });

  test("the body is bounded: blank and over-limit bodies persist nothing", async () => {
    for (const body of ["", "   ", "\n\t", "x".repeat(FEEDBACK_BODY_MAX_CHARS + 1)]) {
      const result = await appendThreadEntry(
        testDb.db,
        { ...ref, actorRole: "founder", body, idempotencyKey: `k-${body.length}` },
        deps,
      );
      expect(result, JSON.stringify(body.slice(0, 5))).toEqual({ ok: false, error: "invalid" });
    }
    const atLimit = await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "founder", body: "y".repeat(FEEDBACK_BODY_MAX_CHARS), idempotencyKey: "k-limit" },
      deps,
    );
    expect(atLimit.ok).toBe(true);
    const rows = await testDb.db.select().from(schema.threadEntries);
    expect(rows).toHaveLength(1);
  });

  test("the same key replays the committed entry; a different intent conflicts", async () => {
    const first = await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "founder", body: "Once.", idempotencyKey: "k-once" },
      deps,
    );
    clock = T0 + 50;
    const replay = await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "founder", body: "Once.", idempotencyKey: "k-once" },
      deps,
    );
    expect(replay).toEqual({ ...first, created: false });
    const differentBody = await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "founder", body: "Twice.", idempotencyKey: "k-once" },
      deps,
    );
    expect(differentBody).toEqual({ ok: false, error: "conflict" });
    const differentRole = await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "editor", body: "Once.", idempotencyKey: "k-once" },
      deps,
    );
    expect(differentRole).toEqual({ ok: false, error: "conflict" });
    // Exactly one row committed through all of that.
    expect(await testDb.db.select().from(schema.threadEntries)).toHaveLength(1);
    // The same key on a different pin is an independent scope.
    const otherPin = await appendThreadEntry(
      testDb.db,
      { captureId: "cap-a", annotationId: "pin-2", actorRole: "founder", body: "Once.", idempotencyKey: "k-once" },
      deps,
    );
    expect(otherPin).toMatchObject({ ok: true, created: true });
  });

  test("the admission hook runs only for a genuinely new valid reply", async () => {
    const calls: string[] = [];
    const admit = () => {
      calls.push("admit");
      return { ok: true as const };
    };
    await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "founder", body: "New.", idempotencyKey: "k-admit" },
      deps,
      admit,
    );
    expect(calls).toEqual(["admit"]);
    // Replay: no admission.
    await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "founder", body: "New.", idempotencyKey: "k-admit" },
      deps,
      admit,
    );
    // Invalid body: no admission.
    await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "founder", body: " ", idempotencyKey: "k-admit-2" },
      deps,
      admit,
    );
    // Tombstoned pin: no admission.
    await appendThreadEntry(
      testDb.db,
      { captureId: "cap-a", annotationId: "pin-gone", actorRole: "founder", body: "x", idempotencyKey: "k-admit-3" },
      deps,
      admit,
    );
    expect(calls).toEqual(["admit"]);
    // A refusing hook persists nothing and reports the retry bound.
    const refused = await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "founder", body: "Refused.", idempotencyKey: "k-refused" },
      deps,
      () => ({ ok: false, retryAfterMs: 1234 }),
    );
    expect(refused).toEqual({ ok: false, error: "throttled", retryAfterMs: 1234 });
    expect(await testDb.db.select().from(schema.threadEntries)).toHaveLength(1);
  });

  test("tombstoned, foreign-capture, non-ready, and missing pins are all not-found", async () => {
    for (const target of [
      { captureId: "cap-a", annotationId: "pin-gone" },
      { captureId: "cap-b", annotationId: "pin-1" },
      { captureId: "cap-pending", annotationId: "pin-pending" },
      { captureId: "cap-a", annotationId: "pin-missing" },
      { captureId: "cap-missing", annotationId: "pin-1" },
    ]) {
      const result = await appendThreadEntry(
        testDb.db,
        { ...target, actorRole: "founder", body: "Hello.", idempotencyKey: "k-nf" },
        deps,
      );
      expect(result, JSON.stringify(target)).toEqual({ ok: false, error: "not-found" });
      expect(await listThreadEntries(testDb.db, target)).toEqual({ ok: false, error: "not-found" });
    }
    expect(await testDb.db.select().from(schema.threadEntries)).toHaveLength(0);
  });

  test("tombstoning a pin after replies leaves its entries byte-intact", async () => {
    await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "founder", body: "Kept.", idempotencyKey: "k-kept" },
      deps,
    );
    await testDb.db
      .update(schema.annotations)
      .set({ deletedAt: T0 + 100 })
      .where(eq(schema.annotations.id, "pin-1"));
    const rows = await testDb.db.select().from(schema.threadEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ annotationId: "pin-1", body: "Kept." });
  });
});

describe("list", () => {
  test("returns entries in created_at then id order", async () => {
    // Insert out of order and with a created_at tie to pin the tie-break.
    await testDb.db.insert(schema.threadEntries).values([
      { id: "z", annotationId: "pin-1", actorRole: "editor", authorLabel: "Lucas", body: "3", idempotencyKey: "z", createdAt: T0 + 2 },
      { id: "b", annotationId: "pin-1", actorRole: "founder", authorLabel: "founder", body: "2", idempotencyKey: "b", createdAt: T0 + 1 },
      { id: "a", annotationId: "pin-1", actorRole: "founder", authorLabel: "founder", body: "1", idempotencyKey: "a", createdAt: T0 + 1 },
      { id: "other", annotationId: "pin-2", actorRole: "founder", authorLabel: "founder", body: "x", idempotencyKey: "o", createdAt: T0 },
    ]);
    const listed = await listThreadEntries(testDb.db, ref);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.entries.map((entry) => entry.id)).toEqual(["a", "b", "z"]);
      expect(listed.entries[0]).toEqual({
        id: "a",
        annotationId: "pin-1",
        actorRole: "founder",
        authorLabel: "founder",
        body: "1",
        createdAt: T0 + 1,
      });
    }
  });
});

describe("immutability below the application (VAL-THREAD-002)", () => {
  test("the database triggers reject UPDATE and DELETE issued through the ORM", async () => {
    const appended = await appendThreadEntry(
      testDb.db,
      { ...ref, actorRole: "founder", body: "Immutable.", idempotencyKey: "k-imm" },
      deps,
    );
    expect(appended.ok).toBe(true);
    // Drizzle wraps the driver error; the trigger's message is on the cause
    // chain, which is exactly where the proof that the database (not this
    // module) refused the write lives.
    await expectRejection(
      testDb.db
        .update(schema.threadEntries)
        .set({ body: "edited" })
        .where(eq(schema.threadEntries.id, "entry-1")),
      /append-only/i,
    );
    await expectRejection(
      testDb.db.delete(schema.threadEntries).where(eq(schema.threadEntries.id, "entry-1")),
      /append-only/i,
    );
    // Even an UPDATE that changes nothing is refused by the trigger.
    await expectRejection(
      testDb.client.execute({
        sql: "UPDATE thread_entries SET body = body WHERE id = ?",
        args: ["entry-1"],
      }),
      /append-only/i,
    );
    const rows = await testDb.db.select().from(schema.threadEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "entry-1", body: "Immutable." });
  });
});
