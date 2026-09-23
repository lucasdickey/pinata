// @vitest-environment jsdom
// The editor's live refresh (D097), wired through EditorHome: with nothing
// capturing, a visible tab still re-reads the hierarchy and the shown
// project's pins every LIVE_REFRESH_INTERVAL_MS so a founder's reply shows up
// without a reload; a hidden tab reads nothing; a failed background read
// never replaces the workspace with the failure state; and the share
// control's status read stays the single read it was (D075, D089).

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EditorHome } from "../src/components/editor-home";
import type { WorkspaceProject } from "../src/components/project-workspace";
import { LIVE_REFRESH_INTERVAL_MS } from "../src/lib/live-refresh";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

let fetchMock: ReturnType<typeof vi.fn>;
let hierarchyStatus: number;
let unread: number;

function settledProject(): WorkspaceProject {
  const attempt = {
    id: "cap-1",
    variant: "desktop",
    attempt: 1,
    state: "ready" as const,
    errorCode: null,
    imageHash: "a".repeat(64),
    documentWidth: 1440,
    documentHeight: 900,
  };
  const device = {
    variant: "desktop",
    attempts: [attempt],
    latest: attempt,
    selectedCaptureId: "cap-1",
    selectedAttempt: 1,
    usable: true,
    retryable: true,
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
        devices: [
          device,
          {
            ...device,
            variant: "mobile",
            attempts: [],
            latest: null,
            selectedCaptureId: null,
            selectedAttempt: null,
            usable: false,
          },
        ],
      },
    ],
    counts: { pages: 1, attempts: 1, ready: 1, failed: 0, inProgress: 0 },
    feedback: { pins: 1, open: 1, resolved: 0, unreadReplies: unread },
    captureFeedback: { "cap-1": { pins: 1, open: 1, resolved: 0, unreadReplies: unread } },
  };
}

const isGet = (call: unknown[]) =>
  ((call[1] as RequestInit | undefined)?.method ?? "GET") === "GET";
const count = (pattern: RegExp) =>
  fetchMock.mock.calls.filter((call) => isGet(call) && pattern.test(String(call[0]))).length;
const hierarchyReads = () => count(/^\/api\/projects$/);
const projectPinReads = () => count(/^\/api\/projects\/[^/]+\/annotations$/);
const shareReads = () => count(/^\/api\/projects\/[^/]+\/share$/);

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let visibility: DocumentVisibilityState;

beforeEach(() => {
  vi.useFakeTimers();
  hierarchyStatus = 200;
  unread = 0;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  fetchMock = vi.fn((url: string) => {
    if (/\/share$/.test(url)) {
      return Promise.resolve(
        Response.json({ share: { state: "none", version: 0, revokedAt: null } }),
      );
    }
    if (/\/annotations$/.test(url)) return Promise.resolve(Response.json({ annotations: [] }));
    if (url === "/api/projects") {
      return Promise.resolve(
        hierarchyStatus === 200
          ? Response.json({ projects: [settledProject()] })
          : Response.json({ error: "Service unavailable." }, { status: hierarchyStatus }),
      );
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe("editor live refresh (D097)", () => {
  test("a visible tab re-reads the hierarchy and the project's pins every interval, even with nothing capturing", async () => {
    render(<EditorHome />);
    await act(async () => {});
    expect(hierarchyReads()).toBe(1);
    const pinsAtStart = projectPinReads();

    await tick(LIVE_REFRESH_INTERVAL_MS - 1);
    expect(hierarchyReads()).toBe(1);
    await tick(1);
    expect(hierarchyReads()).toBe(2);
    expect(projectPinReads()).toBe(pinsAtStart + 1);

    // A founder reply lands: the next tick shows the unread count.
    unread = 1;
    await tick(LIVE_REFRESH_INTERVAL_MS);
    expect(hierarchyReads()).toBe(3);
    expect(screen.getByTestId("project-feedback")).toHaveTextContent("1 unread reply");
    // The share control still reads its status once (D075, D089).
    expect(shareReads()).toBe(1);
  });

  test("a hidden tab reads nothing; coming back reads at once", async () => {
    render(<EditorHome />);
    await act(async () => {});
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(LIVE_REFRESH_INTERVAL_MS * 5);
    expect(hierarchyReads()).toBe(1);
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(hierarchyReads()).toBe(2);
  });

  test("a failed background read leaves the workspace in place", async () => {
    render(<EditorHome />);
    await act(async () => {});
    hierarchyStatus = 503;
    await tick(LIVE_REFRESH_INTERVAL_MS);
    expect(hierarchyReads()).toBe(2);
    expect(screen.queryByText(/Projects could not be loaded/)).toBeNull();
    expect(screen.getByTestId("project-title")).toHaveTextContent("Review");
  });

  test("the interval is injectable", async () => {
    render(<EditorHome liveRefreshMs={5_000} />);
    await act(async () => {});
    await tick(5_000);
    expect(hierarchyReads()).toBe(2);
  });
});
