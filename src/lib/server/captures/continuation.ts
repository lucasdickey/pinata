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
import { SWEEP_SECRET_HEADER } from "./sweep-auth";

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

// ---- handoff to a fresh invocation (D095) -----------------------------------
// after() keeps work alive past the response, but only inside the same
// function invocation, and an invocation dies at its maxDuration. A project
// with more captures than fit one invocation's budget used to be killed mid
// chain and sat stale until the daily cron. When the drive sees too little
// budget left for one more capture, it hands the chain to a fresh invocation
// by calling the app's own sweep route, which re-drives every pending attempt
// under a new maxDuration.

/** Starts a fresh invocation that drives pending work; true when accepted. */
export type CaptureHandoff = () => Promise<boolean>;

/** Header Vercel Deployment Protection accepts from automation. */
export const PROTECTION_BYPASS_HEADER = "x-vercel-protection-bypass";

/** The sweep call only has to be accepted; the sweep answers once scheduled. */
const HANDOFF_TIMEOUT_MS = 10_000;

export interface HandoffEnv {
  VERCEL_URL?: string | undefined;
  CAPTURE_SWEEP_SECRET?: string | undefined;
  CRON_SECRET?: string | undefined;
  VERCEL_AUTOMATION_BYPASS_SECRET?: string | undefined;
  [key: string]: string | undefined;
}

/**
 * A handoff that POSTs this deployment's own sweep route, or null when the
 * environment has no deployment origin or no sweep secret — then the chain
 * is left, as before, to the client driver and the cron. VERCEL_URL names
 * this exact deployment, so the fresh invocation runs the same code. The
 * handoff never throws: a failed call answers false and the pending rows
 * stay where the other drivers find them.
 */
export function createSweepHandoff(
  env: HandoffEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = HANDOFF_TIMEOUT_MS,
): CaptureHandoff | null {
  const host = env.VERCEL_URL?.trim();
  if (!host) return null;
  const headers: Record<string, string> = {};
  if (env.CAPTURE_SWEEP_SECRET) headers[SWEEP_SECRET_HEADER] = env.CAPTURE_SWEEP_SECRET;
  else if (env.CRON_SECRET) headers.authorization = `Bearer ${env.CRON_SECRET}`;
  else return null;
  if (env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers[PROTECTION_BYPASS_HEADER] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const url = `https://${host}/api/captures/sweep`;
  return async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}
