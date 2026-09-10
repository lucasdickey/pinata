// @vitest-environment jsdom
// The editor dispatch driver, wired (VAL-CAPTURE-007's client half): loading
// the editor with committed pending attempts dispatches them through the
// scoped dispatch route without any manual call, at most MAX_ACTIVE_CAPTURES
// at a time; a quota-exceeded answer leaves the attempt pending and the
// polling loop re-drives it; a terminal dispatch outcome is surfaced by the
// next hierarchy read and never re-dispatched; and a conflict (another client
// claimed the attempt) settles into observation, not a retry storm.
//
// The fetch double below models the server truthfully: a dispatch answer
// changes the attempt's stored state (a 200 means the row is ready, a catalog
// failure means the row failed, a conflict means another client claimed it,
// and quota-exceeded leaves it pending), and every hierarchy GET reads that
// state back — the same durability the real routes provide.

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CAPTURE_POLL_INITIAL_INTERVAL_MS,
  MAX_ACTIVE_CAPTURES,
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

type State = AttemptView["state"];
type DispatchHandler = (
  captureId: string,
  setState: (state: State) => void,
) => Promise<Response> | Response;

let fetchMock: ReturnType<typeof vi.fn>;
let dispatchCalls: string[];
let states: Record<string, State>;

function attempt(id: string, state: State): AttemptView {
  return {
    id,
    variant: "desktop",
    attempt: 1,
    state,
    errorCode: state === "failed" ? "dns-failed" : null,
    imageHash: state === "ready" ? "a".repeat(64) : null,
    documentWidth: null,
    documentHeight: null,
  };
}

function device(variant: string, attempts: AttemptView[]): DeviceView {
  const latest = attempts[0] ?? null;
  return {
    variant,
    attempts,
    latest,
    selectedCaptureId: latest?.state === "ready" ? latest.id : null,
    selectedAttempt: latest?.state === "ready" ? latest.attempt : null,
    usable: latest?.state === "ready",
    retryable: latest ? ["ready", "failed", "stale"].includes(latest.state) : false,
  };
}

/** One project whose two pages each expose a desktop and a mobile device. */
function hierarchy(): WorkspaceProject[] {
  const statesOf = (page: string): DeviceView[] => [
    device("desktop", [attempt(`${page}-desktop`, states[`${page}-desktop`] ?? "pending")]),
    device("mobile", [attempt(`${page}-mobile`, states[`${page}-mobile`] ?? "pending")]),
  ];
  return [
    {
      projectId: "p1",
      publicId: "pub1",
      title: "Review",
      rootUrl: "https://safe.example/",
      pages: [
        { id: "page-1", normalizedUrl: "https://safe.example/", sortIndex: 0, devices: statesOf("p1") },
        { id: "page-2", normalizedUrl: "https://safe.example/two", sortIndex: 1, devices: statesOf("p2") },
      ],
      counts: { pages: 2, attempts: 4, ready: 0, failed: 0, inProgress: 4 },
    },
  ];
}

const ALL_PENDING: Record<string, State> = {
  "p1-desktop": "pending",
  "p1-mobile": "pending",
  "p2-desktop": "pending",
  "p2-mobile": "pending",
};

/**
 * Route the read-only hierarchy GET and the dispatch POST apart. Every GET
 * re-reads the current state; every POST is recorded and answered by the
 * scenario's handler, which may move the attempt's stored state.
 */
function serve(onDispatch: DispatchHandler): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "GET") {
      const match = /\/api\/captures\/([^/]+)\/dispatch/.exec(url);
      if (!match) return Promise.resolve(new Response(null, { status: 405 }));
      const captureId = decodeURIComponent(match[1]!);
      dispatchCalls.push(captureId);
      return onDispatch(captureId, (state) => {
        states[captureId] = state;
      });
    }
    return Promise.resolve(Response.json({ projects: hierarchy() }));
  });
}

const quotaResponse = () =>
  Response.json(
    { error: "quota", code: "quota-exceeded", remediation: "wait" },
    { status: 429 },
  );

async function flush(): Promise<void> {
  await act(async () => {});
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Flush until the dispatch → re-read → next-batch chain quiesces. React
 * processes one effect generation per act under fake timers, and a settled
 * dispatch re-reads the hierarchy before driving the next pending attempt,
 * so a fixed small number of flushes walks the chain to its end.
 */
async function settleDispatches(): Promise<void> {
  for (let i = 0; i < 8; i++) await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  dispatchCalls = [];
  states = { ...ALL_PENDING };
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("capture dispatch driver", () => {
  test("loading the editor with pending attempts dispatches them, capped at the lease limit", async () => {
    const held = new Map<string, () => void>();
    serve((captureId, setState) => {
      return new Promise<Response>((resolve) =>
        held.set(captureId, () => {
          setState("ready");
          resolve(Response.json({ capture: {} }, { status: 200 }));
        }),
      );
    });
    render(<EditorHome />);
    await flush();

    // Four pending attempts, but only the published cap are in flight.
    expect(dispatchCalls).toEqual(["p1-desktop", "p1-mobile"]);

    // Every dispatch is the scoped POST route carrying the CSRF header.
    for (const call of fetchMock.mock.calls) {
      if (((call[1] as RequestInit | undefined)?.method ?? "GET") === "POST") {
        expect(String(call[0])).toMatch(/^\/api\/captures\/[^/]+\/dispatch$/);
        expect((call[1] as RequestInit).headers).toHaveProperty("x-pinata-csrf");
      }
    }

    // A re-read while both are still in flight dispatches nothing more.
    await tick(CAPTURE_POLL_INITIAL_INTERVAL_MS);
    expect(dispatchCalls).toHaveLength(MAX_ACTIVE_CAPTURES);

    // One dispatch finalizes: the driver re-reads and drives the next
    // pending attempt without ever exceeding the cap.
    held.get("p1-desktop")!();
    await flush();
    expect(dispatchCalls).toEqual(["p1-desktop", "p1-mobile", "p2-desktop"]);

    held.get("p1-mobile")!();
    await flush();
    expect(dispatchCalls).toEqual(["p1-desktop", "p1-mobile", "p2-desktop", "p2-mobile"]);
    expect(states).toEqual({
      "p1-desktop": "ready",
      "p1-mobile": "ready",
      "p2-desktop": "pending",
      "p2-mobile": "pending",
    });
  });

  test("quota-exceeded leaves the attempt pending and the polling loop re-drives it", async () => {
    serve(() => quotaResponse());
    render(<EditorHome />);
    await flush();
    expect(dispatchCalls).toEqual(["p1-desktop", "p1-mobile"]);
    expect(Object.values(states).every((state) => state === "pending")).toBe(true);

    // No busy loop: the deferred attempts are not re-driven until the next
    // poll tick, and the poll itself stays on the published schedule.
    await tick(CAPTURE_POLL_INITIAL_INTERVAL_MS - 1);
    expect(dispatchCalls).toHaveLength(MAX_ACTIVE_CAPTURES);
    await tick(1);
    await flush();
    expect(dispatchCalls).toEqual(["p1-desktop", "p1-mobile", "p1-desktop", "p1-mobile"]);
  });

  test("a terminal dispatch outcome is surfaced and never re-dispatched", async () => {
    serve((_captureId, setState) => {
      setState("failed");
      return Response.json(
        {
          error: "The address could not be resolved to a public host.",
          code: "dns-failed",
          remediation: "Check the domain resolves publicly, then retry.",
        },
        { status: 502 },
      );
    });
    render(<EditorHome />);
    await settleDispatches();

    // Every attempt was dispatched exactly once; once the re-read shows all
    // four terminal, nothing is ever dispatched again.
    expect(dispatchCalls).toHaveLength(4);
    await tick(CAPTURE_POLL_INITIAL_INTERVAL_MS * 4);
    await flush();
    expect(dispatchCalls).toHaveLength(4);
    expect(Object.values(states).every((state) => state === "failed")).toBe(true);

    // The catalog outcome is what the workspace surfaces.
    expect(
      screen.getByText("The address could not be resolved to a public host."),
    ).toBeInTheDocument();
  });

  test("a conflict means another client claimed the attempt: observe, never storm", async () => {
    serve((_captureId, setState) => {
      // The other client's claim is already committed, so the re-read shows
      // the attempt as capturing.
      setState("capturing");
      return Response.json({ error: "rejected" }, { status: 409 });
    });
    render(<EditorHome />);
    await settleDispatches();

    // One dispatch per attempt; the re-read shows all four claimed, and the
    // driver stands down instead of storming the fence.
    expect(dispatchCalls).toHaveLength(4);
    await tick(CAPTURE_POLL_INITIAL_INTERVAL_MS * 3);
    await flush();
    expect(dispatchCalls).toHaveLength(4);
  });

  test("a settled hierarchy dispatches nothing", async () => {
    states = {
      "p1-desktop": "ready",
      "p1-mobile": "ready",
      "p2-desktop": "failed",
      "p2-mobile": "stale",
    };
    serve(() => quotaResponse());
    render(<EditorHome />);
    await flush();
    await tick(CAPTURE_POLL_INITIAL_INTERVAL_MS * 3);
    expect(dispatchCalls).toEqual([]);
  });
});
