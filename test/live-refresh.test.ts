// The live refresh schedule (D097), without React: a read every
// LIVE_REFRESH_INTERVAL_MS while the tab is visible, one at once when the tab
// becomes visible again or the window regains focus, nothing while hidden,
// never two reads at once, and nothing at all after stop.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LIVE_REFRESH_INTERVAL_MS, startLiveRefresh } from "../src/lib/live-refresh";

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
  show(state: DocumentVisibilityState) {
    this.visibilityState = state;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

let doc: FakeDocument;
let win: EventTarget;

beforeEach(() => {
  vi.useFakeTimers();
  doc = new FakeDocument();
  win = new EventTarget();
});

afterEach(() => {
  vi.useRealTimers();
});

function start(run: () => Promise<unknown> | void) {
  return startLiveRefresh({
    run,
    doc: doc as unknown as Document,
    win: win as unknown as Window,
  });
}

describe("startLiveRefresh", () => {
  test("the interval is a named 20 second constant", () => {
    expect(LIVE_REFRESH_INTERVAL_MS).toBe(20_000);
  });

  test("reads once per interval while visible, and not before", async () => {
    const run = vi.fn(() => Promise.resolve());
    const stop = start(run);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);
    expect(run).toHaveBeenCalledTimes(4);
    stop();
  });

  test("pauses while hidden and reads at once on becoming visible, then restarts the cadence", async () => {
    const run = vi.fn(() => Promise.resolve());
    const stop = start(run);
    doc.show("hidden");
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 5);
    expect(run).not.toHaveBeenCalled();
    doc.show("visible");
    expect(run).toHaveBeenCalledTimes(1);
    // The next read is a full interval after the one on return.
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  test("a hidden tab at start reads nothing until it is shown", async () => {
    doc.visibilityState = "hidden";
    const run = vi.fn(() => Promise.resolve());
    const stop = start(run);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 2);
    expect(run).not.toHaveBeenCalled();
    doc.show("visible");
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  test("window focus reads at once", () => {
    const run = vi.fn(() => Promise.resolve());
    const stop = start(run);
    win.dispatchEvent(new Event("focus"));
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  test("a tick while the previous read is in flight is skipped, not queued", async () => {
    let finish: () => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = start(run);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(1);
    // Focus and two more intervals while the first read hangs: all skipped.
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 2);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    win.dispatchEvent(new Event("focus"));
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  test("a failed read does not stop the schedule", async () => {
    const run = vi.fn(() => Promise.reject(new Error("offline")));
    const stop = start(run);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 2);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  test("stop ends the timer and the listeners", async () => {
    const run = vi.fn(() => Promise.resolve());
    const stop = start(run);
    stop();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 2);
    win.dispatchEvent(new Event("focus"));
    doc.show("hidden");
    doc.show("visible");
    expect(run).not.toHaveBeenCalled();
  });
});
