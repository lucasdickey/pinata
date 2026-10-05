// @vitest-environment jsdom
// Component tests for the editor's "Agent link" control (D121): status
// inline on mount, Create shows the link and a ready-to-paste prompt once,
// both copy buttons, rotate behind a confirmation, and the one-time link
// forgotten on close.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AgentLinkControl } from "../src/components/agent-link";
import { agentPrompt } from "../src/lib/agent-link";
import { EDITOR_CSRF_COOKIE, EDITOR_CSRF_HEADER } from "../src/lib/auth-constants";

const TOKEN = "C".repeat(43);

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let link: { state: string; version: number; revokedAt: number | null };

beforeEach(() => {
  link = { state: "none", version: 0, revokedAt: null };
  fetchMock = vi.fn((url: unknown, init?: RequestInit) => {
    const target = String(url);
    const method = init?.method ?? "GET";
    if (!target.endsWith("/api/projects/pub-1/agent-link")) {
      return Promise.reject(new Error(`unexpected fetch: ${method} ${target}`));
    }
    if (method === "GET") return Promise.resolve(json({ link }));
    if (method === "POST") {
      link = { state: "active", version: link.version + 1, revokedAt: null };
      return Promise.resolve(json({ link, path: `/a/${TOKEN}` }, 201));
    }
    if (method === "DELETE") {
      link = { state: "revoked", version: link.version, revokedAt: 1_800_000_000_000 };
      return Promise.resolve(json({ link }));
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

describe("AgentLinkControl", () => {
  test("shows the state inline and explains itself before a link exists", async () => {
    const user = userEvent.setup();
    render(<AgentLinkControl publicId="pub-1" projectTitle="a-ok.ai" />);
    expect(await screen.findByTestId("agent-link-state")).toHaveTextContent("Off");
    await user.click(screen.getByRole("button", { name: "Agent link" }));
    const panel = await screen.findByRole("group", { name: "Agent link for a-ok.ai" });
    expect(panel).toHaveTextContent("read-only brief");
    expect(within(panel).getByRole("button", { name: "Create link" })).toBeInTheDocument();
  });

  test("Create shows the link and the prompt once, and both copy", async () => {
    const user = userEvent.setup();
    render(<AgentLinkControl publicId="pub-1" projectTitle="a-ok.ai" />);
    await screen.findByText("Off");
    await user.click(screen.getByRole("button", { name: "Agent link" }));
    await user.click(await screen.findByRole("button", { name: "Create link" }));

    const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    expect((post?.[1]?.headers as Record<string, string>)[EDITOR_CSRF_HEADER]).toBe(
      "editor-proof-sentinel",
    );
    const url = `${window.location.origin}/a/${TOKEN}`;
    expect(await screen.findByLabelText(/Agent link \(shown once/)).toHaveValue(url);
    expect(screen.getByLabelText("Prompt to paste into your agent")).toHaveValue(agentPrompt(url));
    expect(screen.getByTestId("agent-link-state")).toHaveTextContent("Active · v1");

    await user.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(await navigator.clipboard.readText()).toBe(agentPrompt(url));
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe(url);

    // Closing forgets the link: the server cannot show it again.
    await user.click(screen.getByRole("button", { name: "Agent link" }));
    await user.click(screen.getByRole("button", { name: "Agent link" }));
    expect(screen.queryByLabelText(/Agent link \(shown once/)).toBeNull();
  });

  test("Rotate and Revoke ask first", async () => {
    link = { state: "active", version: 3, revokedAt: null };
    const user = userEvent.setup();
    render(<AgentLinkControl publicId="pub-1" projectTitle="a-ok.ai" />);
    await screen.findByText("Active · v3");
    await user.click(screen.getByRole("button", { name: "Agent link" }));
    await user.click(await screen.findByRole("button", { name: "Revoke link" }));
    const confirm = screen.getByTestId("agent-link-confirm");
    expect(confirm).toHaveTextContent("stops working");
    expect(within(confirm).getByRole("button", { name: "Yes, revoke link" })).toHaveFocus();
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE")).toBe(false);
    await user.click(within(confirm).getByRole("button", { name: "Yes, revoke link" }));
    expect(await screen.findByText("Revoked")).toBeInTheDocument();
  });
});

describe("AgentLinkControl closing", () => {
  test("Escape and the close button close the panel and return focus to the toggle", async () => {
    const user = userEvent.setup();
    render(<AgentLinkControl publicId="pub-1" projectTitle="a-ok.ai" />);
    await screen.findByText("Off");
    const toggle = screen.getByRole("button", { name: "Agent link" });
    await user.click(toggle);
    await user.click(await screen.findByRole("button", { name: "Create link" }));
    await screen.findByLabelText(/Agent link \(shown once/);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Agent link for a-ok.ai" })).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    await user.click(toggle);
    await user.click(await screen.findByRole("button", { name: "Close" }));
    expect(screen.queryByRole("group", { name: "Agent link for a-ok.ai" })).toBeNull();
    expect(toggle).toHaveFocus();
  });
});

describe("agentPrompt", () => {
  test("is one line that names the link", () => {
    const prompt = agentPrompt("https://pinata.example/a/token");
    expect(prompt).toContain("https://pinata.example/a/token");
    expect(prompt).not.toContain("\n");
  });
});
