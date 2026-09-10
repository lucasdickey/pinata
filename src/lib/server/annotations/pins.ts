// Server-only pin annotation store (VAL-PIN-001, VAL-PIN-002, VAL-PIN-003,
// VAL-PIN-008, VAL-PIN-009, VAL-CANVAS-001, VAL-CANVAS-003, VAL-CANVAS-004).
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
// Every create carries an explicit context decision: the capture-local id of
// one manifest element, or null for "No element". The server derives the
// bounded inert snapshot from the capture's own persisted manifest — a
// client can name an element, never author one — and an id the manifest
// does not contain is an invalid save that persists nothing. The snapshot
// (or null) is then immutable for the life of the pin: moves, edits,
// recaptures, and reloads never re-query or rebind it.
//
// Updates (move, edit) and delete carry an expectedRevision precondition and
// commit as one conditional atomic write: a stale, concurrent, or repeated
// write loses with a conflict and changes no row, so one authoritative
// revision always remains. Delete is a tombstone: the row stays so its
// number is never reused, and its thread entries (future) are untouched.
//
// Idempotency is durable and intent-bound, same shape as project creation:
// the same key with the same normalized payload replays the original pin,
// and the same key with a different payload conflicts.

import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, eq, isNull, max } from "drizzle-orm";
import { FEEDBACK_BODY_MAX_CHARS, MAX_ANNOTATIONS_PER_CAPTURE } from "../../boundaries";
import { schema, type Database } from "../db/client";
import {
  deriveSnapshot,
  parseManifestElements,
  type ContextElement,
} from "./context";

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
  /** Inert capture-time DOM context snapshot, or the explicit null. */
  elementSnapshot: ContextElement | null;
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
  /** Explicit context decision: a manifest element id, or null = No element. */
  elementId: string | null;
  idempotencyKey: string;
}

export type CreatePinResult =
  | { ok: true; created: boolean; annotation: AnnotationRecord }
  | { ok: false; error: "not-found" | "invalid" | "conflict" | "quota" };

export interface UpdatePinInput {
  captureId: string;
  annotationId: string;
  /** The revision the caller based its write on; a mismatch is a conflict. */
  expectedRevision: number;
  /** A moved tip, a new original body, or both in one revisioned write. */
  tip?: PinTip;
  body?: string;
}

export type UpdatePinResult =
  | { ok: true; annotation: AnnotationRecord }
  | { ok: false; error: "not-found" | "invalid" | "conflict" };

export interface DeletePinInput {
  captureId: string;
  annotationId: string;
  expectedRevision: number;
}

export type DeletePinResult = { ok: true } | { ok: false; error: "not-found" | "conflict" };

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
    elementSnapshot: row.elementSnapshotJson
      ? (JSON.parse(row.elementSnapshotJson) as ContextElement)
      : null,
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

/**
 * The capture's own persisted manifest elements, re-validated on read (see
 * parseManifestElements). Null when the capture has no usable manifest.
 */
export function manifestElements(capture: CaptureRow): ContextElement[] | null {
  return parseManifestElements(capture.domManifestJson);
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

/** True when the original body is bounded directional plain text. */
function bodyValid(body: string): boolean {
  return body.trim().length > 0 && body.length <= FEEDBACK_BODY_MAX_CHARS;
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
        elementId: input.elementId,
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
 * over-limit body, out-of-bounds tip, non-ready capture, unknown context
 * element id, or exhausted quota writes nothing and consumes no number.
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
  if (!bodyValid(input.body)) return { ok: false, error: "invalid" };

  // The explicit context decision resolves against the capture's own
  // immutable manifest. "No element" (null) is always a valid decision; a
  // named element must exist in the manifest, and the persisted snapshot is
  // exactly that element — derived here, never supplied by the client.
  const elements = manifestElements(capture);
  const snapshot = deriveSnapshot(elements ?? [], input.elementId);
  if (input.elementId !== null && snapshot === null) {
    return { ok: false, error: "invalid" };
  }
  const snapshotJson = snapshot ? JSON.stringify(snapshot) : null;

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
      body: input.body,
      elementSnapshot: snapshot,
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
          elementSnapshotJson: snapshotJson,
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
 * Load the addressed live pin, honoring the capture binding: a pin addressed
 * through another capture's route is not found, never rebound.
 */
async function loadLivePin(
  db: Database,
  input: { captureId: string; annotationId: string },
): Promise<AnnotationRow | null> {
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
  if (!pin || pin.captureId !== input.captureId) return null;
  return pin;
}

/**
 * Commit one revisioned update — a moved tip, a new original body, or both —
 * as a single conditional atomic write gated on the caller's expected
 * revision. The write binds to the pin's own capture; out-of-bounds tips and
 * blank/over-limit bodies write nothing. Geometry updates preserve number,
 * body, snapshot, and capture binding; body updates preserve geometry and
 * snapshot. A stale or concurrent write loses with a conflict and changes
 * no row, leaving one authoritative revision.
 */
export async function updatePin(
  db: Database,
  input: UpdatePinInput,
  deps: PinStoreDeps = defaultPinStoreDeps,
): Promise<UpdatePinResult> {
  const pin = await loadLivePin(db, input);
  if (!pin) return { ok: false, error: "not-found" };
  const capture = await loadCapture(db, pin.captureId);
  if (!annotatable(capture)) return { ok: false, error: "not-found" };
  if (input.tip !== undefined && !tipWithinCapture(input.tip, capture)) {
    return { ok: false, error: "invalid" };
  }
  if (input.body !== undefined && !bodyValid(input.body)) {
    return { ok: false, error: "invalid" };
  }

  const now = deps.now();
  const updated = await db
    .update(schema.annotations)
    .set({
      ...(input.tip !== undefined
        ? { geometryJson: JSON.stringify({ x: input.tip.x, y: input.tip.y }) }
        : {}),
      ...(input.body !== undefined ? { originalBody: input.body } : {}),
      revision: input.expectedRevision + 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.annotations.id, pin.id),
        eq(schema.annotations.captureId, input.captureId),
        eq(schema.annotations.kind, "pin"),
        isNull(schema.annotations.deletedAt),
        // The precondition: exactly the revision the caller based its write
        // on. Two sessions holding the same starting revision cannot both
        // win — the loser's conditional write matches nothing.
        eq(schema.annotations.revision, input.expectedRevision),
      ),
    )
    .returning({ id: schema.annotations.id });

  if (updated.length !== 1) {
    // The row was live a moment ago, so a failed conditional write is a
    // stale-revision conflict (or a concurrent tombstone, which reads as
    // not-found to the loser).
    const current = await loadLivePin(db, input);
    return current ? { ok: false, error: "conflict" } : { ok: false, error: "not-found" };
  }

  const record = toRecord(pin);
  return {
    ok: true,
    annotation: {
      ...record,
      tip: input.tip !== undefined ? { x: input.tip.x, y: input.tip.y } : record.tip,
      body: input.body !== undefined ? input.body : record.body,
      revision: input.expectedRevision + 1,
    },
  };
}

/**
 * Tombstone one pin with the same revision precondition. The row is never
 * deleted: its number stays retired forever, its snapshot and body remain
 * addressable history, and listing simply excludes it. A stale or repeated
 * delete conflicts (or reads not-found once tombstoned) and changes nothing.
 */
export async function deletePin(
  db: Database,
  input: DeletePinInput,
  deps: PinStoreDeps = defaultPinStoreDeps,
): Promise<DeletePinResult> {
  const pin = await loadLivePin(db, input);
  if (!pin) return { ok: false, error: "not-found" };

  const now = deps.now();
  const updated = await db
    .update(schema.annotations)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.annotations.id, pin.id),
        eq(schema.annotations.captureId, input.captureId),
        eq(schema.annotations.kind, "pin"),
        isNull(schema.annotations.deletedAt),
        eq(schema.annotations.revision, input.expectedRevision),
      ),
    )
    .returning({ id: schema.annotations.id });

  if (updated.length !== 1) {
    const current = await loadLivePin(db, input);
    return current ? { ok: false, error: "conflict" } : { ok: false, error: "not-found" };
  }
  return { ok: true };
}
