// The capture-progress polling state machine (VAL-CAPTURE-012).
//
// Polling re-reads the project hierarchy while attempts are in progress.
// These tests pin the published policy: exponential backoff from the shared
// initial interval up to the shared ceiling, a hard stop when every attempt
// is terminal or computed stale, and a hard stop at the published deadline.
// Polling never creates work — it is read-only by construction (the effect
// issues hierarchy GETs only), so "never duplicates attempts" is proven by
// the component-level fetch-shape test in editor-home-polling.test.tsx.

import { describe, expect, test } from "vitest";
import {
  CAPTURE_POLL_DEADLINE_MS,
  CAPTURE_POLL_INITIAL_INTERVAL_MS,
  CAPTURE_POLL_MAX_INTERVAL_MS,
} from "../src/lib/boundaries";
import {
  captureWorkInProgress,
  nextCapturePoll,
} from "../src/lib/capture-polling";

describe("backoff schedule", () => {
  test("the first poll waits the published initial interval", () => {
    const decision = nextCapturePoll({ inProgress: true, elapsedMs: 0, pollCount: 0 });
    expect(decision).toEqual({ action: "poll", delayMs: CAPTURE_POLL_INITIAL_INTERVAL_MS });
  });

  test("the delay doubles each poll until the published ceiling", () => {
    const delays: number[] = [];
    for (let pollCount = 0; pollCount < 8; pollCount += 1) {
      const decision = nextCapturePoll({ inProgress: true, elapsedMs: 0, pollCount });
      if (decision.action !== "poll") throw new Error("expected a poll decision");
      delays.push(decision.delayMs);
    }
    expect(delays).toEqual([2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000, 10_000]);
    expect(CAPTURE_POLL_MAX_INTERVAL_MS).toBe(10_000);
  });
});

describe("stop conditions", () => {
  test("polling stops the moment no attempt is in progress", () => {
    expect(nextCapturePoll({ inProgress: false, elapsedMs: 0, pollCount: 0 })).toEqual({
      action: "stop",
      reason: "settled",
    });
    // Settled wins even deep into a run.
    expect(nextCapturePoll({ inProgress: false, elapsedMs: 42_000, pollCount: 5 })).toEqual({
      action: "stop",
      reason: "settled",
    });
  });

  test("polling stops at the published deadline even with work outstanding", () => {
    const atDeadline = nextCapturePoll({
      inProgress: true,
      elapsedMs: CAPTURE_POLL_DEADLINE_MS,
      pollCount: 30,
    });
    expect(atDeadline).toEqual({ action: "stop", reason: "deadline" });
    // One millisecond before the deadline the run is still alive.
    expect(
      nextCapturePoll({
        inProgress: true,
        elapsedMs: CAPTURE_POLL_DEADLINE_MS - 1,
        pollCount: 30,
      }).action,
    ).toBe("poll");
  });
});

describe("in-progress detection", () => {
  test("only pending and capturing keep a poller alive", () => {
    expect(captureWorkInProgress([{ state: "pending" }])).toBe(true);
    expect(captureWorkInProgress([{ state: "capturing" }])).toBe(true);
    // Terminal and computed-stale states are stop states: a poller never
    // spins on a row that will not move again.
    for (const state of ["ready", "failed", "stale"]) {
      expect(captureWorkInProgress([{ state }])).toBe(false);
    }
    expect(captureWorkInProgress([])).toBe(false);
    expect(
      captureWorkInProgress([{ state: "ready" }, { state: "failed" }, { state: "stale" }]),
    ).toBe(false);
    expect(
      captureWorkInProgress([{ state: "ready" }, { state: "capturing" }]),
    ).toBe(true);
  });
});
