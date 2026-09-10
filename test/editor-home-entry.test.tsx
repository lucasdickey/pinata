// @vitest-environment jsdom
// Editor project-entry states (VAL-AUTH-008, VAL-AUTH-009): the project list
// is an explicit state machine — loading, empty, populated, and failure are
// distinct and announced; a failed read offers one single-flight retry that
// issues exactly one GET and never touches the sign-out control; and the
// empty list offers exactly one route to the create form.
//
// Since the route split (D069) the create form itself lives at /pins/new,
// so what this surface owes is a single unambiguous link to it — the form's
// own behavior is covered by test/new-project-page.test.tsx.

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CAPTURE_POLL_INITIAL_INTERVAL_MS } from "../src/lib/boundaries";
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

function projectWith(state: AttemptView["state"]): WorkspaceProject {
  const attempt: AttemptView = {
    id: "cap-1",
    variant: "desktop",
    attempt: 1,
    state,
    errorCode: null,
    imageHash: null,
    documentWidth: null,
    documentHeight: null,
  };
  const device: DeviceView = {
    variant: "desktop",
    attempts: [attempt],
    latest: attempt,
    selectedCaptureId: null,
    selectedAttempt: null,
    usable: false,
    retryable: false,
  };
  return {
    projectId: "p1",
    publicId: "pub1",
    title: "Chickpea review",
    rootUrl: "https://chickpea.co/",
    pages: [
      {
        id: "page-1",
        normalizedUrl: "https://chickpea.co/",
        sortIndex: 0,
        devices: [device, { ...device, variant: "mobile" }],
      },
    ],
    counts: { pages: 1, attempts: 2, ready: 0, failed: 0, inProgress: 2 },
  };
}

async function flush(): Promise<void> {
  await act(async () => {});
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("editor project-entry states", () => {
  test("loading is a named, busy state distinct from empty and populated", async () => {
    let resolveLoad: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    render(<EditorHome />);

    // Loading: announced as a status, and the region reports itself busy.
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects");
    expect(
      screen.getByRole("region", { name: "Projects" }).getAttribute("aria-busy"),
    ).toBe("true");
    expect(screen.queryByText(/No projects yet/)).not.toBeInTheDocument();

    // Empty: the busy flag clears and the named empty state appears with
    // exactly one create action.
    resolveLoad(Response.json({ projects: [] }));
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Projects" }).getAttribute("aria-busy"),
    ).toBe("false");
    expect(screen.getByText(/No projects yet/)).toBeInTheDocument();
    // The header link is the standing route to the form; the empty state
    // adds the one inline prompt. Both point at /pins/new and nothing else
    // on this surface creates a project.
    expect(screen.getByRole("link", { name: "New project" })).toHaveAttribute(
      "href",
      "/pins/new",
    );
    expect(
      screen.getByRole("link", { name: /create your first project/i }),
    ).toHaveAttribute("href", "/pins/new");
  });

  test("a populated list names each project and keeps the single create action", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ projects: [projectWith("ready")] }));
    render(<EditorHome />);
    await flush();
    expect(
      screen.getByRole("heading", { name: "Chickpea review" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No projects yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "New project" })).toHaveLength(1);
  });

  test("a failed read offers one single-flight retry and keeps sign-out available", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    render(<EditorHome />);
    await flush();

    // Failure is its own announced state; logout survives it.
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(screen.queryByText(/No projects yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // The retry is single-flight: while it is in flight there is no second
    // control to press and pressing it cannot start another read.
    let resolveRetry: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveRetry = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    const inFlight = screen.getByRole("button", { name: "Retrying…" });
    expect(inFlight).toBeDisabled();
    fireEvent.click(inFlight);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // One retry, one read, and the recovered list replaces the failure.
    resolveRetry(Response.json({ projects: [] }));
    await flush();
    expect(screen.getByText(/No projects yet/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe("/api/projects");
      expect((call[1] as RequestInit | undefined)?.method ?? "GET").toBe("GET");
    }
  });

  test("a failed retry stays on the failure state and can be retried again", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    render(<EditorHome />);
    await flush();
    fetchMock.mockRejectedValueOnce(new Error("still down"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("a failed background read leaves the header controls intact", async () => {
    // A project with in-progress captures arms the polling timer; the next
    // scheduled read fails. The failure must stay confined to the list
    // region — the route to the create form and the sign-out control are
    // how the editor recovers, so a background error can never remove them.
    fetchMock.mockResolvedValueOnce(Response.json({ projects: [projectWith("pending")] }));
    render(<EditorHome />);
    await flush();

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await tick(CAPTURE_POLL_INITIAL_INTERVAL_MS);

    expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("link", { name: "New project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });
});
