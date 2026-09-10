// Unit tests for the server pin store (VAL-PIN-001, VAL-CANVAS-001,
// VAL-CANVAS-003): monotonic per-capture numbering, tombstoned numbers never
// reused, cancelled/failed drafts consuming no number, durable idempotent
// create, capture-bound listing, inclusive bounds validation, and the single
// revisioned move write. Real Turso proof lives in the browser/e2e surface
// and the integration suites; these run against the committed migrations in
// an in-memory libSQL database.

import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  FEEDBACK_BODY_MAX_CHARS,
  MAX_ANNOTATIONS_PER_CAPTURE,
} from "../../src/lib/boundaries";
import {
  createPinAtomically,
  listPins,
  movePin,
} from "../../src/lib/server/annotations/pins";
import { schema } from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

const T0 = 1_800_000_000_000;

let testDb: TestDb;
let readyCaptureId: string;
let otherCaptureId: string;

async function seedCapture(id: string, status: string, pageId: string, attempt = 1) {
  await testDb.db.insert(schema.captures).values({
    id,
    pageId,
    variant: "desktop",
    attempt,
    status,
    idempotencyKey: `initial:${id}`,
    requestedUrl: "https://chickpea.co/",
    viewportWidth: 1440,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    documentWidth: status === "ready" ? 1440 : null,
    documentHeight: status === "ready" ? 8966 : null,
    imageHash: status === "ready" ? `hash-${id}` : null,
    createdAt: T0,
    updatedAt: T0,
  });
}

async function rowsFor(captureId: string) {
  return testDb.db
    .select()
    .from(schema.annotations)
    .where(eq(schema.annotations.captureId, captureId))
    .orderBy(asc(schema.annotations.number));
}

const createInput = (overrides: Record<string, unknown> = {}) => ({
  captureId: "cap-ready",
  tip: { x: 812.25, y: 4231.5 },
  body: "The pricing table header wraps awkwardly here.",
  idempotencyKey: "pin-create-key-0001",
  ...overrides,
});

beforeEach(async () => {
  testDb = await createTestDb();
  await testDb.db.insert(schema.projects).values({
    id: "proj-1",
    publicId: "pub-1",
    title: "Chickpea",
    rootUrl: "https://chickpea.co/",
    shareTokenVersion: 0,
    createdAt: T0,
    updatedAt: T0,
  });
  await testDb.db.insert(schema.pages).values([
    {
      id: "page-1",
      projectId: "proj-1",
      requestedUrl: "https://chickpea.co/",
      normalizedUrl: "https://chickpea.co/",
      sortIndex: 0,
      createdAt: T0,
    },
    {
      id: "page-2",
      projectId: "proj-1",
      requestedUrl: "https://chickpea.co/pricing",
      normalizedUrl: "https://chickpea.co/pricing",
      sortIndex: 1,
      createdAt: T0,
    },
  ]);
  await seedCapture("cap-ready", "ready", "page-1");
  await seedCapture("cap-other", "ready", "page-2");
  await seedCapture("cap-pending", "pending", "page-1", 2);
  await seedCapture("cap-failed", "failed", "page-1", 3);
  readyCaptureId = "cap-ready";
  otherCaptureId = "cap-other";
});

afterEach(() => {
  testDb.client.close();
});

describe("createPinAtomically numbering", () => {
  test("the first pin on a capture is number 1 and numbers increase monotonically", async () => {
    const first = await createPinAtomically(testDb.db, createInput());
    expect(first).toMatchObject({ ok: true, created: true });
    if (first.ok) expect(first.annotation.number).toBe(1);

    const second = await createPinAtomically(
      testDb.db,
      createInput({ idempotencyKey: "pin-create-key-0002", tip: { x: 10, y: 10 } }),
    );
    expect(second).toMatchObject({ ok: true, created: true });
    if (second.ok) expect(second.annotation.number).toBe(2);
  });

  test("numbering is per capture: another plane starts at its own 1", async () => {
    await createPinAtomically(testDb.db, createInput());
    const other = await createPinAtomically(
      testDb.db,
      createInput({ captureId: otherCaptureId, idempotencyKey: "pin-create-key-0003" }),
    );
    expect(other).toMatchObject({ ok: true, created: true });
    if (other.ok) {
      expect(other.annotation.number).toBe(1);
      expect(other.annotation.captureId).toBe(otherCaptureId);
    }
  });

  test("a tombstoned (deleted) pin's number is never reused", async () => {
    const first = await createPinAtomically(testDb.db, createInput());
    if (!first.ok) throw new Error("seed create failed");
    // Deletion is a tombstone: the row remains, so the monotonic counter
    // still sees it.
    await testDb.db
      .update(schema.annotations)
      .set({ deletedAt: T0 + 10 })
      .where(eq(schema.annotations.id, first.annotation.id));

    const next = await createPinAtomically(
      testDb.db,
      createInput({ idempotencyKey: "pin-create-key-0004" }),
    );
    expect(next).toMatchObject({ ok: true, created: true });
    if (next.ok) expect(next.annotation.number).toBe(2);
  });

  test("a failed create consumes no number: the next valid create takes it", async () => {
    const failed = await createPinAtomically(
      testDb.db,
      createInput({ tip: { x: -5, y: 10 } }),
    );
    expect(failed).toMatchObject({ ok: false, error: "invalid" });
    expect(await rowsFor(readyCaptureId)).toHaveLength(0);

    const next = await createPinAtomically(
      testDb.db,
      createInput({ idempotencyKey: "pin-create-key-0005" }),
    );
    expect(next).toMatchObject({ ok: true, created: true });
    if (next.ok) expect(next.annotation.number).toBe(1);
  });

  test("concurrent distinct-key creates can never share a number (unique index backstop)", async () => {
    const first = await createPinAtomically(testDb.db, createInput());
    if (!first.ok) throw new Error("seed create failed");
    // A raw duplicate (captureId, number) is rejected by the database itself.
    // Drizzle wraps the driver error; the SQLite constraint message lives on
    // the cause chain.
    const error = await testDb.db
      .insert(schema.annotations)
      .values({
        id: "ann-dup",
        captureId: readyCaptureId,
        kind: "pin",
        number: first.annotation.number,
        geometryJson: JSON.stringify({ x: 1, y: 1 }),
        geometryVersion: 1,
        originalBody: "duplicate number",
        revision: 1,
        createdAt: T0,
        updatedAt: T0,
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(String((error as { cause?: unknown })?.cause ?? error)).toMatch(
      /unique constraint failed: annotations\.capture_id, annotations\.number/i,
    );
  });
});

describe("createPinAtomically idempotency", () => {
  test("the same key and payload replays the original pin without a second row", async () => {
    const first = await createPinAtomically(testDb.db, createInput());
    const replayed = await createPinAtomically(testDb.db, createInput());
    expect(replayed).toMatchObject({ ok: true, created: false });
    if (first.ok && replayed.ok) {
      expect(replayed.annotation.id).toBe(first.annotation.id);
      expect(replayed.annotation.number).toBe(first.annotation.number);
    }
    expect(await rowsFor(readyCaptureId)).toHaveLength(1);
  });

  test("the same key with a different payload conflicts and writes nothing", async () => {
    await createPinAtomically(testDb.db, createInput());
    const conflict = await createPinAtomically(
      testDb.db,
      createInput({ tip: { x: 1, y: 1 } }),
    );
    expect(conflict).toMatchObject({ ok: false, error: "conflict" });
    expect(await rowsFor(readyCaptureId)).toHaveLength(1);
  });
});

describe("createPinAtomically validation", () => {
  test("pins bind to an immutable ready capture: missing, pending, and failed are not annotatable", async () => {
    for (const [index, captureId] of ["cap-missing", "cap-pending", "cap-failed"].entries()) {
      const result = await createPinAtomically(
        testDb.db,
        createInput({ captureId, idempotencyKey: `pin-create-missing-${index}` }),
      );
      expect(result).toMatchObject({ ok: false, error: "not-found" });
    }
    expect(await rowsFor("cap-pending")).toHaveLength(0);
  });

  test("tips must be finite and inside the inclusive capture bounds", async () => {
    const doc = { width: 1440, height: 8966 };
    const invalidTips = [
      { x: Number.NaN, y: 10 },
      { x: Number.POSITIVE_INFINITY, y: 10 },
      { x: -0.001, y: 10 },
      { x: 10, y: -1 },
      { x: doc.width + 1, y: 10 },
      { x: 10, y: doc.height + 0.5 },
    ];
    for (const [index, tip] of invalidTips.entries()) {
      const result = await createPinAtomically(
        testDb.db,
        createInput({ tip, idempotencyKey: `pin-create-invalid-${index}` }),
      );
      expect(result, JSON.stringify(tip)).toMatchObject({ ok: false, error: "invalid" });
    }
    expect(await rowsFor(readyCaptureId)).toHaveLength(0);

    // The edges themselves are inclusive and persist exactly.
    for (const [index, tip] of [
      { x: 0, y: 0 },
      { x: doc.width, y: doc.height },
    ].entries()) {
      const result = await createPinAtomically(
        testDb.db,
        createInput({ tip, idempotencyKey: `pin-create-edge-${index}` }),
      );
      expect(result).toMatchObject({ ok: true, created: true });
      if (result.ok) expect(result.annotation.tip).toEqual(tip);
    }
  });

  test("fractional natural-pixel tips persist byte-identically", async () => {
    const tip = { x: 812.25, y: 4231.5 };
    const result = await createPinAtomically(testDb.db, createInput({ tip }));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const [row] = await rowsFor(readyCaptureId);
    expect(row!.geometryJson).toBe(JSON.stringify(tip));
    expect(result.annotation.tip).toEqual(tip);
  });

  test("blank and over-limit bodies are rejected before any write", async () => {
    const blank = await createPinAtomically(testDb.db, createInput({ body: "   \n  " }));
    expect(blank).toMatchObject({ ok: false, error: "invalid" });
    const tooLong = await createPinAtomically(
      testDb.db,
      createInput({ body: "x".repeat(FEEDBACK_BODY_MAX_CHARS + 1) }),
    );
    expect(tooLong).toMatchObject({ ok: false, error: "invalid" });
    expect(await rowsFor(readyCaptureId)).toHaveLength(0);
  });

  test("the per-capture annotation quota rejects the pin beyond the cap", async () => {
    await testDb.db.insert(schema.annotations).values(
      Array.from({ length: MAX_ANNOTATIONS_PER_CAPTURE }, (_, index) => ({
        id: `ann-seed-${index}`,
        captureId: readyCaptureId,
        kind: "pin" as const,
        number: index + 1,
        geometryJson: JSON.stringify({ x: 1, y: 1 }),
        geometryVersion: 1,
        originalBody: `seed ${index}`,
        revision: 1,
        createdAt: T0,
        updatedAt: T0,
      })),
    );
    const result = await createPinAtomically(testDb.db, createInput());
    expect(result).toMatchObject({ ok: false, error: "quota" });
  });
});

describe("listPins", () => {
  test("returns only the live pins of the one requested capture, ordered by number", async () => {
    await createPinAtomically(testDb.db, createInput());
    await createPinAtomically(
      testDb.db,
      createInput({ idempotencyKey: "pin-create-key-0006", tip: { x: 5, y: 5 } }),
    );
    await createPinAtomically(
      testDb.db,
      createInput({ captureId: otherCaptureId, idempotencyKey: "pin-create-key-0007" }),
    );
    const listed = await listPins(testDb.db, readyCaptureId);
    expect(listed).toMatchObject({ ok: true });
    if (!listed.ok) return;
    expect(listed.annotations.map((pin) => pin.number)).toEqual([1, 2]);
    expect(listed.annotations.every((pin) => pin.captureId === readyCaptureId)).toBe(true);
  });

  test("tombstoned pins are absent but keep consuming their number", async () => {
    const first = await createPinAtomically(testDb.db, createInput());
    if (!first.ok) throw new Error("seed create failed");
    await testDb.db
      .update(schema.annotations)
      .set({ deletedAt: T0 + 10 })
      .where(eq(schema.annotations.id, first.annotation.id));
    const listed = await listPins(testDb.db, readyCaptureId);
    expect(listed).toMatchObject({ ok: true, annotations: [] });
  });

  test("missing or non-ready captures are not annotatable", async () => {
    for (const captureId of ["cap-missing", "cap-pending", "cap-failed"]) {
      expect(await listPins(testDb.db, captureId)).toMatchObject({
        ok: false,
        error: "not-found",
      });
    }
  });
});

describe("movePin", () => {
  async function seedPin() {
    const created = await createPinAtomically(testDb.db, createInput());
    if (!created.ok) throw new Error("seed create failed");
    return created.annotation;
  }

  test("commits one revisioned tip update and preserves identity, number, and body", async () => {
    const pin = await seedPin();
    const moved = await movePin(testDb.db, {
      captureId: readyCaptureId,
      annotationId: pin.id,
      tip: { x: 1440, y: 8966 },
    });
    expect(moved).toMatchObject({ ok: true });
    if (!moved.ok) return;
    expect(moved.annotation.id).toBe(pin.id);
    expect(moved.annotation.number).toBe(pin.number);
    expect(moved.annotation.body).toBe(pin.body);
    expect(moved.annotation.tip).toEqual({ x: 1440, y: 8966 });
    expect(moved.annotation.revision).toBe(pin.revision + 1);

    const [row] = await rowsFor(readyCaptureId);
    expect(row!.revision).toBe(2);
    expect(row!.geometryJson).toBe(JSON.stringify({ x: 1440, y: 8966 }));
  });

  test("never rebinds: a pin addressed through another capture is not found", async () => {
    const pin = await seedPin();
    const moved = await movePin(testDb.db, {
      captureId: otherCaptureId,
      annotationId: pin.id,
      tip: { x: 1, y: 1 },
    });
    expect(moved).toMatchObject({ ok: false, error: "not-found" });
    const [row] = await rowsFor(readyCaptureId);
    expect(row!.geometryJson).toBe(JSON.stringify({ x: 812.25, y: 4231.5 }));
    expect(row!.revision).toBe(1);
  });

  test("missing and tombstoned pins are not movable", async () => {
    const pin = await seedPin();
    expect(
      await movePin(testDb.db, {
        captureId: readyCaptureId,
        annotationId: "ann-missing",
        tip: { x: 1, y: 1 },
      }),
    ).toMatchObject({ ok: false, error: "not-found" });
    await testDb.db
      .update(schema.annotations)
      .set({ deletedAt: T0 + 10 })
      .where(eq(schema.annotations.id, pin.id));
    expect(
      await movePin(testDb.db, {
        captureId: readyCaptureId,
        annotationId: pin.id,
        tip: { x: 1, y: 1 },
      }),
    ).toMatchObject({ ok: false, error: "not-found" });
  });

  test("out-of-bounds and non-finite tips are rejected without a write", async () => {
    const pin = await seedPin();
    for (const tip of [
      { x: -1, y: 0 },
      { x: 0, y: 8967 },
      { x: Number.NaN, y: 0 },
    ]) {
      const moved = await movePin(testDb.db, {
        captureId: readyCaptureId,
        annotationId: pin.id,
        tip,
      });
      expect(moved, JSON.stringify(tip)).toMatchObject({ ok: false, error: "invalid" });
    }
    const [row] = await rowsFor(readyCaptureId);
    expect(row!.revision).toBe(1);
  });
});
