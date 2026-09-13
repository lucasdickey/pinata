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

/**
 * Local and test switch: `PINATA_SERVER_CAPTURE=off` turns server
 * continuation off — nothing is scheduled after create, retry, or a
 * finalized attempt, and the sweep only counts. The dispatch route keeps
 * working, so the client fallback driver behaves exactly as before. Any
 * other value, or the variable unset, means on. Never set it on a
 * deployment; the Playwright server runs with it off so a spec that creates
 * a project cannot start real captures behind the browser's back.
 */
export const SERVER_CAPTURE_SWITCH = "PINATA_SERVER_CAPTURE";

export function serverCaptureEnabled(
  env: { PINATA_SERVER_CAPTURE?: string | undefined; [key: string]: string | undefined } = process.env,
): boolean {
  return env.PINATA_SERVER_CAPTURE !== "off";
}

let override: ContinuationScheduler | null = null;

function defaultScheduler(task: () => Promise<void>): void {
  try {
    nextAfter(task);
  } catch {
    // Outside a request scope: nothing to continue here.
  }
}

/** Schedules nothing: what every caller gets while the switch is off. */
function inertScheduler(): void {}

/** The process-wide scheduler, or whatever a test injected; inert when off. */
export function getContinuationScheduler(): ContinuationScheduler {
  if (!serverCaptureEnabled()) return inertScheduler;
  return override ?? defaultScheduler;
}

export function __setContinuationSchedulerForTests(
  scheduler: ContinuationScheduler | null,
): void {
  override = scheduler;
}
