// @vitest-environment jsdom
// Component tests for the editor's Archive control (D108, D110): it asks
// once inline before acting, sends the CSRF proof to the archive route,
// tells the workspace to re-read on success, and keeps the project (and
// says so) when the request fails.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ArchiveProjectControl } from "../src/components/archive-project";
import { EDITOR_CSRF_COOKIE, EDITOR_CSRF_HEADER } from "../src/lib/auth-constants";

let fetchMock: ReturnType<typeof vi.fn>;
let answer: number;

beforeEach(() => {
  answer = 200;
  fetchMock = vi.fn((url: unknown, init?: RequestInit) => {
    const target = String(url);
    if (!target.endsWith("/api/projects/pub-1/archive") || init?.method !== "POST") {
      return Promise.reject(new Error(`unexpected fetch: ${init?.method} ${target}`));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ archived: { publicId: "pub-1", archivedAt: 1 } }), {
        status: answer,
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  document.cookie = `${EDITOR_CSRF_COOKIE}=editor-proof-sentinel`;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = `${EDITOR_CSRF_COOKIE}=; Max-Age=0`;
});

describe("ArchiveProjectControl", () => {
  test("asks before archiving, and Cancel sends nothing", async () => {
    const user = userEvent.setup();
    const onArchived = vi.fn();
    render(<ArchiveProjectControl publicId="pub-1" projectTitle="A-OK" onArchived={onArchived} />);

    await user.click(screen.getByRole("button", { name: "Archive A-OK" }));
    expect(screen.getByText(/Archive A-OK\? It leaves the project list/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onArchived).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Archive A-OK" })).toHaveFocus();
  });

  test("Confirm posts with the CSRF proof and tells the workspace to re-read", async () => {
    const user = userEvent.setup();
    const onArchived = vi.fn();
    render(<ArchiveProjectControl publicId="pub-1" projectTitle="A-OK" onArchived={onArchived} />);

    await user.click(screen.getByRole("button", { name: "Archive A-OK" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)[EDITOR_CSRF_HEADER]).toBe(
      "editor-proof-sentinel",
    );
    expect(onArchived).toHaveBeenCalledTimes(1);
  });

  test("a failed archive says so and keeps the project", async () => {
    answer = 503;
    const user = userEvent.setup();
    const onArchived = vi.fn();
    render(<ArchiveProjectControl publicId="pub-1" projectTitle="A-OK" onArchived={onArchived} />);

    await user.click(screen.getByRole("button", { name: "Archive A-OK" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(screen.getByRole("alert")).toHaveTextContent("could not be archived");
    expect(onArchived).not.toHaveBeenCalled();
  });
});
