// Server-driven capture (D076): admit, claim, execute, finalize, release —
// and then keep going.
//
// `driveCapture` is the one sequence the dispatch route always performed
// (D035), lifted out so the server can run it without a request from a
// browser: after project creation, after a retry, from the sweep, and from
// the finalization of the previous attempt. When an attempt finalizes it
// does two more things:
//
// - if it failed with a catalog outcome the catalog marks retryable, or the
//   sweep found it stale, one automatic retry is created through the very
//   same path a manual retry uses, marked `automatic` so it is never retried
//   automatically again (MAX_AUTOMATIC_CAPTURE_RETRIES, the project-wide
//   attempt cap still applies);
// - the next pending attempt of the same project is scheduled to run after
//   the current response, so a project chains to completion on its own.
//
// The durable lease table stays the only concurrency authority: every path
// here claims through it, and a claim that finds every slot held leaves the
// attempt pending and stops. The client driver, the sweep, or the next
// finalization in the project picks it up later. Two drivers racing the
// same attempt are settled by the fenced transition, never by this module.

import { and, asc, eq, inArray } from "drizzle-orm";
import { MAX_ACTIVE_CAPTURES, MAX_AUTOMATIC_CAPTURE_RETRIES } from "../../boundaries";
import { schema, type Database } from "../db/client";
import { CAPTURE_VARIANTS } from "../db/schema";
import type { AdmissionDeps } from "./admission";
import { serverCaptureEnabled, type ContinuationScheduler } from "./continuation";
import { dispatchCapture } from "./dispatch";
import { executeCapture, type CaptureExecutionDeps, type ReadyCapture } from "./execute";
import { releaseCaptureLease } from "./leases";
import { defaultCaptureRetryDeps, retryCapture, type CaptureRetryDeps } from "./retry";
import { captureAttemptState, summarizeVariant } from "./status";

export interface CaptureDriveDeps {
  admission: AdmissionDeps;
  execution: CaptureExecutionDeps;
  /** Runs a task after the current response; tests run it inline. */
  after: ContinuationScheduler;
  retry?: CaptureRetryDeps;
  now?: () => number;
}

export type DriveCaptureResult =
  | { ok: true; capture: ReadyCapture }
  | { ok: false; error: "not-found" }
  /** The attempt is not `pending` (claimed, terminal, or fenced away). */
  | { ok: false; error: "not-dispatchable" }
  /** Every durable slot is held; the attempt stays pending. */
  | { ok: false; error: "quota" }
  /** The store answered with an error; the row is whatever it was. */
  | { ok: false; error: "unavailable" }
  /** The attempt finalized as this catalog outcome. */
  | { ok: false; outcome: string };

/** The idempotency key of the one automatic retry an attempt may spawn. */
export function automaticRetryKey(captureId: string): string {
  return `auto:${captureId}`;
}

/**
 * Run one pending attempt to a terminal row, then continue the project. The
 * caller must already have authorized the attempt (the dispatch route) or be
 * the server itself (continuation and sweep).
 */
export async function driveCapture(
  db: Database,
  captureId: string,
  deps: CaptureDriveDeps,
): Promise<DriveCaptureResult> {
  const now = deps.now ?? (() => Date.now());

  let admitted;
  try {
    admitted = await dispatchCapture(db, { captureId }, { ...deps.admission, now });
  } catch {
    return { ok: false, error: "unavailable" };
  }

  if (!admitted.ok) {
    if (admitted.error === "rejected") {
      // Admission failed the row (pending → failed) with a catalog outcome;
      // that is a finalization like any other.
      await continueAfterFinalization(db, captureId, deps);
      return { ok: false, outcome: admitted.outcome };
    }
    return { ok: false, error: admitted.error };
  }

  let execution;
  try {
    execution = await executeCapture(db, captureId, { ...deps.execution, now });
  } catch {
    // Truly unexpected: the row stays `capturing` and computes stale at the
    // published age, and the lease expires with it — never released early,
    // because the provider job may still be running.
    return { ok: false, error: "unavailable" };
  }

  // Execution always closes the claim (ready or failed), so the slot frees
  // now. The release is conditional on this capture id: it cannot free a
  // slot a newer attempt reclaimed after this lease expired.
  await releaseCaptureLease(db, captureId).catch(() => {});

  if (!execution.ok && "error" in execution) {
    // Another worker finalized this attempt between the claim and here; it
    // owns the continuation.
    return { ok: false, error: "not-dispatchable" };
  }

  await continueAfterFinalization(db, captureId, deps);

  if (!execution.ok) return { ok: false, outcome: execution.outcome };
  return { ok: true, capture: execution.capture };
}

/** One automatic retry when the catalog allows it, then the next attempt. */
async function continueAfterFinalization(
  db: Database,
  captureId: string,
  deps: CaptureDriveDeps,
): Promise<void> {
  let projectId: string | null = null;
  try {
    const retried = await scheduleAutomaticRetry(db, captureId, deps);
    projectId = retried.projectId;
  } catch {
    // The retry is best effort: a store error here must not turn a finalized
    // attempt into a failed response. The sweep sees the same rows later.
  }
  if (!projectId) return;
  const owner = projectId;
  deps.after(async () => {
    await driveProject(db, owner, deps);
  });
}

export type AutomaticRetryResult = {
  projectId: string | null;
  /** True when this call created the automatic attempt (not a replay). */
  created: boolean;
};

/**
 * Create the one automatic retry for a finalized or stale attempt, when the
 * attempt is the newest of its page variant, the catalog marks its outcome
 * retryable (or it computed stale), and the run of automatic attempts since
 * the last manual one is still under MAX_AUTOMATIC_CAPTURE_RETRIES. The
 * idempotency key is derived from the attempt id, so a second call for the
 * same attempt replays instead of creating another row.
 */
export async function scheduleAutomaticRetry(
  db: Database,
  captureId: string,
  deps: Pick<CaptureDriveDeps, "retry" | "now">,
): Promise<AutomaticRetryResult> {
  const now = deps.now?.() ?? Date.now();
  const rows = await db
    .select({ capture: schema.captures, projectId: schema.pages.projectId })
    .from(schema.captures)
    .innerJoin(schema.pages, eq(schema.captures.pageId, schema.pages.id))
    .where(eq(schema.captures.id, captureId))
    .limit(1);
  const row = rows[0];
  if (!row) return { projectId: null, created: false };
  const { capture, projectId } = row;

  const siblings = await db
    .select()
    .from(schema.captures)
    .where(
      and(eq(schema.captures.pageId, capture.pageId), eq(schema.captures.variant, capture.variant)),
    )
    .orderBy(asc(schema.captures.attempt));
  const summary = summarizeVariant(capture.variant, siblings, now);
  const latest = summary.latest;
  if (!latest || latest.id !== capture.id) return { projectId, created: false };
  if (latest.state !== "failed" && latest.state !== "stale") return { projectId, created: false };
  if (!summary.retryable) return { projectId, created: false };

  // Count the automatic attempts since the last one a person asked for; the
  // newest is at the end of the ascending list.
  let automaticRun = 0;
  for (let index = siblings.length - 1; index >= 0; index -= 1) {
    if (siblings[index]!.origin !== "automatic") break;
    automaticRun += 1;
  }
  if (automaticRun >= MAX_AUTOMATIC_CAPTURE_RETRIES) return { projectId, created: false };

  const result = await retryCapture(
    db,
    {
      pageId: capture.pageId,
      variant: capture.variant,
      idempotencyKey: automaticRetryKey(capture.id),
      origin: "automatic",
    },
    deps.retry ?? { ...defaultCaptureRetryDeps, now: () => now },
  );
  return { projectId, created: result.ok && result.created };
}

export interface DriveProjectResult {
  /** Attempt ids handed to the scheduler, in hierarchy order. */
  scheduled: string[];
}

/** The project's pending attempts in project → page → device → attempt order. */
async function pendingAttemptIds(db: Database, projectId: string): Promise<string[]> {
  const rows = await db
    .select({
      id: schema.captures.id,
      variant: schema.captures.variant,
      attempt: schema.captures.attempt,
      sortIndex: schema.pages.sortIndex,
      pageId: schema.pages.id,
    })
    .from(schema.captures)
    .innerJoin(schema.pages, eq(schema.captures.pageId, schema.pages.id))
    .where(and(eq(schema.pages.projectId, projectId), eq(schema.captures.status, "pending")))
    .orderBy(asc(schema.pages.sortIndex), asc(schema.pages.id), asc(schema.captures.attempt));
  const deviceOrder = (variant: string) =>
    (CAPTURE_VARIANTS as readonly string[]).indexOf(variant);
  return rows
    .sort(
      (a, b) =>
        a.sortIndex - b.sortIndex ||
        (a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0) ||
        deviceOrder(a.variant) - deviceOrder(b.variant) ||
        a.attempt - b.attempt,
    )
    .map((row) => row.id);
}

/**
 * Schedule the next pending attempts of one project, at most the durable
 * lease cap, each as its own continuation task. A task whose claim finds
 * every slot held stops quietly; the attempt stays pending for the next
 * finalization in this project, the client driver, or the sweep.
 */
export async function driveProject(
  db: Database,
  projectId: string,
  deps: CaptureDriveDeps,
): Promise<DriveProjectResult> {
  const pending = await pendingAttemptIds(db, projectId);
  const scheduled = pending.slice(0, MAX_ACTIVE_CAPTURES);
  for (const captureId of scheduled) {
    deps.after(async () => {
      await driveCapture(db, captureId, deps);
    });
  }
  return { scheduled };
}

/** The owning project of a page, for continuing after a scoped retry. */
export async function projectIdForPage(db: Database, pageId: string): Promise<string | null> {
  const rows = await db
    .select({ projectId: schema.pages.projectId })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .limit(1);
  return rows[0]?.projectId ?? null;
}

export interface SweepReport {
  /** Projects that had at least one pending or stale attempt. */
  projects: number;
  /** Pending attempts seen across those projects. */
  pending: number;
  /** Attempts that computed stale at sweep time. */
  stale: number;
  /** Automatic retries this sweep created for stale attempts. */
  retried: number;
  /** Attempts handed to the scheduler. */
  scheduled: number;
}

/**
 * Re-drive every project with pending or stale work. Stale attempts get
 * their one automatic retry first (a pending row the drive then picks up);
 * each affected project is then driven up to the lease cap. The store
 * decides real concurrency, so a sweep over many projects cannot exceed the
 * published slot count no matter how many tasks it schedules. While
 * PINATA_SERVER_CAPTURE is off the sweep only counts: it creates no retry
 * and schedules nothing.
 */
export async function sweepCaptures(db: Database, deps: CaptureDriveDeps): Promise<SweepReport> {
  const now = deps.now?.() ?? Date.now();
  const open = await db
    .select({
      id: schema.captures.id,
      status: schema.captures.status,
      updatedAt: schema.captures.updatedAt,
      projectId: schema.pages.projectId,
    })
    .from(schema.captures)
    .innerJoin(schema.pages, eq(schema.captures.pageId, schema.pages.id))
    .where(inArray(schema.captures.status, ["pending", "capturing"]));

  const report: SweepReport = { projects: 0, pending: 0, stale: 0, retried: 0, scheduled: 0 };
  const projects = new Set<string>();
  const stale: typeof open = [];
  for (const row of open) {
    const state = captureAttemptState(row, now);
    if (state === "pending") {
      report.pending += 1;
      projects.add(row.projectId);
    } else if (state === "stale") {
      report.stale += 1;
      projects.add(row.projectId);
      stale.push(row);
    }
  }
  report.projects = projects.size;
  if (!serverCaptureEnabled()) return report;

  for (const row of stale) {
    const retried = await scheduleAutomaticRetry(db, row.id, { ...deps, now: () => now });
    if (retried.created) report.retried += 1;
  }
  for (const projectId of [...projects].sort()) {
    const driven = await driveProject(db, projectId, deps);
    report.scheduled += driven.scheduled.length;
  }
  return report;
}
