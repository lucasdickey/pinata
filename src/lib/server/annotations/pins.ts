// Server-only annotation store for pins and rectangles (VAL-PIN-001,
// VAL-PIN-002, VAL-PIN-003, VAL-PIN-008, VAL-PIN-009, VAL-CANVAS-001,
// VAL-CANVAS-003, VAL-CANVAS-004, D079).
//
// The annotation is the canonical domain record: its geometry is stored as
// exact screenshot-natural CSS pixels in geometry_json — a tip for a pin, a
// box for a rectangle — bound to one immutable ready capture. Numbers are
// server-determined and monotonically increasing per capture across both
// kinds: the next number is derived from every row the capture has —
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
// (or null) is then immutable for the life of the annotation: moves,
// resizes, edits, recaptures, and reloads never re-query or rebind it.
//
// Updates (move, resize, edit) and delete carry an expectedRevision
// precondition and commit as one conditional atomic write: a stale,
// concurrent, or repeated write loses with a conflict and changes no row, so
// one authoritative revision always remains. Delete is a tombstone: the row
// stays so its number is never reused, and its thread entries are untouched.
//
// Idempotency is durable and intent-bound, same shape as project creation:
// the same key with the same normalized payload replays the original record,
// and the same key with a different payload conflicts.
//
// The exported names still say "pin" because the routes and the tests grew
// up with them; every one of them handles both kinds.

import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, isNull, max } from "drizzle-orm";
import {
  FEEDBACK_BODY_MAX_CHARS,
  MAX_ANNOTATIONS_PER_CAPTURE,
  MIN_SHAPE_SIZE_PX,
} from "../../boundaries";
import { schema, type Database } from "../db/client";
import {
  BUILT_ANNOTATION_KINDS,
  type AnnotationStatus,
  type BuiltAnnotationKind,
} from "../db/schema";
import {
  deriveSnapshot,
  parseManifestElements,
  type ContextElement,
} from "./context";
import { EDITOR_VIEWER, unreadRepliesByPin, type Viewer } from "./seen";

/** Idempotency scope for editor annotation creation. */
export const ANNOTATION_CREATE_SCOPE = "annotation-create";

/** Geometry schema version persisted with every annotation (both kinds). */
const GEOMETRY_VERSION = 1;

/** Bounded retries when two concurrent inserts race for the same number. */
const MAX_NUMBER_COLLISION_RETRIES = 3;

/** A pin tip in screenshot-natural CSS pixels. */
export interface PinTip {
  x: number;
  y: number;
}

/** A rectangle's box in screenshot-natural CSS pixels (D079). */
export interface RectangleGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The geometry of one annotation, named by kind. */
export type AnnotationGeometry =
  | { kind: "pin"; tip: PinTip }
  | { kind: "rectangle"; rect: RectangleGeometry };

interface AnnotationRecordBase {
  id: string;
  captureId: string;
  number: number;
  body: string;
  /** Inert capture-time DOM context snapshot, or the explicit null. */
  elementSnapshot: ContextElement | null;
  revision: number;
  /** Lifecycle status (D075): open, replied, or resolved. */
  status: AnnotationStatus;
  /** Unread replies for the viewer the record was read for (D075). */
  unreadReplies: number;
  createdAt: number;
}

/** The canonical domain view of one persisted pin. */
export interface PinAnnotationRecord extends AnnotationRecordBase {
  kind: "pin";
  tip: PinTip;
}

/** The canonical domain view of one persisted rectangle (D079). */
export interface RectangleAnnotationRecord extends AnnotationRecordBase {
  kind: "rectangle";
  rect: RectangleGeometry;
}

export type AnnotationRecord = PinAnnotationRecord | RectangleAnnotationRecord;

export type ListPinsResult =
  | { ok: true; annotations: AnnotationRecord[] }
  | { ok: false; error: "not-found" };

/**
 * A create carries exactly one geometry: `tip` for a pin or `rect` for a
 * rectangle. Both or neither is an invalid input.
 */
export interface CreatePinInput {
  captureId: string;
  tip?: PinTip;
  rect?: RectangleGeometry;
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
  /** A moved tip (pins only). */
  tip?: PinTip;
  /** A moved or resized box (rectangles only). */
  rect?: RectangleGeometry;
  /** A new original body. */
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

/** The kinds every read here lists and every write here accepts. */
const LISTED_KINDS: readonly string[] = BUILT_ANNOTATION_KINDS;

/** Only an immutable ready capture with persisted dimensions is annotatable. */
function annotatable(capture: CaptureRow | undefined): capture is CaptureRow {
  return (
    capture !== undefined &&
    capture.status === "ready" &&
    capture.documentWidth !== null &&
    capture.documentHeight !== null
  );
}

/** The geometry a create or update names, or null when it names none or both. */
export function geometryOf(input: {
  tip?: PinTip;
  rect?: RectangleGeometry;
}): AnnotationGeometry | null {
  if (input.tip !== undefined && input.rect === undefined) {
    return { kind: "pin", tip: { x: input.tip.x, y: input.tip.y } };
  }
  if (input.rect !== undefined && input.tip === undefined) {
    const { x, y, width, height } = input.rect;
    return { kind: "rectangle", rect: { x, y, width, height } };
  }
  return null;
}

/** What geometry_json holds for one geometry: the tip or the box itself. */
function geometryJson(geometry: AnnotationGeometry): string {
  return JSON.stringify(geometry.kind === "pin" ? geometry.tip : geometry.rect);
}

/** The domain record for one annotation row, with the viewer's unread count. */
export function annotationRecordFromRow(row: AnnotationRow, unreadReplies = 0): AnnotationRecord {
  const base: AnnotationRecordBase = {
    id: row.id,
    captureId: row.captureId,
    number: row.number,
    body: row.originalBody,
    elementSnapshot: row.elementSnapshotJson
      ? (JSON.parse(row.elementSnapshotJson) as ContextElement)
      : null,
    revision: row.revision,
    status: row.status as AnnotationStatus,
    unreadReplies,
    createdAt: row.createdAt,
  };
  if (row.kind === "rectangle") {
    return { ...base, kind: "rectangle", rect: JSON.parse(row.geometryJson) as RectangleGeometry };
  }
  return { ...base, kind: "pin", tip: JSON.parse(row.geometryJson) as PinTip };
}

const toRecord = annotationRecordFromRow;

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

/**
 * True when the box is finite, at least MIN_SHAPE_SIZE_PX in each dimension,
 * and entirely inside the capture's document (inclusive edges). Clamping is
 * the client's job; the server only rejects.
 */
function rectWithinCapture(rect: RectangleGeometry, capture: CaptureRow): boolean {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every((value) => Number.isFinite(value))) return false;
  return (
    rect.width >= MIN_SHAPE_SIZE_PX &&
    rect.height >= MIN_SHAPE_SIZE_PX &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= (capture.documentWidth ?? -1) &&
    rect.y + rect.height <= (capture.documentHeight ?? -1)
  );
}

/** Geometry validation by kind against one ready capture. */
function geometryWithinCapture(geometry: AnnotationGeometry, capture: CaptureRow): boolean {
  return geometry.kind === "pin"
    ? tipWithinCapture(geometry.tip, capture)
    : rectWithinCapture(geometry.rect, capture);
}

/** True when the original body is bounded directional plain text. */
function bodyValid(body: string): boolean {
  return body.trim().length > 0 && body.length <= FEEDBACK_BODY_MAX_CHARS;
}

/**
 * List the live annotations (pins and rectangles) of one ready capture,
 * ordered by their stable numbers, each carrying the unread-reply count for
 * the requesting viewer (D075). This is the founder's read too.
 */
export async function listPins(
  db: Database,
  captureId: string,
  viewer: Viewer = EDITOR_VIEWER,
): Promise<ListPinsResult> {
  const capture = await loadCapture(db, captureId);
  if (!annotatable(capture)) return { ok: false, error: "not-found" };
  const rows = await db
    .select()
    .from(schema.annotations)
    .where(
      and(
        eq(schema.annotations.captureId, captureId),
        inArray(schema.annotations.kind, [...LISTED_KINDS]),
        isNull(schema.annotations.deletedAt),
      ),
    )
    .orderBy(asc(schema.annotations.number));
  const unread = await unreadRepliesByPin(db, captureId, viewer);
  return { ok: true, annotations: rows.map((row) => toRecord(row, unread.get(row.id) ?? 0)) };
}

/** Binds an idempotency key to the whole normalized create intent. */
function createDigest(input: CreatePinInput, geometry: AnnotationGeometry | null): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        captureId: input.captureId,
        // A pin digest keeps the shape it always had, so keys recorded
        // before rectangles existed still replay.
        ...(geometry?.kind === "rectangle"
          ? { kind: "rectangle", rect: geometry.rect }
          : { tip: geometry?.tip ?? null }),
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
  // key rather than silently getting a different record back.
  if (record.payloadDigest !== digest || record.resultJson === null) {
    return { ok: false, error: "conflict" };
  }
  // Records committed before the lifecycle columns existed carry no status;
  // a replayed create is always a fresh open record with nothing unread.
  const stored = JSON.parse(record.resultJson) as Partial<AnnotationRecord> & AnnotationRecord;
  return {
    ok: true,
    created: false,
    annotation: { ...stored, status: stored.status ?? "open", unreadReplies: 0 },
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
 * Persist one annotation atomically: idempotency record, monotonic number,
 * and the annotation row in one transaction — or nothing at all. A blank or
 * over-limit body, out-of-bounds or too-small geometry, non-ready capture,
 * unknown context element id, or exhausted quota writes nothing and
 * consumes no number.
 */
export async function createPinAtomically(
  db: Database,
  input: CreatePinInput,
  deps: PinStoreDeps = defaultPinStoreDeps,
): Promise<CreatePinResult> {
  const geometry = geometryOf(input);
  const digest = createDigest(input, geometry);
  const existing = await findIdempotencyRecord(db, input.idempotencyKey);
  if (existing) return replay(existing, digest);

  const capture = await loadCapture(db, input.captureId);
  if (!annotatable(capture)) return { ok: false, error: "not-found" };
  if (!geometry || !geometryWithinCapture(geometry, capture)) {
    return { ok: false, error: "invalid" };
  }
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
    const base: AnnotationRecordBase = {
      id,
      captureId: input.captureId,
      // Filled in inside the transaction before the insert lands.
      number: 0,
      body: input.body,
      elementSnapshot: snapshot,
      revision: 1,
      status: "open",
      unreadReplies: 0,
      createdAt: now,
    };
    const annotation: AnnotationRecord =
      geometry.kind === "pin"
        ? { ...base, kind: "pin", tip: geometry.tip }
        : { ...base, kind: "rectangle", rect: geometry.rect };
    try {
      await db.transaction(async (tx) => {
        // The idempotency row goes first: its primary key is what makes two
        // concurrent same-key requests resolve to one committed record.
        await tx.insert(schema.idempotencyKeys).values({
          scope: ANNOTATION_CREATE_SCOPE,
          key: input.idempotencyKey,
          payloadDigest: digest,
          resultJson: null,
          createdAt: now,
        });
        // Monotonic per capture across both kinds and never reused:
        // tombstoned rows still count, so a deleted number stays retired.
        const [{ highest }] = await tx
          .select({ highest: max(schema.annotations.number) })
          .from(schema.annotations)
          .where(eq(schema.annotations.captureId, input.captureId));
        annotation.number = (highest ?? 0) + 1;
        await tx.insert(schema.annotations).values({
          id: annotation.id,
          captureId: annotation.captureId,
          kind: geometry.kind,
          number: annotation.number,
          geometryJson: geometryJson(geometry),
          geometryVersion: GEOMETRY_VERSION,
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
  throw new Error("annotation create retries exhausted");
}

/**
 * Load the addressed live annotation, honoring the capture binding: one
 * addressed through another capture's route is not found, never rebound.
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
        inArray(schema.annotations.kind, [...LISTED_KINDS]),
        isNull(schema.annotations.deletedAt),
      ),
    )
    .limit(1);
  const pin = rows[0];
  if (!pin || pin.captureId !== input.captureId) return null;
  return pin;
}

/**
 * Commit one revisioned update — new geometry (a moved tip, or a moved or
 * resized box), a new original body, or both — as a single conditional
 * atomic write guarded by the caller's expected revision. The write binds to
 * the annotation's own capture and kind: geometry of the other kind,
 * out-of-bounds or too-small geometry, and blank/over-limit bodies write
 * nothing. Geometry updates preserve number, body, snapshot, and capture
 * binding; body updates preserve geometry and snapshot. A stale or
 * concurrent write loses with a conflict and changes no row, leaving one
 * authoritative revision.
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

  const wantsGeometry = input.tip !== undefined || input.rect !== undefined;
  const geometry = wantsGeometry ? geometryOf(input) : null;
  if (wantsGeometry) {
    // Exactly one geometry, of the annotation's own kind, inside the frame.
    if (!geometry || geometry.kind !== (pin.kind as BuiltAnnotationKind)) {
      return { ok: false, error: "invalid" };
    }
    if (!geometryWithinCapture(geometry, capture)) return { ok: false, error: "invalid" };
  }
  if (input.body !== undefined && !bodyValid(input.body)) {
    return { ok: false, error: "invalid" };
  }

  const now = deps.now();
  const updated = await db
    .update(schema.annotations)
    .set({
      ...(geometry ? { geometryJson: geometryJson(geometry) } : {}),
      ...(input.body !== undefined ? { originalBody: input.body } : {}),
      revision: input.expectedRevision + 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.annotations.id, pin.id),
        eq(schema.annotations.captureId, input.captureId),
        eq(schema.annotations.kind, pin.kind),
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

  // Move, resize, and edit are editor-only, so the returned record carries
  // the editor's unread count and can replace the listed record one for one.
  const unread = await unreadRepliesByPin(db, pin.captureId, EDITOR_VIEWER);
  const record = toRecord(
    {
      ...pin,
      ...(geometry ? { geometryJson: geometryJson(geometry) } : {}),
      ...(input.body !== undefined ? { originalBody: input.body } : {}),
      revision: input.expectedRevision + 1,
      updatedAt: now,
    },
    unread.get(pin.id) ?? 0,
  );
  return { ok: true, annotation: record };
}

/**
 * Tombstone one annotation with the same revision precondition. The row is
 * never deleted: its number stays retired forever, its snapshot and body
 * remain addressable history, and listing simply excludes it. A stale or
 * repeated delete conflicts (or reads not-found once tombstoned) and changes
 * nothing.
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
        eq(schema.annotations.kind, pin.kind),
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
