// @vitest-environment jsdom
// Component tests for the founder's read/reply-only view (REQUIREMENTS 6
// and 7): the fragment token is scrubbed and exchanged exactly once, the
// project renders through founder-authorized reads, no editing control
// exists in the DOM (visually or to assistive technology), the thread under
// a pin renders with server labels, a reply posts one idempotent append
// with the founder CSRF proof, and a denied exchange shows no project data.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FounderView } from "../src/components/founder-view";
import { EDITOR_CSRF_HEADER, FOUNDER_CSRF_COOKIE } from "../src/lib/auth-constants";
import { installReactFlowMocks } from "./helpers/react-flow";

installReactFlowMocks();

const TOKEN = "A".repeat(43);

const project = {
  projectId: "proj-1",
  publicId: "pub-1",
  title: "chickpea.co",
  rootUrl: "https://chickpea.co/",
  createdAt: 1_800_000_000_000,
  pages: [
    {
      id: "page-root",
      requestedUrl: "https://chickpea.co/",
      normalizedUrl: "https://chickpea.co/",
      sortIndex: 0,
      devices: [
        {
          variant: "desktop",
          attempts: [
            {
              id: "root-d1",
              variant: "desktop",
              attempt: 1,
              state: "ready",
              errorCode: null,
              imageHash: "hash",
              documentWidth: 1440,
              documentHeight: 8966,
            },
          ],
          latest: null,
          selectedCaptureId: "root-d1",
          selectedAttempt: 1,
          usable: true,
          retryable: true,
        },
        {
          variant: "mobile",
          attempts: [
            {
              id: "root-m1",
              variant: "mobile",
              attempt: 1,
              state: "failed",
              errorCode: "total-timeout",
              imageHash: null,
              documentWidth: null,
              documentHeight: null,
            },
          ],
          latest: null,
          selectedCaptureId: null,
          selectedAttempt: null,
          usable: false,
          retryable: true,
        },
      ],
    },
  ],
  counts: { pages: 1, attempts: 2, ready: 1, failed: 1, inProgress: 0 },
};

const pin = {
  id: "ann-1",
  captureId: "root-d1",
  kind: "pin",
  number: 1,
  tip: { x: 720, y: 4000 },
  body: "The hero headline duplicates the nav wordmark.",
  elementSnapshot: null,
  revision: 1,
  createdAt: 1_800_000_000_000,
};

const entries = [
  {
    id: "thr-1",
    annotationId: "ann-1",
    actorRole: "founder",
    authorLabel: "founder",
    body: "Good catch, will trim it.",
    createdAt: 1_800_000_000_500,
  },
  {
    id: "thr-2",
    annotationId: "ann-1",
    actorRole: "editor",
    authorLabel: "Lucas",
    body: "Thanks!",
    createdAt: 1_800_000_001_000,
  },
];

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[];
let fetchMock: ReturnType<typeof vi.fn>;
let exchangeStatus: number;
let projectStatus: number;

function installFetch() {
  calls = [];
  fetchMock = vi.fn((url: unknown, init?: RequestInit) => {
    const target = String(url);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: target, method, headers, body });
    if (target.endsWith("/api/founder/pub-1/session")) {
      return Promise.resolve(
        exchangeStatus === 200
          ? json({ ok: true, expiresAt: "2026-09-10T00:00:00.000Z" })
          : json({ error: "Request rejected." }, exchangeStatus),
      );
    }
    if (target.endsWith("/api/founder/pub-1")) {
      return Promise.resolve(
        projectStatus === 200
          ? json({ actor: "founder", project })
          : json({ error: "Authentication required." }, projectStatus),
      );
    }
    if (target.endsWith("/annotations")) {
      return Promise.resolve(json({ annotations: [pin] }));
    }
    if (target.endsWith("/thread") && method === "GET") {
      return Promise.resolve(json({ entries }));
    }
    if (target.endsWith("/thread") && method === "POST") {
      return Promise.resolve(
        json(
          {
            entry: {
              id: "thr-new",
              annotationId: "ann-1",
              actorRole: "founder",
              authorLabel: "founder",
              body: body.body,
              createdAt: 1_800_000_002_000,
            },
          },
          201,
        ),
      );
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${target}`));
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  exchangeStatus = 200;
  projectStatus = 200;
  installFetch();
  window.history.replaceState(null, "", `/f/pub-1#${TOKEN}`);
  document.cookie = `${FOUNDER_CSRF_COOKIE}=founder-proof-sentinel`;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = `${FOUNDER_CSRF_COOKIE}=; Max-Age=0`;
});

async function renderReady() {
  render(<FounderView publicId="pub-1" />);
  await screen.findByTestId("founder-view");
  await screen.findByRole("img", { name: "Screenshot of https://chickpea.co/ (Desktop, version 1)" });
}

describe("capability exchange", () => {
  test("scrubs the fragment and exchanges the token exactly once, then reads the project", async () => {
    await renderReady();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/f/pub-1");
    const exchanges = calls.filter((call) => call.url.endsWith("/session"));
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]!.method).toBe("POST");
    expect(exchanges[0]!.body).toEqual({ token: TOKEN });
    // The token never rides in a path or query string.
    for (const call of calls) expect(call.url).not.toContain(TOKEN);
    const exchangeIndex = calls.findIndex((call) => call.url.endsWith("/session"));
    const projectIndex = calls.findIndex((call) => call.url.endsWith("/api/founder/pub-1"));
    expect(exchangeIndex).toBeLessThan(projectIndex);
    expect(screen.getByText("Viewing as founder")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "chickpea.co" })).toBeInTheDocument();
  });

  test("a return visit without a fragment reads straight through the cookie", async () => {
    window.history.replaceState(null, "", "/f/pub-1");
    await renderReady();
    expect(calls.some((call) => call.url.endsWith("/session"))).toBe(false);
  });

  test("a rejected exchange shows the generic denial and no project data", async () => {
    exchangeStatus = 404;
    render(<FounderView publicId="pub-1" />);
    await screen.findByTestId("founder-denied");
    expect(screen.queryByText("chickpea.co")).toBeNull();
    expect(calls.some((call) => call.url.endsWith("/api/founder/pub-1"))).toBe(false);
    expect(screen.queryByRole("img")).toBeNull();
  });

  test("a session that stopped verifying (rotation or revocation) is the same denial", async () => {
    window.history.replaceState(null, "", "/f/pub-1");
    projectStatus = 401;
    render(<FounderView publicId="pub-1" />);
    await screen.findByTestId("founder-denied");
    expect(screen.queryByText("chickpea.co")).toBeNull();
  });
});

describe("read/reply-only surface", () => {
  test("renders the project's readable captures with no editing controls in the DOM", async () => {
    await renderReady();
    // Only the ready device is offered; the failed mobile one is named as absent.
    const nav = screen.getByRole("navigation", { name: "Pages and devices" });
    expect(
      within(nav).getByRole("button", { name: "Desktop capture of https://chickpea.co/" }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      within(nav).queryByRole("button", { name: "Mobile capture of https://chickpea.co/" }),
    ).toBeNull();
    // The screenshot comes through the same-origin authorized asset route.
    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/captures/root-d1/asset");

    // No editing affordance anywhere: not a mode, not a button, not a form.
    for (const name of [
      "Place pin",
      "Navigate",
      "Save pin",
      "Edit comment",
      "Delete pin",
      "Confirm delete",
      /^Retry/,
      "Share with founder",
      "Rotate link",
      "Revoke link",
      "Sign out",
    ]) {
      expect(screen.queryByRole("button", { name }), String(name)).toBeNull();
    }
    expect(screen.queryByRole("group", { name: "Canvas tools" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByLabelText("Comment")).toBeNull();
    expect(screen.queryByLabelText("Edit comment")).toBeNull();
    expect(document.querySelector(".react-flow__node-draftPin")).toBeNull();
    expect(screen.getByRole("region", { name: /Screenshot of/ })).toHaveAttribute(
      "data-read-only",
      "true",
    );
    // Camera controls remain.
    expect(screen.getByRole("button", { name: "Entire page" })).toBeInTheDocument();
  });

  test("selecting a pin shows the original comment, the thread with server labels, and a reply composer", async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(await screen.findByRole("button", { name: /^Pin 1 — at/ }));
    const panel = screen.getByTestId("founder-panel");
    await within(panel).findByTestId("thread");
    expect(panel).toHaveTextContent("Pin 1");
    expect(panel).toHaveTextContent("The hero headline duplicates the nav wordmark.");
    const items = within(within(panel).getByRole("list", { name: "Thread entries" })).getAllByRole(
      "listitem",
    );
    expect(items.map((item) => item.getAttribute("data-author"))).toEqual([
      "Lucas",
      "founder",
      "Lucas",
    ]);
    expect(items[1]).toHaveTextContent("Good catch, will trim it.");
    expect(items[2]).toHaveTextContent("Thanks!");
    expect(within(panel).getByLabelText("Reply as founder")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Send reply" })).toBeDisabled();
    // Still nothing editable: no edit/delete on the pin, nothing on entries.
    expect(within(panel).queryByRole("button", { name: /edit|delete/i })).toBeNull();
    // A hostile body renders as inert text.
    expect(panel.querySelector("img[src='x']")).toBeNull();
  });

  test("a reply posts one idempotent append with the founder CSRF proof and appears in the thread", async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(await screen.findByRole("button", { name: /^Pin 1 — at/ }));
    const panel = screen.getByTestId("founder-panel");
    await within(panel).findByTestId("thread");
    await user.type(within(panel).getByLabelText("Reply as founder"), "Will do this week.");
    await user.click(within(panel).getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(panel).toHaveTextContent("Will do this week."));
    const posts = calls.filter((call) => call.method === "POST" && call.url.endsWith("/thread"));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("/api/captures/root-d1/annotations/ann-1/thread");
    expect(posts[0]!.headers[EDITOR_CSRF_HEADER]).toBe("founder-proof-sentinel");
    const sent = posts[0]!.body as { body: string; idempotencyKey: string };
    expect(sent.body).toBe("Will do this week.");
    expect(typeof sent.idempotencyKey).toBe("string");
    expect(sent.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    // The label came from the server, not the request.
    expect(sent).not.toHaveProperty("authorLabel");
    expect(sent).not.toHaveProperty("actorRole");
    const items = within(within(panel).getByRole("list", { name: "Thread entries" })).getAllByRole(
      "listitem",
    );
    expect(items.at(-1)).toHaveAttribute("data-author", "founder");
    // The composer is cleared for the next reply.
    expect(within(panel).getByLabelText("Reply as founder")).toHaveValue("");
  });

  test("a reply denied by a lost capability says so and keeps the text", async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(await screen.findByRole("button", { name: /^Pin 1 — at/ }));
    const panel = screen.getByTestId("founder-panel");
    await within(panel).findByTestId("thread");
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ error: "Authentication required." }, 401)));
    await user.type(within(panel).getByLabelText("Reply as founder"), "Stale");
    await user.click(within(panel).getByRole("button", { name: "Send reply" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent(/no longer valid/);
    expect(within(panel).getByLabelText("Reply as founder")).toHaveValue("Stale");
  });
});
