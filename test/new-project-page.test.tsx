// @vitest-environment jsdom
// The /pins/new surface (D069). The project form moved off the editor's
// working surface onto its own route, and two behaviors had to survive the
// move: the parked anonymous draft (VAL-LANDING-003, D067) is still consumed
// into the form exactly once, and a committed project still hands control
// back to /pins, where the dispatch driver picks the pending attempts up.

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CAPTURE_DRAFT_STORAGE_KEY } from "../src/lib/capture-draft";
import { NewProjectPage } from "../src/components/new-project-page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

let fetchMock: ReturnType<typeof vi.fn>;

async function flush(): Promise<void> {
  await act(async () => {});
}

beforeEach(() => {
  push.mockClear();
  sessionStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the new-project route", () => {
  test("renders the form and a route back to the workspace", async () => {
    render(<NewProjectPage />);
    await flush();
    expect(screen.getByLabelText("Root URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create project" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to pins" })).toHaveAttribute(
      "href",
      "/pins",
    );
  });

  test("a parked anonymous draft opens the form with the URLs retained, consumed once", async () => {
    sessionStorage.setItem(
      CAPTURE_DRAFT_STORAGE_KEY,
      JSON.stringify({
        rootUrl: "https://chickpea.co/",
        urls: ["https://chickpea.co/pricing"],
      }),
    );
    render(<NewProjectPage />);
    await flush();

    expect(screen.getByLabelText("Root URL")).toHaveValue("https://chickpea.co/");
    expect(screen.getByRole("textbox", { name: "URL 2" })).toHaveValue(
      "https://chickpea.co/pricing",
    );
    // Consumed, so a later reload cannot resurrect a stale draft.
    expect(sessionStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY)).toBeNull();
  });

  test("a committed project routes to /pins", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          project: {
            projectId: "p1",
            publicId: "pub1",
            title: "Chickpea review",
            rootUrl: "https://chickpea.co/",
            pages: [],
          },
        },
        { status: 201 },
      ),
    );
    render(<NewProjectPage />);
    await flush();

    fireEvent.change(screen.getByLabelText("Root URL"), {
      target: { value: "https://chickpea.co/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/pins"));
  });
});
