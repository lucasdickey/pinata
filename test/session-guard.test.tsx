// @vitest-environment jsdom
// Signing in again without losing work (D124): a 401 from the editor API
// opens the sign-in dialog in place; signing in retries the refused request
// with the new CSRF proof; closing lets it fail; other requests are left
// alone.

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  SessionGuard,
  isEditorApiRequest,
  withFreshCsrf,
} from "../src/components/session-guard";
import { EDITOR_CSRF_COOKIE, EDITOR_CSRF_HEADER } from "../src/lib/auth-constants";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let calls: { url: string; init?: RequestInit }[];
let signedIn: boolean;

beforeEach(() => {
  calls = [];
  signedIn = false;
  document.cookie = `${EDITOR_CSRF_COOKIE}=old-proof`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/auth/login") {
        signedIn = true;
        document.cookie = `${EDITOR_CSRF_COOKIE}=new-proof`;
        return json({ ok: true });
      }
      if (url.startsWith("/api/founder/")) return json({}, 401);
      return signedIn ? json({ saved: true }, 201) : json({ error: "Authentication required." }, 401);
    }),
  );
  // jsdom has no requestAnimationFrame timing worth waiting on.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = `${EDITOR_CSRF_COOKIE}=; Max-Age=0`;
});

async function signIn() {
  const dialog = await screen.findByRole("dialog", { name: "Sign in again" });
  expect(dialog).toHaveTextContent("Your sign-in has expired");
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("SessionGuard", () => {
  test("a refused save opens sign-in, then goes through with the new proof", async () => {
    render(<SessionGuard />);
    expect(screen.queryByRole("dialog")).toBeNull();
    let result: Response | undefined;
    act(() => {
      void window
        .fetch("/api/captures/c1/annotations", {
          method: "POST",
          headers: { [EDITOR_CSRF_HEADER]: "old-proof" },
          body: "{}",
        })
        .then((response) => {
          result = response;
        });
    });
    await signIn();
    await waitFor(() => expect(result?.status).toBe(201));
    const retry = calls.at(-1)!;
    expect(retry.url).toBe("/api/captures/c1/annotations");
    expect(new Headers(retry.init?.headers).get(EDITOR_CSRF_HEADER)).toBe("new-proof");
    expect(retry.init?.body).toBe("{}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("several refused requests wait on one sign-in", async () => {
    render(<SessionGuard />);
    const results: number[] = [];
    act(() => {
      for (const url of ["/api/projects", "/api/captures/c1/context?x=1&y=2"]) {
        void window.fetch(url).then((response) => results.push(response.status));
      }
    });
    await signIn();
    await waitFor(() => expect(results.sort()).toEqual([201, 201]));
    expect(calls.filter((call) => call.url === "/api/auth/login")).toHaveLength(1);
  });

  test("closing the dialog lets the request fail as before", async () => {
    render(<SessionGuard />);
    let status = 0;
    act(() => {
      void window.fetch("/api/projects").then((response) => {
        status = response.status;
      });
    });
    await screen.findByRole("dialog", { name: "Sign in again" });
    fireEvent.click(screen.getByRole("button", { name: "Close sign in" }));
    await waitFor(() => expect(status).toBe(401));
    expect(calls.some((call) => call.url === "/api/auth/login")).toBe(false);
  });

  test("sign-in, founder, and other-site requests are never caught", async () => {
    render(<SessionGuard />);
    const response = await window.fetch("/api/founder/pub/session");
    expect(response.status).toBe(401);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(isEditorApiRequest("/api/auth/login")).toBe(false);
    expect(isEditorApiRequest("https://elsewhere.example/api/projects")).toBe(false);
    expect(isEditorApiRequest("/f/pub")).toBe(false);
    expect(isEditorApiRequest("/api/projects/pub/share")).toBe(true);
  });

  test("unmounting puts fetch back", () => {
    const before = window.fetch;
    const { unmount } = render(<SessionGuard />);
    expect(window.fetch).not.toBe(before);
    unmount();
    expect(window.fetch).toBe(before);
  });
});

describe("withFreshCsrf", () => {
  test("only replaces a CSRF header that was there", () => {
    document.cookie = `${EDITOR_CSRF_COOKIE}=fresh`;
    expect(withFreshCsrf(undefined)).toBeUndefined();
    const plain = { method: "GET" };
    expect(withFreshCsrf(plain)).toBe(plain);
    const next = withFreshCsrf({ headers: { [EDITOR_CSRF_HEADER]: "stale", "x-other": "1" } });
    const headers = new Headers(next?.headers);
    expect(headers.get(EDITOR_CSRF_HEADER)).toBe("fresh");
    expect(headers.get("x-other")).toBe("1");
  });
});
