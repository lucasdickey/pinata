// The persistent capture-attempt status model: legal states, computed
// staleness, scoped retryability, and deterministic newest-first selection so
// a late old result can never become the active version
// (VAL-PROJECT-005, VAL-CAPTURE-008).

import { describe, expect, test } from "vitest";
import { STALE_CAPTURE_AGE_MS } from "../../src/lib/boundaries";
import {
  captureAttemptState,
  isTerminalCaptureState,
  selectActiveAttempt,
  summarizeVariant,
  type CaptureAttemptRecord,
} from "../../src/lib/server/captures/status";

const T0 = 1_800_000_000_000;

function attempt(overrides: Partial<CaptureAttemptRecord> = {}): CaptureAttemptRecord {
  return {
    id: "capture-1",
    variant: "desktop",
    attempt: 1,
    status: "pending",
    errorCode: null,
    imageHash: null,
    documentWidth: null,
    documentHeight: null,
    capturedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe("captureAttemptState", () => {
  test.each([
    ["pending", "pending"],
    ["ready", "ready"],
    ["failed", "failed"],
  ])("%s is reported as-is", (status, expected) => {
    expect(captureAttemptState(attempt({ status }), T0)).toBe(expected);
  });

  test("a fresh capturing attempt is capturing", () => {
    const row = attempt({ status: "capturing", updatedAt: T0 });
    expect(captureAttemptState(row, T0 + STALE_CAPTURE_AGE_MS)).toBe("capturing");
  });

  test("a capturing attempt past the published age computes to stale", () => {
    const row = attempt({ status: "capturing", updatedAt: T0 });
    expect(captureAttemptState(row, T0 + STALE_CAPTURE_AGE_MS + 1)).toBe("stale");
  });

  test("staleness never rewrites a terminal attempt", () => {
    const ready = attempt({ status: "ready", updatedAt: T0 });
    const failed = attempt({ status: "failed", updatedAt: T0 });
    const later = T0 + STALE_CAPTURE_AGE_MS * 10;
    expect(captureAttemptState(ready, later)).toBe("ready");
    expect(captureAttemptState(failed, later)).toBe("failed");
  });

  test("only ready and failed are terminal", () => {
    expect(isTerminalCaptureState("ready")).toBe(true);
    expect(isTerminalCaptureState("failed")).toBe(true);
    expect(isTerminalCaptureState("pending")).toBe(false);
    expect(isTerminalCaptureState("capturing")).toBe(false);
    expect(isTerminalCaptureState("stale")).toBe(false);
  });
});

describe("selectActiveAttempt", () => {
  test("no ready attempt selects nothing", () => {
    const rows = [attempt({ id: "a", attempt: 1, status: "failed" }), attempt({ id: "b", attempt: 2 })];
    expect(selectActiveAttempt(rows, T0)).toBeNull();
  });

  test("the newest ready attempt wins regardless of row order", () => {
    const rows = [
      attempt({ id: "new", attempt: 3, status: "ready" }),
      attempt({ id: "old", attempt: 1, status: "ready" }),
      attempt({ id: "mid", attempt: 2, status: "failed" }),
    ];
    expect(selectActiveAttempt(rows, T0)?.id).toBe("new");
    expect(selectActiveAttempt([...rows].reverse(), T0)?.id).toBe("new");
  });

  test("a late old ready result cannot displace a newer ready attempt", () => {
    const newer = attempt({ id: "new", attempt: 2, status: "ready", updatedAt: T0 });
    // The stale attempt 1 finishes ten minutes later; its updatedAt is the
    // most recent of the two, but selection is by attempt version, not clock.
    const lateOld = attempt({ id: "old", attempt: 1, status: "ready", updatedAt: T0 + 600_000 });
    expect(selectActiveAttempt([newer, lateOld], T0 + 600_001)?.id).toBe("new");
  });

  test("a newer pending attempt does not hide the prior ready default", () => {
    const rows = [
      attempt({ id: "ready-1", attempt: 1, status: "ready" }),
      attempt({ id: "pending-2", attempt: 2, status: "pending" }),
    ];
    expect(selectActiveAttempt(rows, T0)?.id).toBe("ready-1");
  });
});

describe("summarizeVariant", () => {
  test("orders attempts newest-first and reports the latest attempt", () => {
    const rows = [
      attempt({ id: "a1", attempt: 1, status: "ready" }),
      attempt({ id: "a2", attempt: 2, status: "failed", errorCode: "total-timeout" }),
    ];
    const summary = summarizeVariant("desktop", rows, T0);
    expect(summary.attempts.map((a) => a.attempt)).toEqual([2, 1]);
    expect(summary.latest?.id).toBe("a2");
    expect(summary.latest?.state).toBe("failed");
  });

  test("a failed newer attempt leaves the older ready capture usable", () => {
    const rows = [
      attempt({ id: "a1", attempt: 1, status: "ready", imageHash: "hash-1" }),
      attempt({ id: "a2", attempt: 2, status: "failed", errorCode: "total-timeout" }),
    ];
    const summary = summarizeVariant("desktop", rows, T0);
    expect(summary.selectedCaptureId).toBe("a1");
    expect(summary.usable).toBe(true);
    expect(summary.retryable).toBe(true);
  });

  test("an in-flight attempt is not retryable until it computes stale", () => {
    const rows = [attempt({ id: "a1", attempt: 1, status: "capturing", updatedAt: T0 })];
    expect(summarizeVariant("desktop", rows, T0 + STALE_CAPTURE_AGE_MS).retryable).toBe(false);
    const stale = summarizeVariant("desktop", rows, T0 + STALE_CAPTURE_AGE_MS + 1);
    expect(stale.retryable).toBe(true);
    expect(stale.latest?.state).toBe("stale");
  });

  test("a pending attempt is never retryable and never annotatable", () => {
    const summary = summarizeVariant("mobile", [attempt({ status: "pending" })], T0);
    expect(summary.retryable).toBe(false);
    expect(summary.usable).toBe(false);
    expect(summary.selectedCaptureId).toBeNull();
  });

  test("a ready attempt may be recaptured", () => {
    const summary = summarizeVariant("mobile", [attempt({ status: "ready" })], T0);
    expect(summary.retryable).toBe(true);
    expect(summary.usable).toBe(true);
  });

  test("an outcome the catalog marks non-retryable offers no retry", () => {
    const rows = [attempt({ id: "a1", attempt: 1, status: "failed", errorCode: "document-too-tall" })];
    const summary = summarizeVariant("desktop", rows, T0);
    expect(summary.retryable).toBe(false);
    expect(summary.latest?.errorCode).toBe("document-too-tall");
  });

  test("a variant with no attempt row at all is an empty non-retryable state", () => {
    const summary = summarizeVariant("mobile", [], T0);
    expect(summary.attempts).toEqual([]);
    expect(summary.latest).toBeNull();
    expect(summary.retryable).toBe(false);
    expect(summary.usable).toBe(false);
  });

  test("natural document dimensions ride along to the view, null until ready", () => {
    // The canvas needs the persisted document dimensions to size its
    // screenshot parent node before any image byte reaches the browser.
    const rows = [
      attempt({
        id: "a1",
        attempt: 1,
        status: "ready",
        documentWidth: 1440,
        documentHeight: 8966,
      }),
      attempt({ id: "a2", attempt: 2, status: "pending" }),
    ];
    const summary = summarizeVariant("desktop", rows, T0);
    const ready = summary.attempts.find((a) => a.id === "a1");
    expect(ready?.documentWidth).toBe(1440);
    expect(ready?.documentHeight).toBe(8966);
    const pending = summary.attempts.find((a) => a.id === "a2");
    expect(pending?.documentWidth).toBeNull();
    expect(pending?.documentHeight).toBeNull();
  });
});
