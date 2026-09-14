// Fenced capture-attempt state transitions (VAL-CAPTURE-008).
//
// Every write is a compare-and-set on one immutable attempt id plus its
// expected current status, so two workers, a retried dispatch, or a late
// result from an abandoned attempt can never rewrite a row that already
// reached a terminal state. Illegal pairs are refused before touching the
// database; a losing write reports `fenced` and changes nothing.

import { and, eq } from "drizzle-orm";
import { schema, type Database } from "../db/client";
import type { CaptureStatus } from "../db/schema";

/** The only persisted transitions: pending → capturing → ready|failed. */
const LEGAL_TRANSITIONS: ReadonlySet<string> = new Set([
  "pending>capturing",
  "pending>ready",
  "pending>failed",
  "capturing>ready",
  "capturing>failed",
]);

export interface CaptureTransitionInput {
  captureId: string;
  /** Expected current status; the compare half of the compare-and-set. */
  from: CaptureStatus;
  to: Exclude<CaptureStatus, "pending">;
  now: number;
  finalUrl?: string;
  documentWidth?: number;
  documentHeight?: number;
  blobPath?: string;
  blobContentType?: string;
  blobBytes?: number;
  imageHash?: string;
  domManifestJson?: string;
  domManifestVersion?: number;
  warningJson?: string;
  errorCode?: string;
  errorMessage?: string;
}

export type CaptureTransitionResult = "applied" | "fenced";

function patchFor(input: CaptureTransitionInput): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: input.to, updatedAt: input.now };
  const optional: Record<string, unknown> = {
    finalUrl: input.finalUrl,
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    blobPath: input.blobPath,
    blobContentType: input.blobContentType,
    blobBytes: input.blobBytes,
    imageHash: input.imageHash,
    domManifestJson: input.domManifestJson,
    domManifestVersion: input.domManifestVersion,
    warningJson: input.warningJson,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) patch[key] = value;
  }
  if (input.to === "ready") patch.capturedAt = input.now;
  // Started and finished instants make an attempt's duration readable
  // later, which is what the per-project progress estimate is built from.
  if (input.to === "capturing") patch.startedAt = input.now;
  if (input.to === "ready" || input.to === "failed") patch.finishedAt = input.now;
  return patch;
}

/**
 * Move one attempt forward if and only if it is still in the expected state.
 * Returns `fenced` for an illegal pair or a lost race, having written nothing.
 */
export async function applyCaptureTransition(
  db: Database,
  input: CaptureTransitionInput,
): Promise<CaptureTransitionResult> {
  if (!LEGAL_TRANSITIONS.has(`${input.from}>${input.to}`)) return "fenced";
  const updated = await db
    .update(schema.captures)
    .set(patchFor(input))
    .where(and(eq(schema.captures.id, input.captureId), eq(schema.captures.status, input.from)))
    .returning({ id: schema.captures.id });
  return updated.length === 1 ? "applied" : "fenced";
}
