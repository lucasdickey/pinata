// @vitest-environment jsdom
// Component tests for "Add pages" on the project overview (D129): the card
// says how much room is left, opens a form in its place with the first row
// focused, finishes addresses against the project's root, posts with the
// CSRF proof, tells the workspace to re-read on success, and puts
// corrections and "already in this project" notes on the rows they belong to.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AddPagesCard, pageRoom } from "../src/components/add-pages";
import type { WorkspaceProject } from "../src/components/project-workspace";
import { EDITOR_CSRF_COOKIE, EDITOR_CSRF_HEADER } from "../src/lib/auth-constants";
import { MAX_CAPTURE_ATTEMPTS_PER_PROJECT, MAX_UNIQUE_PAGE_URLS } from "../src/lib/boundaries";

let fetchMock: ReturnType<typeof vi.fn>;
let reply: { status: number; body: unknown };

function project(pageCount: number, attempts = pageCount * 2): WorkspaceProject {
  return {
    projectId: "proj-1",
    publicId: "pub-1",
    title: "Northwind",
    rootUrl: "https://northwind.co/",
    pages: Array.from({ length: pageCount }, (_, i) => ({
      id: `page-${i}`,
      requestedUrl: `https://northwind.co/p${i}`,
      normalizedUrl: `https://northwind.co/p${i}`,
      sortIndex: i,
      devices: [],
    })),
    counts: { pages: pageCount, attempts, ready: attempts, failed: 0, inProgress: 0 },
  };
}

function renderCard(subject = project(2)) {
  const onAdded = vi.fn();
  render(
    <ul>
      <AddPagesCard project={subject} onAdded={onAdded} />
    </ul>,
  );
  return { onAdded };
}

beforeEach(() => {
  reply = {
    status: 201,
    body: { publicId: "pub-1", added: [{ id: "new-1", normalizedUrl: "https://northwind.co/pricing" }], skipped: [] },
  };
  fetchMock = vi.fn((url: unknown, init?: RequestInit) => {
    const target = String(url);
    if (!target.endsWith("/api/projects/pub-1/pages") || init?.method !== "POST") {
      return Promise.reject(new Error(`unexpected fetch: ${init?.method} ${target}`));
    }
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
  });
  vi.stubGlobal("fetch", fetchMock);
  document.cookie = `${EDITOR_CSRF_COOKIE}=editor-proof-sentinel`;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = `${EDITOR_CSRF_COOKIE}=; Max-Age=0`;
});

const sentBody = (call = 0) =>
  JSON.parse(String((fetchMock.mock.calls[call]![1] as RequestInit).body)) as {
    urls: string[];
    idempotencyKey: string;
  };

describe("pageRoom", () => {
  test("is the smaller of the pages left and the screenshots left, in pages", () => {
    expect(pageRoom(project(2))).toEqual({ room: MAX_UNIQUE_PAGE_URLS - 2, limit: "pages" });
    expect(pageRoom(project(2, MAX_CAPTURE_ATTEMPTS_PER_PROJECT - 5))).toEqual({
      room: 2,
      limit: "screenshots",
    });
    expect(pageRoom(project(MAX_UNIQUE_PAGE_URLS))).toEqual({ room: 0, limit: "pages" });
  });
});

describe("AddPagesCard", () => {
  test("the card names the room left and opens a form with its first row focused", async () => {
    const user = userEvent.setup();
    renderCard();
    const card = screen.getByRole("button", { name: "Add pages" });
    expect(card).toHaveAccessibleDescription(`Room for ${MAX_UNIQUE_PAGE_URLS - 2} more pages`);
    await user.click(card);
    expect(screen.getByRole("form", { name: "Add pages" })).toBeInTheDocument();
    expect(screen.getByLabelText("URL 1")).toHaveFocus();
  });

  test("Cancel and Escape send nothing and return focus to the card", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Add pages" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Add pages" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add pages" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Add pages" }));
    await user.type(screen.getByLabelText("URL 1"), "/about{Escape}");
    expect(screen.queryByRole("form", { name: "Add pages" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("finishes paths against the root, posts with the CSRF proof, and re-reads on success", async () => {
    const user = userEvent.setup();
    const { onAdded } = renderCard();
    await user.click(screen.getByRole("button", { name: "Add pages" }));
    await user.type(screen.getByLabelText("URL 1"), "/pricing");
    await user.click(screen.getByRole("button", { name: "Add another URL" }));
    expect(screen.getByLabelText("URL 2")).toHaveFocus();
    await user.type(screen.getByLabelText("URL 2"), "northwind.co/about");
    await user.click(screen.getByRole("button", { name: "Add pages" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)[EDITOR_CSRF_HEADER]).toBe("editor-proof-sentinel");
    expect(sentBody().urls).toEqual(["https://northwind.co/pricing", "https://northwind.co/about"]);
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("form", { name: "Add pages" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Added 1 page. Its screenshots are on the way.",
    );
  });

  test("says how many were skipped when some addresses were already pages", async () => {
    reply = {
      status: 201,
      body: {
        publicId: "pub-1",
        added: [{ id: "a" }, { id: "b" }],
        skipped: [2],
      },
    };
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Add pages" }));
    await user.type(screen.getByLabelText("URL 1"), "/a");
    await user.click(screen.getByRole("button", { name: "Add another URL" }));
    await user.type(screen.getByLabelText("URL 2"), "/b");
    await user.click(screen.getByRole("button", { name: "Add another URL" }));
    await user.type(screen.getByLabelText("URL 3"), "/p0");
    await user.click(screen.getByRole("button", { name: "Add pages" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Added 2 pages. Their screenshots are on the way. Skipped 1 already in this project.",
    );
  });

  test("when every address is already a page, the form stays open with a note on each row", async () => {
    reply = { status: 200, body: { publicId: "pub-1", added: [], skipped: [0] } };
    const user = userEvent.setup();
    const { onAdded } = renderCard();
    await user.click(screen.getByRole("button", { name: "Add pages" }));
    await user.type(screen.getByLabelText("URL 1"), "/p0");
    await user.click(screen.getByRole("button", { name: "Add page" }));
    expect(onAdded).not.toHaveBeenCalled();
    expect(screen.getByLabelText("URL 1")).toHaveAccessibleDescription("Already in this project.");
    expect(screen.getByText("Nothing to add: every address is already in this project.")).toBeInTheDocument();
  });

  test("corrections land on the rows that caused them; a credential is cleared", async () => {
    reply = {
      status: 422,
      body: { errors: [{ field: "urls", index: 1, code: "credentials" }] },
    };
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Add pages" }));
    await user.type(screen.getByLabelText("URL 1"), "/ok");
    await user.click(screen.getByRole("button", { name: "Add another URL" }));
    await user.type(screen.getByLabelText("URL 2"), "https://me:pw@northwind.co/");
    await user.click(screen.getByRole("button", { name: "Add pages" }));
    expect(screen.getByLabelText("URL 2")).toHaveAccessibleDescription(
      "Remove the username and password from the address.",
    );
    expect(screen.getByLabelText("URL 2")).toHaveValue("");
    expect(screen.getByLabelText("URL 1")).toHaveValue("https://northwind.co/ok");
  });

  test("a 409 renews the key so the next submit is a new intent", async () => {
    reply = { status: 409, body: { error: "rejected" } };
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: "Add pages" }));
    await user.type(screen.getByLabelText("URL 1"), "/a");
    await user.click(screen.getByRole("button", { name: "Add page" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/This project changed/);
    await user.click(screen.getByRole("button", { name: "Add page" }));
    expect(sentBody(1).idempotencyKey).not.toBe(sentBody(0).idempotencyKey);
  });

  test("Add another URL stops at the room left; a full project's card is disabled and says why", async () => {
    const user = userEvent.setup();
    renderCard(project(MAX_UNIQUE_PAGE_URLS - 1));
    await user.click(screen.getByRole("button", { name: "Add pages" }));
    expect(screen.getByRole("button", { name: "Add another URL" })).toBeDisabled();
    cleanup();

    renderCard(project(MAX_UNIQUE_PAGE_URLS));
    const card = screen.getByRole("button", { name: "Add pages" });
    expect(card).toBeDisabled();
    expect(card).toHaveAccessibleDescription(
      `This project has the most pages it can hold (${MAX_UNIQUE_PAGE_URLS}).`,
    );
  });
});
