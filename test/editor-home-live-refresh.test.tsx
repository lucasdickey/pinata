// @vitest-environment jsdom
// The editor's live refresh (D097), wired through EditorHome: with nothing
// capturing, a visible tab still re-reads the hierarchy and the shown
// project's pins every LIVE_REFRESH_INTERVAL_MS so a founder's reply shows up
// without a reload; a hidden tab reads nothing; a failed background read
// never replaces the workspace with the failure state; choosing Person review
// reads capability status once, never on a background refresh.

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    if (/\/agent-link$/.test(url)) {
      return Promise.resolve(
        Response.json({ link: { state: "none", version: 0, revokedAt: null } }),
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
    expect(shareReads()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(screen.getByRole("tab", { name: "Person review" }));
    await act(async () => {});
    expect(shareReads()).toBe(1);
    await tick(LIVE_REFRESH_INTERVAL_MS);
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
  test.each(["failed", "successful"] as const)(
    "a later %s quiet read orders an earlier pending response",
    async (outcome) => {
      const view = render(<EditorHome liveRefreshMs={1_000} />);
      await act(async () => {});
      const fetchNow = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
      let finishRefresh!: (response: Response) => void;
      const firstRead = new Promise<Response>((resolve) => {
        finishRefresh = resolve;
      });
      let reads = 0;
      fetchMock.mockImplementation((url: string) => {
        if (url === "/api/projects") {
          reads += 1;
          return reads === 1
            ? firstRead
            : outcome === "failed"
              ? Promise.reject(new Error("newer refresh failed"))
              : Promise.resolve(Response.json({
                  projects: [{
                    ...settledProject(),
                    projectId: "p3",
                    publicId: "pub3",
                    title: "Newer review",
                  }],
                }));
        }
        return fetchNow(url);
      });

      await act(async () => window.dispatchEvent(new Event("focus")));
      expect(reads).toBe(1);
      view.rerender(<EditorHome liveRefreshMs={2_000} />);
      await act(async () => window.dispatchEvent(new Event("focus")));
      expect(reads).toBe(2);
      await act(async () =>
        finishRefresh(Response.json({
          projects: [{
            ...settledProject(),
            projectId: "p2",
            publicId: "pub2",
            title: "Current review",
          }],
        })),
      );
      expect(screen.getByTestId("project-title")).toHaveTextContent(
        outcome === "failed" ? "Current review" : "Newer review",
      );
    },
  );

  test.each(["success", "failure"] as const)(
    "a live refresh started before Send closes cannot undo the newer reload's %s",
    async (outcome) => {
      render(<EditorHome />);
      await act(async () => {});
      const fetchNow = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
      let finishRefresh!: (response: Response) => void;
      const oldRead = new Promise<Response>((resolve) => {
        finishRefresh = resolve;
      });
      let reads = 0;
      fetchMock.mockImplementation((url: string) => {
        if (url === "/api/projects") {
          reads += 1;
          return reads === 1
            ? oldRead
            : outcome === "success"
              ? Promise.resolve(Response.json({
                  projects: [{
                    ...settledProject(),
                    projectId: "p2",
                    publicId: "pub2",
                    title: "Current review",
                  }],
                }))
              : Promise.reject(new Error("reload failed"));
        }
        return fetchNow(url);
      });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await tick(LIVE_REFRESH_INTERVAL_MS);
      expect(reads).toBe(1);
      fireEvent.click(screen.getByRole("button", { name: "Close Send" }));
      await act(async () => {});
      expect(reads).toBe(2);
      if (outcome === "success") {
        expect(screen.getByTestId("project-title")).toHaveTextContent("Current review");
      } else {
        expect(screen.getByRole("alert")).toHaveTextContent("Projects could not be loaded");
      }

      await act(async () => finishRefresh(Response.json({ projects: [settledProject()] })));
      if (outcome === "success") {
        expect(screen.getByTestId("project-title")).toHaveTextContent("Current review");
      } else {
        expect(screen.getByRole("alert")).toHaveTextContent("Projects could not be loaded");
      }
    },
  );
  test.each(["rejected", "non-OK", "successful"] as const)(
    "a %s live refresh orders against the pending hierarchy read after Send closes",
    async (outcome) => {
      render(<EditorHome />);
      await act(async () => {});
      const fetchNow = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
      let finishLoad!: (response: Response) => void;
      const pendingLoad = new Promise<Response>((resolve) => {
        finishLoad = resolve;
      });
      let reads = 0;
      fetchMock.mockImplementation((url: string) => {
        if (url === "/api/projects") {
          reads += 1;
          return reads === 1
            ? pendingLoad
            : outcome === "rejected"
              ? Promise.reject(new Error("refresh failed"))
              : outcome === "non-OK"
                ? Promise.resolve(Response.json({ error: "Unavailable" }, { status: 503 }))
                : Promise.resolve(Response.json({
                    projects: [{
                      ...settledProject(),
                      projectId: "p3",
                      publicId: "pub3",
                      title: "Newer review",
                    }],
                  }));
        }
        return fetchNow(url);
      });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      fireEvent.click(screen.getByRole("button", { name: "Close Send" }));
      await act(async () => {});
      expect(reads).toBe(1);

      await tick(LIVE_REFRESH_INTERVAL_MS);
      expect(reads).toBe(2);
      const expected = outcome === "successful" ? "Newer review" : "Current review";
      await act(async () =>
        finishLoad(Response.json({
          projects: [
            {
              ...settledProject(),
              projectId: "p2",
              publicId: "pub2",
              title: "Current review",
            },
          ],
        })),
      );
      expect(screen.getByTestId("project-title")).toHaveTextContent(expected);
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(screen.getByRole("dialog", { name: `Send ${expected}` })).toBeInTheDocument();
    },
  );

  test("the interval is injectable", async () => {
    render(<EditorHome liveRefreshMs={5_000} />);
    await act(async () => {});
    await tick(5_000);
    expect(hierarchyReads()).toBe(2);
  });

  test("header and documentation exits stay unavailable until a Send issue resolves", async () => {
    render(<EditorHome />);
    await act(async () => {});
    const fetchNow = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
    let finishIssue!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finishIssue = resolve;
    });
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url === "/api/projects/pub1/agent-link" && init?.method === "POST"
        ? pending
        : fetchNow(url),
    );

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
    const home = screen.getByRole("link", { name: "pinata" });
    expect(home).toHaveAttribute("aria-disabled", "true");
    expect(fireEvent.click(home)).toBe(false);
    expect(document.querySelector(".app-footer")).toHaveAttribute("inert");

    await act(async () => {
      finishIssue(Response.json({ link: { state: "active", version: 1 }, path: "/a/new-agent" }));
    });
    expect(screen.getByLabelText(/Agent link \(shown once/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(home).toHaveAttribute("aria-disabled", "false");
    expect(document.querySelector(".app-footer")).not.toHaveAttribute("inert");
  });
});
