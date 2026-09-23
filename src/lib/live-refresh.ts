// Visibility-aware live refresh (D097). A founder's reply, or a status the
// other role changed, used to stay invisible until a reload: the editor's
// only timer was the capture poll, which stops once nothing is capturing,
// and the founder view had no timer at all. This module re-reads on a fixed
// cadence while the tab is visible, once more the moment the tab becomes
// visible again or the window regains focus, and not at all while hidden, so
// a tab left in the background costs nothing.
//
// It never overlaps itself: a tick that arrives while the previous read is
// still in flight is skipped rather than queued, so a slow network can never
// stack reads. What the read does is the caller's business; the callers keep
// their reads quiet (no loading states, no cleared drafts or selections).

import { useEffect, useRef } from "react";

/** How often a visible tab re-reads the feedback it shows. */
export const LIVE_REFRESH_INTERVAL_MS = 20_000;

export interface LiveRefreshOptions {
  /** The read to run; its promise settling ends the in-flight window. */
  run: () => Promise<unknown> | void;
  intervalMs?: number;
  /** Injected for tests; default to the global document and window. */
  doc?: Document;
  win?: Window;
}

/**
 * Start refreshing; returns the function that stops it. Pure DOM wiring so
 * the schedule is testable with fake timers and no React.
 */
export function startLiveRefresh({
  run,
  intervalMs = LIVE_REFRESH_INTERVAL_MS,
  doc = document,
  win = window,
}: LiveRefreshOptions): () => void {
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const tick = () => {
    if (stopped || inFlight || doc.visibilityState === "hidden") return;
    inFlight = true;
    let result: Promise<unknown> | void;
    try {
      result = run();
    } catch {
      inFlight = false;
      return;
    }
    Promise.resolve(result)
      .catch(() => {
        // A failed background read changes nothing; the next tick tries again.
      })
      .finally(() => {
        inFlight = false;
      });
  };

  const arm = () => {
    if (timer === null && doc.visibilityState !== "hidden") {
      timer = setInterval(tick, intervalMs);
    }
  };
  const disarm = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const onVisibility = () => {
    if (doc.visibilityState === "hidden") {
      disarm();
      return;
    }
    // Back in view: read now, then restart the cadence from here so the
    // next tick is a full interval away rather than wherever it was.
    disarm();
    tick();
    arm();
  };
  const onFocus = () => tick();

  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("focus", onFocus);
  arm();

  return () => {
    stopped = true;
    disarm();
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("focus", onFocus);
  };
}

/**
 * The React binding: refresh with the latest `run` while `enabled`. The
 * callback is read through a ref so a re-render never restarts the cadence.
 */
export function useLiveRefresh(
  run: () => Promise<unknown> | void,
  { enabled = true, intervalMs = LIVE_REFRESH_INTERVAL_MS }: { enabled?: boolean; intervalMs?: number } = {},
): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!enabled) return;
    return startLiveRefresh({ run: () => latest.current(), intervalMs });
  }, [enabled, intervalMs]);
}
