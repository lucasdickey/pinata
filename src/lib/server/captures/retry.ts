// Scoped, idempotent capture retry (VAL-PROJECT-005, VAL-CAPTURE-008).
//
// A retry targets exactly one (page, variant): ready siblings are never
// resubmitted and a failing sibling never rolls one back. It creates a new
// attempt row rather than rewriting the old one, so previous images,
// manifests, hashes, and their annotations stay addressable.
//
// Idempotency is durable and target-bound: the same key with the same target
// replays the one created attempt, and the same key with a different target
// conflicts instead of silently scheduling a second capture.

import { createHash, randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import {
  DESKTOP_VIEWPORT,
  MAX_CAPTURE_ATTEMPTS_PER_PROJECT,
  MOBILE_VIEWPORT,
} from "../../boundaries";
import { schema, type Database } from "../db/client";
import { CAPTURE_VARIANTS, type CaptureVariant } from "../db/schema";
import { summarizeVariant } from "./status";

/** Idempotency scope for scoped capture retries. */
export const CAPTURE_RETRY_SCOPE = "capture-retry";

const VIEWPORTS = { desktop: DESKTOP_VIEWPORT, mobile: MOBILE_VIEWPORT } as const;

export interface RetryCaptureTarget {
  pageId: string;
  variant: string;
  idempotencyKey: string;
}

export interface RetryAttempt {
  id: string;
  pageId: string;
  variant: CaptureVariant;
  attempt: number;
  status: "pending";
}

export type RetryCaptureError = "not-found" | "not-retryable" | "conflict" | "quota";

export type RetryCaptureResult =
  | { ok: true; created: boolean; attempt: RetryAttempt }
  | { ok: false; error: RetryCaptureError };

export interface CaptureRetryDeps {
  now: () => number;
  newId: () => string;
}

export const defaultCaptureRetryDeps: CaptureRetryDeps = {
  now: () => Date.now(),
  newId: () => randomUUID(),
};

/** Binds a retry key to its target so key reuse elsewhere cannot slip through. */
function targetDigest(pageId: string, variant: string): string {
  return createHash("sha256").update(JSON.stringify({ pageId, variant })).digest("hex");
}

async function findIdempotencyRecord(db: Database, key: string) {
  const rows = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.scope, CAPTURE_RETRY_SCOPE),
        eq(schema.idempotencyKeys.key, key),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function replay(
  record: { payloadDigest: string; resultJson: string | null },
  digest: string,
): RetryCaptureResult {
  if (record.payloadDigest !== digest || record.resultJson === null) {
    return { ok: false, error: "conflict" };
  }
  return { ok: true, created: false, attempt: JSON.parse(record.resultJson) as RetryAttempt };
}

function isVariant(value: string): value is CaptureVariant {
  return (CAPTURE_VARIANTS as readonly string[]).includes(value);
}

/**
 * Create the next attempt for one page variant, or report why not. The
 * caller must already have authorized the owning project.
 */
export async function retryCapture(
  db: Database,
  target: RetryCaptureTarget,
  deps: CaptureRetryDeps = defaultCaptureRetryDeps,
): Promise<RetryCaptureResult> {
  if (!isVariant(target.variant)) return { ok: false, error: "not-found" };
  const digest = targetDigest(target.pageId, target.variant);

  const existing = await findIdempotencyRecord(db, target.idempotencyKey);
  if (existing) return replay(existing, digest);

  const pageRows = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.id, target.pageId))
    .limit(1);
  const page = pageRows[0];
  if (!page) return { ok: false, error: "not-found" };

  const now = deps.now();
  const attempts = await db
    .select()
    .from(schema.captures)
    .where(
      and(eq(schema.captures.pageId, target.pageId), eq(schema.captures.variant, target.variant)),
    );
  const summary = summarizeVariant(target.variant, attempts, now);
  if (!summary.latest) return { ok: false, error: "not-found" };
  if (!summary.retryable) return { ok: false, error: "not-retryable" };

  // The attempt cap is a project-wide durable limit, so a retry loop cannot
  // grow one project's history without bound.
  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.captures)
    .innerJoin(schema.pages, eq(schema.captures.pageId, schema.pages.id))
    .where(eq(schema.pages.projectId, page.projectId));
  if ((total ?? 0) >= MAX_CAPTURE_ATTEMPTS_PER_PROJECT) return { ok: false, error: "quota" };

  const viewport = VIEWPORTS[target.variant];
  const attempt: RetryAttempt = {
    id: deps.newId(),
    pageId: target.pageId,
    variant: target.variant,
    attempt: summary.latest.attempt + 1,
    status: "pending",
  };

  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.idempotencyKeys).values({
        scope: CAPTURE_RETRY_SCOPE,
        key: target.idempotencyKey,
        payloadDigest: digest,
        resultJson: JSON.stringify(attempt),
        createdAt: now,
      });
      await tx.insert(schema.captures).values({
        id: attempt.id,
        pageId: attempt.pageId,
        variant: attempt.variant,
        attempt: attempt.attempt,
        status: attempt.status,
        // Unique per (page, variant): a second row for the same client key or
        // attempt number is rejected by the database, not just by this code.
        idempotencyKey: `retry:${target.idempotencyKey}`,
        requestedUrl: page.normalizedUrl,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor,
        createdAt: now,
        updatedAt: now,
      });
    });
  } catch (error) {
    const winner = await findIdempotencyRecord(db, target.idempotencyKey);
    if (winner) return replay(winner, digest);
    throw error;
  }

  return { ok: true, created: true, attempt };
}
