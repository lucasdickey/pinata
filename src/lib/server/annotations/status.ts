// Server-only annotation lifecycle transitions: resolve and reopen (D075,
// REQUIREMENTS 6). Pins and rectangles (D079) share the lifecycle.
//
// Either role may resolve a pin and either may reopen it. Each change
// commits as one transaction: the conditional status update on the
// annotation row plus one append-only `status` thread entry whose body is
// written here ("Resolved by founder", "Reopened by editor"), never taken
// from the request. The thread therefore records every change of state in
// the same immutable chronology as the replies.
//
// Reopening returns the pin to `replied` when the founder has already
// answered in the thread, otherwise to `open`. A resolve of an already
// resolved pin (or a reopen of one that is not resolved) changes nothing
// and writes no entry: the caller gets the current record back. Status
// changes never bump `revision`, which protects tip and body edits only.

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Database } from "../db/client";
import {
  BUILT_ANNOTATION_KINDS,
  type AnnotationStatus,
  type ThreadActorRole,
} from "../db/schema";
import { AUTHOR_LABEL_BY_ROLE, type ThreadEntryRecord } from "../threads/entries";
import { annotationRecordFromRow, type AnnotationRecord } from "./pins";
import { unreadRepliesByPin, type PinRef, type Viewer } from "./seen";

export type PinStatusAction = "resolve" | "reopen";

export interface SetPinStatusInput extends PinRef {
  action: PinStatusAction;
  actorRole: ThreadActorRole;
  /** Whose unread count the returned record should carry. */
  viewer: Viewer;
}

export type SetPinStatusResult =
  | {
      ok: true;
      /** False when the pin was already in the requested state. */
      changed: boolean;
      annotation: AnnotationRecord;
      entry: ThreadEntryRecord | null;
    }
  | { ok: false; error: "not-found" };

export interface StatusStoreDeps {
  now: () => number;
  newId: () => string;
}

export const defaultStatusStoreDeps: StatusStoreDeps = {
  now: () => Date.now(),
  newId: () => randomUUID(),
};

type AnnotationRow = typeof schema.annotations.$inferSelect;

/** The server-written body of a status entry. */
export function statusEntryBody(action: PinStatusAction, actorRole: ThreadActorRole): string {
  return `${action === "resolve" ? "Resolved" : "Reopened"} by ${actorRole}`;
}

async function loadLivePin(db: Database, ref: PinRef): Promise<AnnotationRow | null> {
  const rows = await db
    .select({ annotation: schema.annotations, captureStatus: schema.captures.status })
    .from(schema.annotations)
    .innerJoin(schema.captures, eq(schema.annotations.captureId, schema.captures.id))
    .where(
      and(
        eq(schema.annotations.id, ref.annotationId),
        inArray(schema.annotations.kind, [...BUILT_ANNOTATION_KINDS]),
        isNull(schema.annotations.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.annotation.captureId !== ref.captureId || row.captureStatus !== "ready") {
    return null;
  }
  return row.annotation;
}

/** True when the founder has written at least one message in the thread. */
async function founderHasReplied(db: Database, annotationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.threadEntries.id })
    .from(schema.threadEntries)
    .where(
      and(
        eq(schema.threadEntries.annotationId, annotationId),
        eq(schema.threadEntries.actorRole, "founder"),
        eq(schema.threadEntries.kind, "message"),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

/**
 * Resolve or reopen one live pin. The status update is conditional on the
 * status the decision was based on, so two concurrent changes cannot both
 * write an entry for the same transition: the loser re-reads and reports
 * the state that won with `changed: false`.
 */
export async function setPinStatus(
  db: Database,
  input: SetPinStatusInput,
  deps: StatusStoreDeps = defaultStatusStoreDeps,
): Promise<SetPinStatusResult> {
  const pin = await loadLivePin(db, input);
  if (!pin) return { ok: false, error: "not-found" };

  const current = pin.status as AnnotationStatus;
  let target: AnnotationStatus | null = null;
  if (input.action === "resolve" && current !== "resolved") {
    target = "resolved";
  } else if (input.action === "reopen" && current === "resolved") {
    target = (await founderHasReplied(db, pin.id)) ? "replied" : "open";
  }

  const unreadFor = async (row: AnnotationRow) =>
    annotationRecordFromRow(
      row,
      (await unreadRepliesByPin(db, row.captureId, input.viewer)).get(row.id) ?? 0,
    );

  if (target === null) {
    return { ok: true, changed: false, annotation: await unreadFor(pin), entry: null };
  }

  const now = deps.now();
  const entry: ThreadEntryRecord = {
    id: deps.newId(),
    annotationId: pin.id,
    actorRole: input.actorRole,
    authorLabel: AUTHOR_LABEL_BY_ROLE[input.actorRole],
    kind: "status",
    body: statusEntryBody(input.action, input.actorRole),
    createdAt: now,
  };
  const committed = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.annotations)
      .set({ status: target, updatedAt: now })
      .where(
        and(
          eq(schema.annotations.id, pin.id),
          eq(schema.annotations.status, current),
          isNull(schema.annotations.deletedAt),
        ),
      )
      .returning({ id: schema.annotations.id });
    if (updated.length !== 1) return false;
    await tx.insert(schema.threadEntries).values({
      id: entry.id,
      annotationId: entry.annotationId,
      actorRole: entry.actorRole,
      authorLabel: entry.authorLabel,
      kind: "status",
      body: entry.body,
      // Status entries are written once per committed transition, so the
      // key only has to be unique within the pin's thread.
      idempotencyKey: `status:${entry.id}`,
      createdAt: entry.createdAt,
    });
    return true;
  });

  if (!committed) {
    // Another request changed the status first; report what actually won.
    const winner = await loadLivePin(db, input);
    if (!winner) return { ok: false, error: "not-found" };
    return { ok: true, changed: false, annotation: await unreadFor(winner), entry: null };
  }
  return {
    ok: true,
    changed: true,
    annotation: await unreadFor({ ...pin, status: target, updatedAt: now }),
    entry,
  };
}
