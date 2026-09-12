// Continuing capture work after a response has been written (D076).
//
// Next.js `after()` keeps a function alive past the response so the work it
// is handed still runs; that is what lets a project capture to completion
// with no browser tab open. It only works inside a request, which is where
// every route lives. Focused tests and scripts have no request scope, so
// the default scheduler drops the task there instead of throwing: nothing
// continues, the client fallback driver and the sweep route still cover the
// pending rows, and a test that wants the continuation injects a scheduler
// that runs it inline.

import { after as nextAfter } from "next/server";

/** Schedule one task to run once the current response has been sent. */
export type ContinuationScheduler = (task: () => Promise<void>) => void;

let override: ContinuationScheduler | null = null;

function defaultScheduler(task: () => Promise<void>): void {
  try {
    nextAfter(task);
  } catch {
    // Outside a request scope: nothing to continue here.
  }
}

/** The process-wide scheduler, or whatever a test injected. */
export function getContinuationScheduler(): ContinuationScheduler {
  return override ?? defaultScheduler;
}

export function __setContinuationSchedulerForTests(
  scheduler: ContinuationScheduler | null,
): void {
  override = scheduler;
}
