// Server-only pin annotation store (VAL-PIN-001, VAL-CANVAS-001,
// VAL-CANVAS-003, VAL-CANVAS-004).
//
// The pin is the canonical domain record: its tip is stored as exact
// screenshot-natural CSS pixels in geometry_json, bound to one immutable
// ready capture. Numbers are server-determined and monotonically increasing
// per capture: the next number is derived from every row the capture has —
// including tombstoned ones — inside the same transaction as the insert, so
// deleted numbers are never reused and cancelled or failed drafts consume
// none. The unique (capture_id, number) index is the backstop that makes
// concurrent saves collision-safe; a collision retries the whole transaction
// a bounded number of times rather than ever reusing a number.
//
// Idempotency is durable and intent-bound, same shape as project creation:
// the same key with the same normalized payload replays the original pin,
// and the same key with a different payload conflicts.

import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, eq, isNull, max } from "drizzle-orm";
import { FEEDBACK_BODY_MAX_CHARS, MAX_ANNOTATIONS_PER_CAPTURE } from "../../boundaries";
import { schema, type Database } from "../db/client";

/** Idempotency scope for editor pin creation. */
export const ANNOTATION_CREATE_SCOPE = "annotation-create";

/** Geometry schema version persisted with every pin. */
const PIN_GEOMETRY_VERSION = 1;

/** Bounded retries when two concurrent inserts race for the same number. */
const MAX_NUMBER_COLLISION_RETRIES = 3;

/** A pin tip in screenshot-natural CSS pixels. */
export interface PinTip {
  x: number;
  y: number;
}

/** The canonical domain view of one persisted pin. */
export interface AnnotationRecord {
  id: string;
  captureId: string;
  kind: "pin";
  number: number;
  tip: PinTip;
  body: string;
  /** Inert capture-time DOM context; null until the metadata flow lands. */
  elementSnapshot: unknown | null;
  revision: number;
  createdAt: number;
}

export type ListPinsResult =
  | { ok: true; annotations: AnnotationRecord[] }
  | { ok: false; error: "not-found" };

export interface CreatePinInput {
  captureId: string;
  tip: PinTip;
  body: string;
  idempotencyKey: string;
}

export type CreatePinResult =
  | { ok: true; created: boolean; annotation: AnnotationRecord }
  | { ok: false; error: "not-found" | "invalid" | "conflict" | "quota" };

export interface MovePinInput {
  captureId: string;
  annotationId: string;
  tip: PinTip;
}

export type MovePinResult =
  | { ok: true; annotation: AnnotationRecord }
  | { ok: false; error: "not-found" | "invalid" };

export interface PinStoreDeps {
  now: () => number;
  newId: () => string;
}

export const defaultPinStoreDeps: PinStoreDeps = {
  now: () => Date.now(),
  newId: () => randomUUID(),
};

type CaptureRow = typeof schema.captures.$inferSelect;
type AnnotationRow = typeof schema.annotations.$inferSelect;

/** Only an immutable ready capture with persisted dimensions is annotatable. */
function annotatable(capture: CaptureRow | undefined): capture is CaptureRow {
  return (
    capture !== undefined &&
    capture.status === "ready" &&
    capture.documentWidth !== null &&
    capture.documentHeight !== null
  );
}

function toRecord(row: AnnotationRow): AnnotationRecord {
  const tip = JSON.parse(row.geometryJson) as PinTip;
  return {
    id: row.id,
    captureId: row.captureId,
    kind: "pin",
    number: row.number,
    tip,
    body: row.originalBody,
    elementSnapshot: row.elementSnapshotJson ? JSON.parse(row.elementSnapshotJson) : null,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

async function loadCapture(db: Database, captureId: string): Promise<CaptureRow | undefined> {
  const rows = await db
    .select()
    .from(schema.captures)
    .where(eq(schema.captures.id, captureId))
    .limit(1);
  return rows[0];
}

/** True when the tip is finite and inside the inclusive capture bounds. */
function tipWithinCapture(tip: PinTip, capture: CaptureRow): boolean {
  return (
    Number.isFinite(tip.x) &&
    Number.isFinite(tip.y) &&
    tip.x >= 0 &&
    tip.y >= 0 &&
    tip.x <= (capture.documentWidth ?? -1) &&
    tip.y <= (capture.documentHeight ?? -1)
  );
}

/** List the live pins of one ready capture, ordered by their stable numbers. */
export async function listPins(db: Database, captureId: string): Promise<ListPinsResult> {
  const capture = await loadCapture(db, captureId);
  if (!annotatable(capture)) return { ok: false, error: "not-found" };
  const rows = await db
    .select()
    .from(schema.annotations)
    .where(
      and(
        eq(schema.annotations.captureId, captureId),
        eq(schema.annotations.kind, "pin"),
        isNull(schema.annotations.deletedAt),
      ),
    )
    .orderBy(asc(schema.annotations.number));
  return { ok: true, annotations: rows.map(toRecord) };
}

/** Binds an idempotency key to the whole normalized create intent. */
function createDigest(input: CreatePinInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        captureId: input.captureId,
        tip: { x: input.tip.x, y: input.tip.y },
        body: input.body,
      }),
    )
    .digest("hex");
}

async function findIdempotencyRecord(db: Database, key: string) {
  const rows = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.scope, ANNOTATION_CREATE_SCOPE),
        eq(schema.idempotencyKeys.key, key),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function replay(
  record: { payloadDigest: string; resultJson: string | null },
  digest: string,
): CreatePinResult {
  // Same key, different intent is a conflict: the caller must choose a new
  // key rather than silently getting a different pin back.
  if (record.payloadDigest !== digest || record.resultJson === null) {
    return { ok: false, error: "conflict" };
  }
  return {
    ok: true,
    created: false,
    annotation: JSON.parse(record.resultJson) as AnnotationRecord,
  };
}

/** A number collision is the unique (capture_id, number) index firing. */
function isNumberCollision(error: unknown): boolean {
  // Drizzle wraps the driver error ("Failed query: …"); the SQLite message
  // with the constrained columns lives on the cause chain.
  let current: unknown = error;
  while (current) {
    if (
      current instanceof Error &&
      /unique constraint failed/i.test(current.message) &&
      /annotations\.(capture_id|number)/i.test(current.message)
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Persist one pin atomically: idempotency record, monotonic number, and the
 * annotation row in one transaction — or nothing at all. A blank or
 * over-limit body, out-of-bounds tip, non-ready capture, or exhausted quota
 * writes nothing and consumes no number.
 */
export async function createPinAtomically(
  db: Database,
  input: CreatePinInput,
  deps: PinStoreDeps = defaultPinStoreDeps,
): Promise<CreatePinResult> {
  const digest = createDigest(input);
  const existing = await findIdempotencyRecord(db, input.idempotencyKey);
  if (existing) return replay(existing, digest);

  const capture = await loadCapture(db, input.captureId);
  if (!annotatable(capture)) return { ok: false, error: "not-found" };
  if (!tipWithinCapture(input.tip, capture)) return { ok: false, error: "invalid" };
  const body = input.body;
  if (body.trim().length === 0 || body.length > FEEDBACK_BODY_MAX_CHARS) {
    return { ok: false, error: "invalid" };
  }

  const [{ liveCount }] = await db
    .select({ liveCount: count() })
    .from(schema.annotations)
    .where(
      and(
        eq(schema.annotations.captureId, input.captureId),
        isNull(schema.annotations.deletedAt),
      ),
    );
  if ((liveCount ?? 0) >= MAX_ANNOTATIONS_PER_CAPTURE) return { ok: false, error: "quota" };

  const now = deps.now();
  const id = deps.newId();

  for (let attempt = 0; attempt < MAX_NUMBER_COLLISION_RETRIES; attempt += 1) {
    const annotation: AnnotationRecord = {
      id,
      captureId: input.captureId,
      kind: "pin",
      // Filled in inside the transaction before the insert lands.
      number: 0,
      tip: { x: input.tip.x, y: input.tip.y },
      body,
      elementSnapshot: null,
      revision: 1,
      createdAt: now,
    };
    try {
      await db.transaction(async (tx) => {
        // The idempotency row goes first: its primary key is what makes two
        // concurrent same-key requests resolve to one committed pin.
        await tx.insert(schema.idempotencyKeys).values({
          scope: ANNOTATION_CREATE_SCOPE,
          key: input.idempotencyKey,
          payloadDigest: digest,
          resultJson: null,
          createdAt: now,
        });
        // Monotonic per capture and never reused: tombstoned rows still
        // count, so a deleted number stays retired.
        const [{ highest }] = await tx
          .select({ highest: max(schema.annotations.number) })
          .from(schema.annotations)
          .where(eq(schema.annotations.captureId, input.captureId));
        annotation.number = (highest ?? 0) + 1;
        await tx.insert(schema.annotations).values({
          id: annotation.id,
          captureId: annotation.captureId,
          kind: "pin",
          number: annotation.number,
          geometryJson: JSON.stringify(annotation.tip),
          geometryVersion: PIN_GEOMETRY_VERSION,
          originalBody: annotation.body,
          elementSnapshotJson: null,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
        // The replay result is recorded in the same transaction, so a
        // retried request always returns exactly what committed.
        await tx
          .update(schema.idempotencyKeys)
          .set({ resultJson: JSON.stringify(annotation) })
          .where(
            and(
              eq(schema.idempotencyKeys.scope, ANNOTATION_CREATE_SCOPE),
              eq(schema.idempotencyKeys.key, input.idempotencyKey),
            ),
          );
      });
      return { ok: true, created: true, annotation };
    } catch (error) {
      // Two concurrent different-key creates can read the same next number;
      // the unique index rejects one, which retries with a fresh read.
      if (isNumberCollision(error) && attempt + 1 < MAX_NUMBER_COLLISION_RETRIES) {
        continue;
      }
      // A concurrent request may have committed this key first; converge on
      // that single result instead of reporting a spurious failure.
      const winner = await findIdempotencyRecord(db, input.idempotencyKey);
      if (winner) return replay(winner, digest);
      throw error;
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new Error("pin create retries exhausted");
}

/**
 * Commit one revisioned tip update for an existing pin. The write is bound
 * to the pin's own capture — a pin addressed through another capture's route
 * is simply not found, never rebound — and out-of-bounds or non-finite tips
 * are rejected without touching the row.
 */
export async function movePin(
  db: Database,
  input: MovePinInput,
  deps: PinStoreDeps = defaultPinStoreDeps,
): Promise<MovePinResult> {
  const rows = await db
    .select()
    .from(schema.annotations)
    .where(
      and(
        eq(schema.annotations.id, input.annotationId),
        eq(schema.annotations.kind, "pin"),
        isNull(schema.annotations.deletedAt),
      ),
    )
    .limit(1);
  const pin = rows[0];
  if (!pin || pin.captureId !== input.captureId) return { ok: false, error: "not-found" };
  const capture = await loadCapture(db, pin.captureId);
  if (!annotatable(capture)) return { ok: false, error: "not-found" };
  if (!tipWithinCapture(input.tip, capture)) return { ok: false, error: "invalid" };

  const now = deps.now();
  await db
    .update(schema.annotations)
    .set({
      geometryJson: JSON.stringify({ x: input.tip.x, y: input.tip.y }),
      revision: pin.revision + 1,
      updatedAt: now,
    })
    .where(eq(schema.annotations.id, pin.id));

  return {
    ok: true,
    annotation: {
      ...toRecord(pin),
      tip: { x: input.tip.x, y: input.tip.y },
      revision: pin.revision + 1,
    },
  };
}
