// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SendSheet } from "../src/components/send-sheet";
import { EDITOR_CSRF_COOKIE, EDITOR_CSRF_HEADER } from "../src/lib/auth-constants";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

let fetchMock: ReturnType<typeof vi.fn>;
let agentVersion: number;
let personVersion: number;

beforeEach(() => {
  agentVersion = 0;
  personVersion = 0;
  fetchMock = vi.fn((url: unknown, init?: RequestInit) => {
    const endpoint = String(url);
    const method = init?.method ?? "GET";
    if (endpoint === "/api/projects/pub-1/agent-link") {
      if (method === "GET") {
        return Promise.resolve(json({ link: { state: agentVersion ? "active" : "none", version: agentVersion } }));
      }
      if (method === "POST") {
        agentVersion++;
        return Promise.resolve(
          json({ link: { state: "active", version: agentVersion }, path: `/a/agent-${agentVersion}` }, 201),
        );
      }
    }
    if (endpoint === "/api/projects/pub-1/share") {
      if (method === "GET") {
        return Promise.resolve(json({ share: { state: personVersion ? "active" : "none", version: personVersion } }));
      }
      if (method === "POST") {
        personVersion++;
        return Promise.resolve(
          json({
            share: { state: "active", version: personVersion },
            path: "/f/pub-1",
            token: `person-${personVersion}`,
          }, 201),
        );
      }
    }
    return Promise.reject(new Error(`Unexpected ${method} ${endpoint}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  document.cookie = `${EDITOR_CSRF_COOKIE}=editor-proof-sentinel`;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = `${EDITOR_CSRF_COOKIE}=; Max-Age=0`;
});

const renderSheet = (ready = true) =>
  render(
    <SendSheet
      publicId="pub-1"
      projectTitle="chickpea.co"
      markdown={() => "# Pinata pins — chickpea.co\n\nA complete project export."}
      markdownReady={ready}
    />,
  );

test("one entry exposes three choices without issuing a link until requested", async () => {
  const user = userEvent.setup();
  renderSheet();
  const send = screen.getByRole("button", { name: "Send" });
  expect(screen.queryByRole("button", { name: "Agent link" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Share with founder" })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();

  await user.click(send);
  const sheet = screen.getByRole("dialog", { name: "Send chickpea.co" });
  const tabs = within(sheet).getByRole("tablist", { name: "Send to" });
  expect(within(tabs).getAllByRole("tab")).toHaveLength(3);
  expect(within(tabs).getByRole("tab", { name: "Coding agent" })).toHaveFocus();
  expect(await within(sheet).findByText(/read-only brief/)).toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);

  await user.click(within(tabs).getByRole("tab", { name: "Markdown" }));
  await user.click(within(sheet).getByRole("button", { name: "Copy project Markdown" }));
  expect(await navigator.clipboard.readText()).toContain("A complete project export.");
  expect(within(sheet).getByRole("status")).toHaveTextContent("Project Markdown copied.");
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  await user.keyboard("{Escape}");
  expect(sheet).not.toBeInTheDocument();
  expect(send).toHaveFocus();
});

test("agent and person links use independent capabilities and rotate only after confirmation", async () => {
  const user = userEvent.setup();
  renderSheet();
  await user.click(screen.getByRole("button", { name: "Send" }));
  const sheet = screen.getByRole("dialog", { name: "Send chickpea.co" });
  const tabs = within(sheet).getByRole("tablist", { name: "Send to" });
  await user.click(await within(sheet).findByRole("button", { name: "Create link" }));
  const agentLink = await within(sheet).findByLabelText(/Agent link \(shown once/);
  expect(agentLink).toHaveValue(`${window.location.origin}/a/agent-1`);
  expect(
    (within(sheet).getByLabelText("Prompt to paste into your agent") as HTMLTextAreaElement).value,
  ).toContain("/a/agent-1");
  await user.click(within(tabs).getByRole("tab", { name: "Person review" }));
  await user.click(await within(sheet).findByRole("button", { name: "Create link" }));
  expect(await within(sheet).findByLabelText(/Founder link \(shown once/)).toHaveValue(
    `${window.location.origin}/f/pub-1#person-1`,
  );
  await user.click(within(tabs).getByRole("tab", { name: "Coding agent" }));
  expect(within(sheet).queryByLabelText(/Agent link \(shown once/)).toBeNull();
  expect(await within(sheet).findByText(/Version 1 is live/)).toBeInTheDocument();

  await user.click(within(sheet).getByRole("button", { name: "Rotate link" }));
  expect(within(sheet).getByText(/agent link\? The link you handed out stops working/)).toBeInTheDocument();
  expect(agentVersion).toBe(1);
  await user.click(within(sheet).getByRole("button", { name: "Cancel" }));
  expect(agentVersion).toBe(1);
  await user.click(within(sheet).getByRole("button", { name: "Rotate link" }));
  await user.click(within(sheet).getByRole("button", { name: "Yes, rotate link" }));
  await waitFor(() =>
    expect(within(sheet).getByLabelText(/Agent link \(shown once/)).toHaveValue(
      `${window.location.origin}/a/agent-2`,
    ),
  );
  expect(personVersion).toBe(1);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(3);
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").every(([, init]) =>
      Boolean((init?.headers as Record<string, string>)[EDITOR_CSRF_HEADER]),
    ),
  ).toBe(true);
});

test("closing discards both issued secrets; active links cannot be recovered from status", async () => {
  const user = userEvent.setup();
  renderSheet();
  await user.click(screen.getByRole("button", { name: "Send" }));
  let sheet = screen.getByRole("dialog", { name: "Send chickpea.co" });
  await user.click(await within(sheet).findByRole("button", { name: "Create link" }));
  await within(sheet).findByLabelText(/Agent link \(shown once/);
  await user.click(within(sheet).getByRole("tab", { name: "Person review" }));
  await user.click(await within(sheet).findByRole("button", { name: "Create link" }));
  await within(sheet).findByLabelText(/Founder link \(shown once/);
  await user.click(within(sheet).getByRole("button", { name: "Close Send" }));
  await user.click(screen.getByRole("button", { name: "Send" }));
  sheet = screen.getByRole("dialog", { name: "Send chickpea.co" });
  const agentPanel = within(sheet).getByRole("tabpanel", { name: "Coding agent" });
  expect(await within(agentPanel).findByText(/Version 1 is live/)).toBeInTheDocument();
  expect(within(sheet).queryByLabelText(/Agent link \(shown once/)).toBeNull();
  await user.click(within(sheet).getByRole("tab", { name: "Person review" }));
  const personPanel = within(sheet).getByRole("tabpanel", { name: "Person review" });
  expect(await within(personPanel).findByText(/Version 1 is live/)).toBeInTheDocument();
  expect(within(sheet).queryByLabelText(/Founder link \(shown once/)).toBeNull();
  expect(within(sheet).queryByRole("button", { name: "Copy link" })).toBeNull();
});

test("Markdown waits for project notes rather than copying an incomplete export", async () => {
  const user = userEvent.setup();
  renderSheet(false);
  await user.click(screen.getByRole("button", { name: "Send" }));
  await user.click(screen.getByRole("tab", { name: "Markdown" }));
  expect(screen.getByRole("button", { name: "Copy project Markdown" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Project notes are not available yet.");
});

for (const kind of ["agent", "person"] as const) {
  for (const exit of ["switch", "close"] as const) {
    test(`${kind} issue response remains visible when ${exit} is attempted while pending`, async () => {
      const user = userEvent.setup();
      const endpoint = `/api/projects/pub-1/${kind === "agent" ? "agent-link" : "share"}`;
      const fetchNow = fetchMock.getMockImplementation() as (
        url: unknown,
        init?: RequestInit,
      ) => Promise<Response>;
      let finishIssue!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        finishIssue = resolve;
      });
      fetchMock.mockImplementation((url: unknown, init?: RequestInit) =>
        String(url) === endpoint && init?.method === "POST"
          ? pending
          : fetchNow(url, init),
      );
      renderSheet();
      const send = screen.getByRole("button", { name: "Send" });
      await user.click(send);
      const sheet = screen.getByRole("dialog", { name: "Send chickpea.co" });
      if (kind === "person") await user.click(within(sheet).getByRole("tab", { name: "Person review" }));
      await user.click(await within(sheet).findByRole("button", { name: "Create link" }));
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);

      const otherTab = within(sheet).getByRole("tab", {
        name: kind === "agent" ? "Person review" : "Coding agent",
      });
      expect(send).toBeDisabled();
      expect(otherTab).toBeDisabled();
      expect(within(sheet).getByRole("button", { name: "Close Send" })).toBeDisabled();
      expect(within(sheet).getByRole("status")).toHaveTextContent("Keep Send open");
      if (exit === "switch") {
        await user.click(otherTab);
        fireEvent.keyDown(
          within(sheet).getByRole("tab", { name: kind === "agent" ? "Coding agent" : "Person review" }),
          { key: "ArrowRight" },
        );
      } else {
        await user.click(within(sheet).getByRole("button", { name: "Close Send" }));
        await user.click(send);
        await user.keyboard("{Escape}");
      }
      expect(sheet).toBeInTheDocument();
      expect(within(sheet).getByRole("tab", { name: kind === "agent" ? "Coding agent" : "Person review" }))
        .toHaveAttribute("aria-selected", "true");
      expect(within(sheet).queryByLabelText(/link \(shown once/)).toBeNull();

      await act(async () => {
        if (kind === "agent") {
          agentVersion = 1;
          finishIssue(json({ link: { state: "active", version: 1 }, path: "/a/agent-1" }, 201));
        } else {
          personVersion = 1;
          finishIssue(
            json({ share: { state: "active", version: 1 }, path: "/f/pub-1", token: "person-1" }, 201),
          );
        }
      });
      expect(await within(sheet).findByLabelText(/link \(shown once/)).toHaveValue(
        `${window.location.origin}${kind === "agent" ? "/a/agent-1" : "/f/pub-1#person-1"}`,
      );
      expect(send).toBeEnabled();
      expect(otherTab).toBeEnabled();
      expect(within(sheet).getByRole("button", { name: "Close Send" })).toBeEnabled();

      if (exit === "switch") {
        await user.click(otherTab);
        await user.click(within(sheet).getByRole("tab", {
          name: kind === "agent" ? "Coding agent" : "Person review",
        }));
      } else {
        await user.click(within(sheet).getByRole("button", { name: "Close Send" }));
        await user.click(send);
        if (kind === "person") {
          await user.click(screen.getByRole("tab", { name: "Person review" }));
        }
      }
      expect(await screen.findByText(/Version 1 is live/)).toBeInTheDocument();
      expect(screen.queryByLabelText(/link \(shown once/)).toBeNull();
    });
  }
}

test("failed issuance unlocks Send without showing a link", async () => {
  const user = userEvent.setup();
  const fetchNow = fetchMock.getMockImplementation() as (
    url: unknown,
    init?: RequestInit,
  ) => Promise<Response>;
  let failIssue!: (reason: Error) => void;
  const pending = new Promise<Response>((_, reject) => {
    failIssue = reject;
  });
  fetchMock.mockImplementation((url: unknown, init?: RequestInit) =>
    String(url) === "/api/projects/pub-1/agent-link" && init?.method === "POST"
      ? pending
      : fetchNow(url, init),
  );
  renderSheet();
  const send = screen.getByRole("button", { name: "Send" });
  await user.click(send);
  const sheet = screen.getByRole("dialog", { name: "Send chickpea.co" });
  await user.click(await within(sheet).findByRole("button", { name: "Create link" }));
  expect(send).toBeDisabled();
  await act(async () => failIssue(new Error("Network unavailable")));
  expect(within(sheet).getByRole("alert")).toHaveTextContent("could not be created");
  expect(within(sheet).queryByLabelText(/link \(shown once/)).toBeNull();
  expect(send).toBeEnabled();
  await user.click(within(sheet).getByRole("button", { name: "Close Send" }));
  expect(sheet).not.toBeInTheDocument();
});
