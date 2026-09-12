// Server-only append-only thread store (REQUIREMENTS 6, VAL-THREAD-001,
// VAL-THREAD-002, VAL-THREAD-003, VAL-THREAD-004).
//
// A thread hangs off one live pin: the editor's editable original comment
// is the annotation row itself, and everything after it is a
// `thread_entries` row that nobody — editor included — can update or
// delete. The database triggers in drizzle/0001_thread_entries_immutable.sql
// enforce that below this module; this module simply never issues an UPDATE
// or DELETE against the table.
//
// The author label is assigned here from the actor role, never taken from
// the request: a founder is always the literal `founder`, the editor is
// always `Lucas`. Bodies are bounded plain text. Append is durable-idempotent
// per (annotation, idempotency key): the same key with the same body and
// role replays the committed entry; the same key with a different intent
// conflicts rather than silently returning someone else's reply.
//
// A reply against a tombstoned annotation, a pin of another capture, or a
// capture that is not ready is "not-found" — the caller answers with the
// same generic 404 every other capture read uses.

import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { FEEDBACK_BODY_MAX_CHARS } from "../../boundaries";
import { schema, type Database } from "../db/client";
import {
  THREAD_AUTHOR_LABELS,
  type ThreadActorRole,
  type ThreadAuthorLabel,
  type ThreadEntryKind,
} from "../db/schema";

/** The server-assigned display label for each actor role. */
export const AUTHOR_LABEL_BY_ROLE: Record<ThreadActorRole, ThreadAuthorLabel> = {
  editor: "Lucas",
  founder: "founder",
};

/**
 * One immutable thread entry as presented to an authorized reader. A
 * `message` was typed by a person; a `status` entry was written by the
 * server when the pin was resolved or reopened (D075).
 */
export interface ThreadEntryRecord {
  id: string;
  annotationId: string;
  actorRole: ThreadActorRole;
  authorLabel: ThreadAuthorLabel;
  kind: ThreadEntryKind;
  body: string;
  createdAt: number;
}

export interface ThreadRef {
  captureId: string;
  annotationId: string;
}

export type ListThreadResult =
  | { ok: true; entries: ThreadEntryRecord[] }
  | { ok: false; error: "not-found" };

export interface AppendThreadEntryInput extends ThreadRef {
  actorRole: ThreadActorRole;
  body: string;
  idempotencyKey: string;
}

/**
 * An optional admission hook run after the replay check and validation but
 * before the insert: the founder reply quota lives here so a replayed or
 * invalid reply never consumes quota.
 */
export type ThreadAdmission = () =>
  | Promise<{ ok: true } | { ok: false; retryAfterMs: number }>
  | { ok: true }
  | { ok: false; retryAfterMs: number };

export type AppendThreadEntryResult =
  | { ok: true; created: boolean; entry: ThreadEntryRecord }
  | { ok: false; error: "not-found" | "invalid" | "conflict" }
  | { ok: false; error: "throttled"; retryAfterMs: number };

export interface ThreadStoreDeps {
  now: () => number;
  newId: () => string;
}

export const defaultThreadStoreDeps: ThreadStoreDeps = {
  now: () => Date.now(),
  newId: () => randomUUID(),
};

type EntryRow = typeof schema.threadEntries.$inferSelect;

function toRecord(row: EntryRow): ThreadEntryRecord {
  return {
    id: row.id,
    annotationId: row.annotationId,
    actorRole: row.actorRole as ThreadActorRole,
    authorLabel: row.authorLabel as ThreadAuthorLabel,
    kind: row.kind as ThreadEntryKind,
    body: row.body,
    createdAt: row.createdAt,
  };
}

/**
 * The live pin a thread belongs to, honoring the capture binding: a
 * tombstoned pin, a pin of another capture, and a missing pin are all null.
 */
async function loadLivePin(db: Database, ref: ThreadRef) {
  const rows = await db
    .select({
      id: schema.annotations.id,
      captureId: schema.annotations.captureId,
      status: schema.captures.status,
    })
    .from(schema.annotations)
    .innerJoin(schema.captures, eq(schema.annotations.captureId, schema.captures.id))
    .where(
      and(
        eq(schema.annotations.id, ref.annotationId),
        eq(schema.annotations.kind, "pin"),
        isNull(schema.annotations.deletedAt),
      ),
    )
    .limit(1);
  const pin = rows[0];
  if (!pin || pin.captureId !== ref.captureId || pin.status !== "ready") return null;
  return pin;
}

/** True when the reply is bounded directional plain text. */
function bodyValid(body: string): boolean {
  return body.trim().length > 0 && body.length <= FEEDBACK_BODY_MAX_CHARS;
}

/** The one documented total order: created_at, then id. */
export async function listThreadEntries(db: Database, ref: ThreadRef): Promise<ListThreadResult> {
  const pin = await loadLivePin(db, ref);
  if (!pin) return { ok: false, error: "not-found" };
  const rows = await db
    .select()
    .from(schema.threadEntries)
    .where(eq(schema.threadEntries.annotationId, pin.id))
    .orderBy(asc(schema.threadEntries.createdAt), asc(schema.threadEntries.id));
  return { ok: true, entries: rows.map(toRecord) };
}

async function findExisting(
  db: Database,
  annotationId: string,
  idempotencyKey: string,
): Promise<EntryRow | null> {
  const rows = await db
    .select()
    .from(schema.threadEntries)
    .where(
      and(
        eq(schema.threadEntries.annotationId, annotationId),
        eq(schema.threadEntries.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function replay(existing: EntryRow, input: AppendThreadEntryInput): AppendThreadEntryResult {
  // Same key, different intent (body or role) is a conflict: the caller must
  // choose a new key rather than be handed a different entry as its own.
  if (existing.body !== input.body || existing.actorRole !== input.actorRole) {
    return { ok: false, error: "conflict" };
  }
  return { ok: true, created: false, entry: toRecord(existing) };
}

/** The (annotation_id, idempotency_key) unique index firing. */
function isIdempotencyCollision(error: unknown): boolean {
  let current: unknown = error;
  while (current) {
    if (
      current instanceof Error &&
      /unique constraint failed/i.test(current.message) &&
      /thread_entries\.(annotation_id|idempotency_key)/i.test(current.message)
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Append one entry to a live pin's thread, or replay the entry the same key
 * already committed. The label is derived from the role; the body is bounded;
 * the admission hook (the founder quota) runs only for a genuinely new,
 * valid reply. The row is inserted exactly once and never touched again.
 */
export async function appendThreadEntry(
  db: Database,
  input: AppendThreadEntryInput,
  deps: ThreadStoreDeps = defaultThreadStoreDeps,
  admission?: ThreadAdmission,
): Promise<AppendThreadEntryResult> {
  const pin = await loadLivePin(db, input);
  if (!pin) return { ok: false, error: "not-found" };
  const existing = await findExisting(db, pin.id, input.idempotencyKey);
  if (existing) return replay(existing, input);
  if (!bodyValid(input.body)) return { ok: false, error: "invalid" };
  const authorLabel = AUTHOR_LABEL_BY_ROLE[input.actorRole];
  if (!THREAD_AUTHOR_LABELS.includes(authorLabel)) return { ok: false, error: "invalid" };

  if (admission) {
    const admitted = await admission();
    if (!admitted.ok) return { ok: false, error: "throttled", retryAfterMs: admitted.retryAfterMs };
  }

  const entry: ThreadEntryRecord = {
    id: deps.newId(),
    annotationId: pin.id,
    actorRole: input.actorRole,
    authorLabel,
    kind: "message",
    body: input.body,
    createdAt: deps.now(),
  };
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.threadEntries).values({
        id: entry.id,
        annotationId: entry.annotationId,
        actorRole: entry.actorRole,
        authorLabel: entry.authorLabel,
        kind: entry.kind,
        body: entry.body,
        idempotencyKey: input.idempotencyKey,
        createdAt: entry.createdAt,
      });
      // The pin lifecycle (D075): the founder's first reply moves an open
      // pin to `replied`, in the same transaction as the entry. An editor
      // follow-up changes nothing, and a resolved pin stays resolved until
      // someone reopens it.
      if (input.actorRole === "founder") {
        await tx
          .update(schema.annotations)
          .set({ status: "replied", updatedAt: entry.createdAt })
          .where(and(eq(schema.annotations.id, pin.id), eq(schema.annotations.status, "open")));
      }
    });
  } catch (error) {
    // A concurrent same-key request committed first: converge on that one
    // committed entry rather than reporting a spurious failure.
    if (isIdempotencyCollision(error)) {
      const winner = await findExisting(db, pin.id, input.idempotencyKey);
      if (winner) return replay(winner, input);
    }
    throw error;
  }
  return { ok: true, created: true, entry };
}
