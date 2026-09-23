// @vitest-environment jsdom
// Component tests for the editor's "Share with founder" control
// (REQUIREMENTS 7): closed by default with no reads, status on open, the
// link composed with the token in the fragment and shown exactly once,
// rotate and revoke through the editor mutation routes with the CSRF proof,
// and the one-time link forgotten on close.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FounderShareControl, composeFounderLink } from "../src/components/founder-share";
import { EDITOR_CSRF_COOKIE, EDITOR_CSRF_HEADER } from "../src/lib/auth-constants";

const TOKEN = "B".repeat(43);

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let share: { state: string; version: number; revokedAt: number | null };

beforeEach(() => {
  share = { state: "none", version: 0, revokedAt: null };
  fetchMock = vi.fn((url: unknown, init?: RequestInit) => {
    const target = String(url);
    const method = init?.method ?? "GET";
    if (!target.endsWith("/api/projects/pub-1/share")) {
      return Promise.reject(new Error(`unexpected fetch: ${method} ${target}`));
    }
    if (method === "GET") return Promise.resolve(json({ share }));
    if (method === "POST") {
      share = { state: "active", version: share.version + 1, revokedAt: null };
      return Promise.resolve(json({ share, path: "/f/pub-1", token: TOKEN }, 201));
    }
    if (method === "DELETE") {
      share = { state: "revoked", version: share.version, revokedAt: 1_800_000_000_000 };
      return Promise.resolve(json({ share }));
    }
    return Promise.reject(new Error(`unexpected method ${method}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  document.cookie = `${EDITOR_CSRF_COOKIE}=editor-proof-sentinel`;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = `${EDITOR_CSRF_COOKIE}=; Max-Age=0`;
});

describe("composeFounderLink", () => {
  test("puts the token in the fragment, never the path or query", () => {
    const link = composeFounderLink("https://pinata.example", "/f/pub-1", TOKEN);
    expect(link).toBe(`https://pinata.example/f/pub-1#${TOKEN}`);
    const url = new URL(link);
    expect(url.pathname).toBe("/f/pub-1");
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#${TOKEN}`);
  });
});

describe("FounderShareControl", () => {
  test("is closed by default, reads the status once on mount, and shows it inline (D075)", async () => {
    const user = userEvent.setup();
    render(<FounderShareControl publicId="pub-1" projectTitle="chickpea.co" />);
    const toggle = screen.getByRole("button", { name: "Share with founder" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // The state is visible without opening the panel.
    expect(await screen.findByTestId("founder-share-state")).toHaveTextContent("No founder link");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group")).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = await screen.findByRole("group", { name: "Founder link for chickpea.co" });
    await within(panel).findByText("No founder link yet.");
    // Opening reuses the status already read.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(panel).getByRole("button", { name: "Create link" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Revoke link" })).toBeNull();
  });

  test("the inline state names an active link's version and a revoked link", async () => {
    share = { state: "active", version: 2, revokedAt: null };
    const { unmount } = render(<FounderShareControl publicId="pub-1" projectTitle="chickpea.co" />);
    expect(await screen.findByTestId("founder-share-state")).toHaveTextContent(
      "Founder link active · v2",
    );
    unmount();
    share = { state: "revoked", version: 2, revokedAt: 1_800_000_000_000 };
    render(<FounderShareControl publicId="pub-1" projectTitle="chickpea.co" />);
    expect(await screen.findByTestId("founder-share-state")).toHaveTextContent(
      "Founder link revoked",
    );
  });

  test("a failed status read is named inline and retried when the panel opens", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ error: "Service unavailable." }, 503)));
    render(<FounderShareControl publicId="pub-1" projectTitle="chickpea.co" />);
    expect(await screen.findByTestId("founder-share-state")).toHaveTextContent(
      "Link status unavailable",
    );
    await user.click(screen.getByRole("button", { name: "Share with founder" }));
    expect(await screen.findByTestId("founder-share-state")).toHaveTextContent("No founder link");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("creating shows the complete link once with the token in the fragment", async () => {
    const user = userEvent.setup();
    render(<FounderShareControl publicId="pub-1" projectTitle="chickpea.co" />);
    await user.click(screen.getByRole("button", { name: "Share with founder" }));
    const panel = await screen.findByRole("group", { name: "Founder link for chickpea.co" });
    await user.click(await within(panel).findByRole("button", { name: "Create link" }));

    const field = await within(panel).findByLabelText(/Founder link \(shown once/);
    expect(field).toHaveValue(`${window.location.origin}/f/pub-1#${TOKEN}`);
    expect(field).toHaveAttribute("readonly");
    expect(panel).toHaveTextContent("Founder link active (version 1).");
    expect(panel).toHaveTextContent(/cannot be shown again/);
    expect(within(panel).getByRole("button", { name: "Rotate link" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Revoke link" })).toBeInTheDocument();

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST")!;
    expect(post[0]).toBe("/api/projects/pub-1/share");
    expect(new Headers((post[1] as RequestInit).headers).get(EDITOR_CSRF_HEADER)).toBe(
      "editor-proof-sentinel",
    );

    // Closing forgets the link; reopening reads status and cannot show it.
    await user.click(screen.getByRole("button", { name: "Share with founder" }));
    await user.click(screen.getByRole("button", { name: "Share with founder" }));
    const reopened = await screen.findByRole("group", { name: "Founder link for chickpea.co" });
    await within(reopened).findByText("Founder link active (version 1).");
    expect(within(reopened).queryByLabelText(/Founder link \(shown once/)).toBeNull();
    expect(reopened).not.toHaveTextContent(TOKEN);
  });

  test("rotate issues a new link and revoke ends it, each only after an inline confirm (D097)", async () => {
    const user = userEvent.setup();
    share = { state: "active", version: 3, revokedAt: null };
    render(<FounderShareControl publicId="pub-1" projectTitle="chickpea.co" />);
    await user.click(screen.getByRole("button", { name: "Share with founder" }));
    const panel = await screen.findByRole("group", { name: "Founder link for chickpea.co" });
    await within(panel).findByText("Founder link active (version 3).");
    const writes = () =>
      fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit)?.method ?? "GET") !== "GET");

    // Rotate asks first: the founder's current link would stop working.
    await user.click(within(panel).getByRole("button", { name: "Rotate link" }));
    const rotateStep = within(panel).getByTestId("founder-share-confirm");
    expect(rotateStep).toHaveTextContent(/link the founder has now stops working/);
    expect(writes()).toHaveLength(0);
    // Focus lands on the confirmation so the keyboard path is Enter or Tab.
    expect(within(rotateStep).getByRole("button", { name: "Yes, rotate link" })).toHaveFocus();
    await user.click(within(rotateStep).getByRole("button", { name: "Yes, rotate link" }));
    await within(panel).findByText("Founder link active (version 4).");
    expect(await within(panel).findByLabelText(/Founder link \(shown once/)).toHaveValue(
      `${window.location.origin}/f/pub-1#${TOKEN}`,
    );
    expect(within(panel).queryByTestId("founder-share-confirm")).toBeNull();
    expect(writes()).toHaveLength(1);

    await user.click(within(panel).getByRole("button", { name: "Revoke link" }));
    const revokeStep = within(panel).getByTestId("founder-share-confirm");
    expect(revokeStep).toHaveTextContent(/nobody can open the review/);
    expect(writes()).toHaveLength(1);
    await user.click(within(revokeStep).getByRole("button", { name: "Yes, revoke link" }));
    await within(panel).findByText("Founder link revoked (was version 4).");
    expect(within(panel).queryByLabelText(/Founder link \(shown once/)).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Revoke link" })).toBeNull();
    expect(within(panel).getByRole("button", { name: "Create link" })).toBeInTheDocument();
    const del = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "DELETE")!;
    expect(new Headers((del[1] as RequestInit).headers).get(EDITOR_CSRF_HEADER)).toBe(
      "editor-proof-sentinel",
    );
  });

  test("cancelling a rotate or revoke writes nothing and keeps the one-time link (D097)", async () => {
    const user = userEvent.setup();
    render(<FounderShareControl publicId="pub-1" projectTitle="chickpea.co" />);
    await user.click(screen.getByRole("button", { name: "Share with founder" }));
    const panel = await screen.findByRole("group", { name: "Founder link for chickpea.co" });
    // Create needs no confirmation: there is no link yet to break.
    await user.click(await within(panel).findByRole("button", { name: "Create link" }));
    await within(panel).findByText("Founder link active (version 1).");
    expect(within(panel).queryByTestId("founder-share-confirm")).toBeNull();
    const writesBefore = fetchMock.mock.calls.length;

    for (const action of ["Rotate link", "Revoke link"]) {
      await user.click(within(panel).getByRole("button", { name: action }));
      await user.click(within(panel).getByRole("button", { name: "Cancel" }));
      expect(within(panel).queryByTestId("founder-share-confirm")).toBeNull();
      // Focus returns to the action row rather than falling to the page.
      expect(within(panel).getByRole("button", { name: "Rotate link" })).toHaveFocus();
    }
    expect(fetchMock.mock.calls.length).toBe(writesBefore);
    expect(within(panel).getByLabelText(/Founder link \(shown once/)).toHaveValue(
      `${window.location.origin}/f/pub-1#${TOKEN}`,
    );
    expect(panel).toHaveTextContent("Founder link active (version 1).");
  });

  test("a failed issue reports a bounded error and shows no link", async () => {
    const user = userEvent.setup();
    render(<FounderShareControl publicId="pub-1" projectTitle="chickpea.co" />);
    await user.click(screen.getByRole("button", { name: "Share with founder" }));
    const panel = await screen.findByRole("group", { name: "Founder link for chickpea.co" });
    await within(panel).findByText("No founder link yet.");
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ error: "Request rejected." }, 503)));
    await user.click(within(panel).getByRole("button", { name: "Create link" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent(/could not be created/);
    expect(within(panel).queryByLabelText(/Founder link \(shown once/)).toBeNull();
  });
});
