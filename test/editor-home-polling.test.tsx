// @vitest-environment jsdom
// Editor capture-progress polling, wired (VAL-CAPTURE-012): while an attempt
// is pending or capturing the editor re-reads the hierarchy on the published
// backoff schedule, stops as soon as every attempt is terminal or computed
// stale, stops at the published deadline, and — because polling is the
// hierarchy GET only — can never create or duplicate an attempt.

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CAPTURE_POLL_DEADLINE_MS,
  CAPTURE_POLL_INITIAL_INTERVAL_MS,
  CAPTURE_POLL_MAX_INTERVAL_MS,
} from "../src/lib/boundaries";
import { EditorHome } from "../src/components/editor-home";
import type {
  AttemptView,
  DeviceView,
  WorkspaceProject,
} from "../src/components/project-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

let fetchMock: ReturnType<typeof vi.fn>;

function attempt(state: AttemptView["state"]): AttemptView {
  return {
    id: "cap-1",
    variant: "desktop",
    attempt: 1,
    state,
    errorCode: state === "failed" ? "total-timeout" : null,
    imageHash: state === "ready" ? "a".repeat(64) : null,
  };
}

function projectWith(state: AttemptView["state"]): WorkspaceProject {
  const attempts = [attempt(state)];
  const device: DeviceView = {
    variant: "desktop",
    attempts,
    latest: attempts[0]!,
    selectedCaptureId: state === "ready" ? "cap-1" : null,
    selectedAttempt: state === "ready" ? 1 : null,
    usable: state === "ready",
    retryable: ["ready", "failed", "stale"].includes(state),
  };
  return {
    projectId: "p1",
    publicId: "pub1",
    title: "Review",
    rootUrl: "https://safe.example/",
    pages: [
      {
        id: "page-1",
        normalizedUrl: "https://safe.example/",
        sortIndex: 0,
        devices: [device, { ...device, variant: "mobile" }],
      },
    ],
    counts: { pages: 1, attempts: 2, ready: 0, failed: 0, inProgress: 0 },
  };
}

/** A fetch double answering the hierarchy GET from a queue of states. */
function queueStates(...states: AttemptView["state"][]): void {
  let index = 0;
  fetchMock.mockImplementation(() => {
    const state = states[Math.min(index, states.length - 1)]!;
    index += 1;
    return Promise.resolve(Response.json({ projects: [projectWith(state)] }));
  });
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function expectReadOnlyPolling(): void {
  // Polling must never create work: every call is the hierarchy GET.
  for (const call of fetchMock.mock.calls) {
    expect(call[0]).toBe("/api/projects");
    expect((call[1] as RequestInit | undefined)?.method ?? "GET").toBe("GET");
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("capture-progress polling", () => {
  test("polls on the published backoff schedule and stops when the capture is ready", async () => {
    queueStates("pending", "pending", "ready");
    render(<EditorHome />);
    await act(async () => {}); // the initial load
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Nothing before the published initial interval.
    await tick(CAPTURE_POLL_INITIAL_INTERVAL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The backoff doubled: the next poll is twice the initial interval out.
    await tick(CAPTURE_POLL_INITIAL_INTERVAL_MS * 2 - 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The last read returned all-ready: polling stopped for good.
    await tick(CAPTURE_POLL_DEADLINE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expectReadOnlyPolling();
  });

  test("polling stops when the attempt computes stale", async () => {
    queueStates("capturing", "stale");
    render(<EditorHome />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await tick(CAPTURE_POLL_INITIAL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await tick(CAPTURE_POLL_DEADLINE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectReadOnlyPolling();
  });

  test("polling stands down at the published deadline even while work looks unfinished", async () => {
    queueStates("pending");
    render(<EditorHome />);
    await act(async () => {});

    // A poll scheduled just before the deadline may still fire just after
    // it; two ceiling intervals past the deadline, the run is certainly done.
    // Advance in steps: each poll's effect must run (inside its own act)
    // before the next timer exists, so one giant tick would only fire the
    // timer already scheduled.
    for (
      let elapsed = 0;
      elapsed < CAPTURE_POLL_DEADLINE_MS + 2 * CAPTURE_POLL_MAX_INTERVAL_MS;
      elapsed += 10_000
    ) {
      await tick(10_000);
    }
    const pollsAtDeadline = fetchMock.mock.calls.length;
    // The run polled repeatedly, then stopped: one deadline later nothing
    // more is scheduled.
    expect(pollsAtDeadline).toBeGreaterThan(3);
    expect(pollsAtDeadline).toBeLessThan(200);
    await tick(CAPTURE_POLL_DEADLINE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(pollsAtDeadline);
    expectReadOnlyPolling();
  });

  test("a settled list never schedules a poll", async () => {
    queueStates("ready");
    render(<EditorHome />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(CAPTURE_POLL_DEADLINE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectReadOnlyPolling();
  });
});
