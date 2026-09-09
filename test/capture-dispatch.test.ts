// Capture-dispatch driver policy (the client half of VAL-CAPTURE-007 and the
// capture-driver behavior): which committed `pending` attempts the editor
// dispatches, in what order, and how many may be in flight at once.
//
// The policy is pure and clock-injected so the published concurrency bound is
// testable without a browser: the batch never exceeds MAX_ACTIVE_CAPTURES
// in-flight dispatches, an attempt already dispatched or recently deferred is
// never dispatched twice, and a deferred attempt becomes eligible again once
// its re-drive delay has passed — which is how a quota-exceeded attempt gets
// re-driven as slots free without a busy loop.

import { describe, expect, test } from "vitest";
import { CAPTURE_POLL_INITIAL_INTERVAL_MS, MAX_ACTIVE_CAPTURES } from "../src/lib/boundaries";
import {
  CAPTURE_DISPATCH_REDRIVE_DELAY_MS,
  nextDispatchBatch,
  pendingDispatchTargets,
  type DispatchProjectView,
} from "../src/lib/capture-dispatch";

function project(
  pages: { id: string; devices: { variant: string; attempts: [string, string][] }[] }[],
): DispatchProjectView {
  return {
    pages: pages.map((page) => ({
      id: page.id,
      devices: page.devices.map((device) => ({
        variant: device.variant,
        attempts: device.attempts.map(([id, state], index) => ({
          id,
          state,
          attempt: page.devices.length + index,
        })),
      })),
    })),
  };
}

describe("pendingDispatchTargets", () => {
  test("collects every pending attempt in project, page, device order", () => {
    const projects = [
      project([
        {
          id: "page-1",
          devices: [
            { variant: "desktop", attempts: [["cap-d1", "pending"]] },
            { variant: "mobile", attempts: [["cap-m1", "pending"]] },
          ],
        },
        {
          id: "page-2",
          devices: [
            { variant: "desktop", attempts: [["cap-d2", "pending"]] },
            { variant: "mobile", attempts: [["cap-m2", "ready"]] },
          ],
        },
      ]),
      project([
        {
          id: "page-3",
          devices: [
            { variant: "desktop", attempts: [["cap-d3", "pending"]] },
            { variant: "mobile", attempts: [["cap-m3", "capturing"]] },
          ],
        },
      ]),
    ];
    expect(pendingDispatchTargets(projects)).toEqual([
      "cap-d1",
      "cap-m1",
      "cap-d2",
      "cap-d3",
    ]);
  });

  test("ignores terminal, capturing, and computed-stale attempts entirely", () => {
    const projects = [
      project([
        {
          id: "page-1",
          devices: [
            {
              variant: "desktop",
              attempts: [
                ["cap-ready", "ready"],
                ["cap-failed", "failed"],
                ["cap-stale", "stale"],
                ["cap-capturing", "capturing"],
              ],
            },
          ],
        },
      ]),
    ];
    expect(pendingDispatchTargets(projects)).toEqual([]);
  });

  test("an empty hierarchy yields no targets", () => {
    expect(pendingDispatchTargets([])).toEqual([]);
  });
});

describe("nextDispatchBatch", () => {
  const targets = ["a", "b", "c", "d"];

  test("never exceeds the published concurrency cap", () => {
    expect(MAX_ACTIVE_CAPTURES).toBe(2);
    const batch = nextDispatchBatch(targets, new Set(), new Map(), 1_000);
    expect(batch).toEqual(["a", "b"]);
    expect(batch.length).toBeLessThanOrEqual(MAX_ACTIVE_CAPTURES);
  });

  test("an in-flight attempt is never dispatched twice and still occupies its slot", () => {
    const batch = nextDispatchBatch(targets, new Set(["a"]), new Map(), 1_000);
    expect(batch).toEqual(["b"]);
  });

  test("a full in-flight set dispatches nothing", () => {
    const batch = nextDispatchBatch(targets, new Set(["x", "y"]), new Map(), 1_000);
    expect(batch).toEqual([]);
  });

  test("a deferred attempt waits out its re-drive delay, then becomes eligible", () => {
    const now = 10_000;
    const deferred = new Map([["a", now + CAPTURE_DISPATCH_REDRIVE_DELAY_MS]]);
    expect(nextDispatchBatch(targets, new Set(), deferred, now)).toEqual(["b", "c"]);
    expect(
      nextDispatchBatch(targets, new Set(), deferred, now + CAPTURE_DISPATCH_REDRIVE_DELAY_MS),
    ).toEqual(["a", "b"]);
  });

  test("the re-drive delay is the published initial poll interval, not a new constant", () => {
    expect(CAPTURE_DISPATCH_REDRIVE_DELAY_MS).toBe(CAPTURE_POLL_INITIAL_INTERVAL_MS);
  });
});
