// Per-role last-seen marks and the counts derived from them (D075): a reply
// is unread for a role when the other role wrote it after that role's last
// view of the pin; status entries never count; a founder's view is keyed by
// capability version; and the per-capture counts the hierarchy carries come
// from one grouped query over live pins only.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { listPins } from "../../src/lib/server/annotations/pins";
import {
  EDITOR_VIEWER,
  feedbackCountsByCapture,
  founderViewer,
  markPinSeen,
  sumFeedbackCounts,
  unreadRepliesByPin,
} from "../../src/lib/server/annotations/seen";
import { setPinStatus } from "../../src/lib/server/annotations/status";
import { schema } from "../../src/lib/server/db/client";
import { appendThreadEntry } from "../../src/lib/server/threads/entries";
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

let keys = 0;
async function say(annotationId: string, actorRole: "editor" | "founder", at: number, captureId = "cap-a") {
  clock = at;
  const result = await appendThreadEntry(
    testDb.db,
    { captureId, annotationId, actorRole, body: `${actorRole} at ${at}`, idempotencyKey: `k-${(keys += 1)}` },
    deps,
  );
  if (!result.ok) throw new Error(`fixture append failed: ${result.error}`);
}

const pin1 = { captureId: "cap-a", annotationId: "pin-1" };

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
  await seedCapture("cap-empty", "page-a");
  await seedCapture("cap-pending", "page-a", "pending");
  await seedPin("pin-1", "cap-a", 1);
  await seedPin("pin-2", "cap-a", 2);
  await seedPin("pin-gone", "cap-a", 3, T0 + 5);
  await seedPin("pin-b", "cap-b", 1);
  await seedPin("pin-pending", "cap-pending", 1);
});

afterEach(() => {
  testDb.client.close();
});

describe("unread replies", () => {
  test("count the other role's messages after the viewer's last view, per pin", async () => {
    await say("pin-1", "founder", T0 + 1);
    await say("pin-1", "founder", T0 + 2);
    await say("pin-2", "founder", T0 + 3);
    await say("pin-1", "editor", T0 + 4);

    const editor = await unreadRepliesByPin(testDb.db, "cap-a", EDITOR_VIEWER);
    expect([...editor.entries()]).toEqual([
      ["pin-1", 2],
      ["pin-2", 1],
    ]);
    const founder = await unreadRepliesByPin(testDb.db, "cap-a", founderViewer(1));
    expect([...founder.entries()]).toEqual([["pin-1", 1]]);

    // The editor reads pin-1: only pin-1 clears, only for the editor.
    expect(await markPinSeen(testDb.db, pin1, EDITOR_VIEWER, T0 + 5)).toEqual({ ok: true });
    expect([...(await unreadRepliesByPin(testDb.db, "cap-a", EDITOR_VIEWER)).entries()]).toEqual([
      ["pin-2", 1],
    ]);
    expect([...(await unreadRepliesByPin(testDb.db, "cap-a", founderViewer(1))).entries()]).toEqual([
      ["pin-1", 1],
    ]);

    // A later founder reply is new again.
    await say("pin-1", "founder", T0 + 6);
    expect((await unreadRepliesByPin(testDb.db, "cap-a", EDITOR_VIEWER)).get("pin-1")).toBe(1);
  });

  test("status entries never count, and tombstoned pins are ignored", async () => {
    clock = T0 + 1;
    await setPinStatus(
      testDb.db,
      { ...pin1, action: "resolve", actorRole: "founder", viewer: founderViewer(1) },
      deps,
    );
    expect((await unreadRepliesByPin(testDb.db, "cap-a", EDITOR_VIEWER)).size).toBe(0);
    // A message on a tombstoned pin (seeded directly: the store refuses it).
    await testDb.db.insert(schema.threadEntries).values({
      id: "ghost",
      annotationId: "pin-gone",
      actorRole: "founder",
      authorLabel: "founder",
      body: "ghost",
      idempotencyKey: "ghost",
      createdAt: T0 + 2,
    });
    expect((await unreadRepliesByPin(testDb.db, "cap-a", EDITOR_VIEWER)).size).toBe(0);
  });

  test("a founder view is keyed by capability version, so a rotated link starts fresh", async () => {
    await say("pin-1", "editor", T0 + 1);
    await markPinSeen(testDb.db, pin1, founderViewer(1), T0 + 2);
    expect((await unreadRepliesByPin(testDb.db, "cap-a", founderViewer(1))).size).toBe(0);
    expect((await unreadRepliesByPin(testDb.db, "cap-a", founderViewer(2))).get("pin-1")).toBe(1);
    const views = await testDb.db.select().from(schema.annotationViews);
    expect(views).toEqual([
      { annotationId: "pin-1", role: "founder", viewerKey: "founder:v1", seenAt: T0 + 2 },
    ]);
  });

  test("a view never moves backwards, and unknown pins are not-found", async () => {
    await markPinSeen(testDb.db, pin1, EDITOR_VIEWER, T0 + 10);
    await markPinSeen(testDb.db, pin1, EDITOR_VIEWER, T0 + 3);
    const [view] = await testDb.db.select().from(schema.annotationViews);
    expect(view?.seenAt).toBe(T0 + 10);
    for (const target of [
      { captureId: "cap-a", annotationId: "pin-gone" },
      { captureId: "cap-b", annotationId: "pin-1" },
      { captureId: "cap-pending", annotationId: "pin-pending" },
      { captureId: "cap-a", annotationId: "nope" },
    ]) {
      expect(await markPinSeen(testDb.db, target, EDITOR_VIEWER, T0)).toEqual({
        ok: false,
        error: "not-found",
      });
    }
    expect(await testDb.db.select().from(schema.annotationViews)).toHaveLength(1);
  });

  test("the pin list carries each pin's unread count for the viewer", async () => {
    await say("pin-1", "founder", T0 + 1);
    await say("pin-2", "editor", T0 + 2);
    const forEditor = await listPins(testDb.db, "cap-a", EDITOR_VIEWER);
    expect(forEditor.ok && forEditor.annotations.map((pin) => pin.unreadReplies)).toEqual([1, 0]);
    const forFounder = await listPins(testDb.db, "cap-a", founderViewer(1));
    expect(forFounder.ok && forFounder.annotations.map((pin) => pin.unreadReplies)).toEqual([0, 1]);
    // The default viewer is the editor.
    const byDefault = await listPins(testDb.db, "cap-a");
    expect(byDefault.ok && byDefault.annotations.map((pin) => pin.unreadReplies)).toEqual([1, 0]);
  });
});

describe("feedback counts by capture", () => {
  test("group live pins by capture with open, resolved, and the viewer's unread", async () => {
    await say("pin-1", "founder", T0 + 1);
    await say("pin-1", "founder", T0 + 2);
    await say("pin-b", "editor", T0 + 3, "cap-b");
    clock = T0 + 4;
    await setPinStatus(
      testDb.db,
      { captureId: "cap-a", annotationId: "pin-2", action: "resolve", actorRole: "editor", viewer: EDITOR_VIEWER },
      deps,
    );

    const ids = ["cap-a", "cap-b", "cap-empty", "cap-pending", "cap-none"];
    const editor = await feedbackCountsByCapture(testDb.db, ids, EDITOR_VIEWER);
    expect(Object.fromEntries(editor)).toEqual({
      "cap-a": { pins: 2, open: 1, resolved: 1, unreadReplies: 2 },
      "cap-b": { pins: 1, open: 1, resolved: 0, unreadReplies: 0 },
      "cap-pending": { pins: 1, open: 1, resolved: 0, unreadReplies: 0 },
    });
    const founder = await feedbackCountsByCapture(testDb.db, ids, founderViewer(1));
    expect(founder.get("cap-a")!.unreadReplies).toBe(0);
    expect(founder.get("cap-b")!.unreadReplies).toBe(1);

    await markPinSeen(testDb.db, pin1, EDITOR_VIEWER, T0 + 5);
    expect((await feedbackCountsByCapture(testDb.db, ["cap-a"], EDITOR_VIEWER)).get("cap-a")).toEqual({
      pins: 2,
      open: 1,
      resolved: 1,
      unreadReplies: 0,
    });
    expect(await feedbackCountsByCapture(testDb.db, [], EDITOR_VIEWER)).toEqual(new Map());
    expect(sumFeedbackCounts(editor.values())).toEqual({
      pins: 4,
      open: 3,
      resolved: 1,
      unreadReplies: 2,
    });
  });
});
