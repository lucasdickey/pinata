// The pin lifecycle (D075, REQUIREMENTS 6): open on create, replied on the
// founder's first reply, resolved and reopened by either role with one
// append-only `status` entry per change, no revision bump, and the same
// generic not-found for tombstoned, foreign, and non-ready pins. Status
// entries are as immutable as messages.

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { listPins } from "../../src/lib/server/annotations/pins";
import { EDITOR_VIEWER, founderViewer } from "../../src/lib/server/annotations/seen";
import { setPinStatus, statusEntryBody } from "../../src/lib/server/annotations/status";
import { schema } from "../../src/lib/server/db/client";
import { appendThreadEntry, listThreadEntries } from "../../src/lib/server/threads/entries";
import { createTestDb, type TestDb } from "./test-db";

const T0 = 1_800_000_000_000;

let testDb: TestDb;
let clock = T0;
let ids = 0;
const deps = { now: () => clock, newId: () => `id-${(ids += 1)}` };
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

async function statusOf(id: string) {
  const [row] = await testDb.db
    .select({ status: schema.annotations.status, revision: schema.annotations.revision })
    .from(schema.annotations)
    .where(eq(schema.annotations.id, id));
  return row!;
}

let keys = 0;
const reply = (actorRole: "editor" | "founder", body = "Reply.") => ({
  captureId: "cap-a",
  annotationId: "pin-1",
  actorRole,
  body,
  idempotencyKey: `k-${(keys += 1)}`,
});

const ref = { captureId: "cap-a", annotationId: "pin-1", viewer: EDITOR_VIEWER };

beforeEach(async () => {
  clock = T0;
  ids = 0;
  keys = 0;
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

describe("status on append", () => {
  test("a pin starts open; the founder's reply moves it to replied; editor follow-ups change nothing", async () => {
    expect((await statusOf("pin-1")).status).toBe("open");
    await appendThreadEntry(testDb.db, reply("editor", "Any thoughts?"), deps);
    expect((await statusOf("pin-1")).status).toBe("open");
    clock = T0 + 1;
    await appendThreadEntry(testDb.db, reply("founder", "Yes."), deps);
    expect(await statusOf("pin-1")).toEqual({ status: "replied", revision: 1 });
    clock = T0 + 2;
    await appendThreadEntry(testDb.db, reply("editor", "Great."), deps);
    expect((await statusOf("pin-1")).status).toBe("replied");
    // The sibling pin is untouched.
    expect((await statusOf("pin-2")).status).toBe("open");
  });

  test("a founder reply on a resolved pin leaves it resolved", async () => {
    await setPinStatus(testDb.db, { ...ref, action: "resolve", actorRole: "editor" }, deps);
    clock = T0 + 1;
    await appendThreadEntry(testDb.db, reply("founder", "Done anyway."), deps);
    expect((await statusOf("pin-1")).status).toBe("resolved");
  });

  test("a replayed founder reply does not touch the status again", async () => {
    const first = reply("founder", "Once.");
    await appendThreadEntry(testDb.db, first, deps);
    await setPinStatus(testDb.db, { ...ref, action: "resolve", actorRole: "founder" }, deps);
    const replayed = await appendThreadEntry(testDb.db, first, deps);
    expect(replayed).toMatchObject({ ok: true, created: false });
    expect((await statusOf("pin-1")).status).toBe("resolved");
  });
});

describe("resolve and reopen", () => {
  test("resolve writes the status and one server-authored status entry, without bumping the revision", async () => {
    clock = T0 + 10;
    const result = await setPinStatus(
      testDb.db,
      { ...ref, action: "resolve", actorRole: "founder" },
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      annotation: { id: "pin-1", status: "resolved", revision: 1, unreadReplies: 0 },
      entry: {
        id: "id-1",
        annotationId: "pin-1",
        actorRole: "founder",
        authorLabel: "founder",
        kind: "status",
        body: "Resolved by founder",
        createdAt: T0 + 10,
      },
    });
    expect(await statusOf("pin-1")).toEqual({ status: "resolved", revision: 1 });
    const listed = await listThreadEntries(testDb.db, ref);
    expect(listed.ok && listed.entries.map((entry) => [entry.kind, entry.body])).toEqual([
      ["status", "Resolved by founder"],
    ]);
    expect(statusEntryBody("reopen", "editor")).toBe("Reopened by editor");
  });

  test("resolving an already resolved pin changes nothing and writes no entry", async () => {
    await setPinStatus(testDb.db, { ...ref, action: "resolve", actorRole: "editor" }, deps);
    const again = await setPinStatus(
      testDb.db,
      { ...ref, action: "resolve", actorRole: "founder" },
      deps,
    );
    expect(again).toMatchObject({ ok: true, changed: false, entry: null });
    expect(again.ok && again.annotation.status).toBe("resolved");
    const listed = await listThreadEntries(testDb.db, ref);
    expect(listed.ok && listed.entries).toHaveLength(1);
  });

  test("reopen returns to open when the founder never replied, and to replied when they did", async () => {
    await setPinStatus(testDb.db, { ...ref, action: "resolve", actorRole: "editor" }, deps);
    clock = T0 + 1;
    const reopened = await setPinStatus(
      testDb.db,
      { ...ref, action: "reopen", actorRole: "editor" },
      deps,
    );
    expect(reopened).toMatchObject({
      ok: true,
      changed: true,
      annotation: { status: "open" },
      entry: { kind: "status", body: "Reopened by editor", authorLabel: "Lucas" },
    });

    clock = T0 + 2;
    await appendThreadEntry(testDb.db, reply("founder", "Fixed."), deps);
    clock = T0 + 3;
    await setPinStatus(testDb.db, { ...ref, action: "resolve", actorRole: "founder" }, deps);
    clock = T0 + 4;
    const reopenedAgain = await setPinStatus(
      testDb.db,
      { ...ref, action: "reopen", actorRole: "editor" },
      deps,
    );
    expect(reopenedAgain.ok && reopenedAgain.annotation.status).toBe("replied");

    // Reopening a pin that is not resolved changes nothing.
    const noop = await setPinStatus(testDb.db, { ...ref, action: "reopen", actorRole: "founder" }, deps);
    expect(noop).toMatchObject({ ok: true, changed: false, entry: null });

    // The thread is the record: messages and status lines in one order.
    const listed = await listThreadEntries(testDb.db, ref);
    expect(listed.ok && listed.entries.map((entry) => `${entry.kind}:${entry.body}`)).toEqual([
      "status:Resolved by editor",
      "status:Reopened by editor",
      "message:Fixed.",
      "status:Resolved by founder",
      "status:Reopened by editor",
    ]);
  });

  test("the returned record carries the caller's unread count", async () => {
    await appendThreadEntry(testDb.db, reply("founder", "One."), deps);
    clock = T0 + 1;
    const asEditor = await setPinStatus(
      testDb.db,
      { ...ref, action: "resolve", actorRole: "editor" },
      deps,
    );
    expect(asEditor.ok && asEditor.annotation.unreadReplies).toBe(1);
    clock = T0 + 2;
    const asFounder = await setPinStatus(
      testDb.db,
      { ...ref, action: "reopen", actorRole: "founder", viewer: founderViewer(1) },
      deps,
    );
    expect(asFounder.ok && asFounder.annotation.unreadReplies).toBe(0);
  });

  test("tombstoned, foreign-capture, non-ready, and missing pins are all not-found", async () => {
    for (const target of [
      { captureId: "cap-a", annotationId: "pin-gone" },
      { captureId: "cap-b", annotationId: "pin-1" },
      { captureId: "cap-pending", annotationId: "pin-pending" },
      { captureId: "cap-a", annotationId: "pin-none" },
    ]) {
      const result = await setPinStatus(
        testDb.db,
        { ...target, action: "resolve", actorRole: "editor", viewer: EDITOR_VIEWER },
        deps,
      );
      expect(result, JSON.stringify(target)).toEqual({ ok: false, error: "not-found" });
    }
    const rows = await testDb.db.select().from(schema.threadEntries);
    expect(rows).toHaveLength(0);
  });

  test("the pin list reports the status", async () => {
    await setPinStatus(testDb.db, { ...ref, action: "resolve", actorRole: "editor" }, deps);
    const listed = await listPins(testDb.db, "cap-a");
    expect(listed.ok && listed.annotations.map((pin) => [pin.number, pin.status])).toEqual([
      [1, "resolved"],
      [2, "open"],
    ]);
  });
});
