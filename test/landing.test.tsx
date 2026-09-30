// @vitest-environment jsdom
// The anonymous landing page (VAL-LANDING-001, VAL-LANDING-002): the pinata
// mark, the name, a brief value proposition, and a call to sign in — with no
// address field before sign-in (D103) — then a fully static example of a
// marked-up capture, and the sign-in form itself, with no network traffic of
// any kind on render.
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { AnonymousLanding } from "../src/components/landing";
import { EXAMPLE_CAPTURE } from "../src/lib/example-capture";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("anonymous landing", () => {
  test("renders the brand and a sign-in call, and takes no address before sign-in", async () => {
    render(<AnonymousLanding />);
    expect(screen.getByRole("heading", { level: 1, name: "pinata" })).toBeInTheDocument();
    const logo = screen.getByRole("img", { name: "pinata logo" });
    expect(logo.tagName.toLowerCase()).toBe("svg");
    // The mark opens the page, ahead of the heading.
    const heading = screen.getByRole("heading", { level: 1, name: "pinata" });
    expect(logo.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A brief value proposition.
    expect(screen.getByText(/pin plain, directional notes/i)).toBeInTheDocument();
    // D103: creating a project lives behind sign-in, so the public page has
    // no address field and no capture action at all.
    expect(screen.queryByLabelText("Root URL")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start capturing" })).toBeNull();
    // The hero's way in opens the sign-in modal.
    const cta = screen.getByRole("button", { name: "Sign in to start a review" });
    expect(document.getElementById("editor-login")).toBeNull();
    fireEvent.click(cta);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Editor sign in" })).toBeInTheDocument());
    // Rendering the page fired no request at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("renders the static example: one mark of each kind, a thread, and DOM metadata", () => {
    const { container } = render(<AnonymousLanding />);
    const shot = screen.getByTestId("example-shot");
    // The screenshot region names its project/page/device/version context.
    expect(shot).toHaveAttribute(
      "aria-label",
      expect.stringContaining(EXAMPLE_CAPTURE.pageUrl),
    );
    expect(shot.getAttribute("aria-label")).toContain(EXAMPLE_CAPTURE.device);
    // D103: one numbered mark of each kind inside the screenshot region,
    // numbered 1 to 4 the way a capture numbers its marks.
    const marks = [...shot.querySelectorAll("[data-mark-number]")];
    expect(marks.map((m) => m.getAttribute("data-mark-number"))).toEqual(["1", "2", "3", "4"]);
    expect(new Set(marks.map((m) => m.getAttribute("data-mark-kind")))).toEqual(
      new Set(["pin", "circle", "arrow", "rectangle"]),
    );
    // The panel lists every mark by the product's own names.
    const list = screen.getByRole("list", { name: "Example marks" });
    const names = within(list).getAllByRole("listitem").map((item) => item.textContent);
    expect(names.map((name) => name!.split(" · ")[0])).toEqual([
      "Pin 1",
      "Circle 2",
      "Arrow 3",
      "Box 4",
    ]);
    // A comment thread with at least two entries.
    const thread = screen.getByRole("list", { name: "Example thread" });
    expect(within(thread).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    // A visible DOM metadata panel.
    expect(screen.getByRole("heading", { name: "DOM context" })).toBeInTheDocument();
    const example = container.querySelector(".landing-example")!;
    expect(example.textContent).toContain(EXAMPLE_CAPTURE.marks[0]!.element!.text);
    expect(example.textContent).toContain(EXAMPLE_CAPTURE.marks[0]!.element!.role);
    // No interactive reply or editing control is depicted (threads are
    // deferred, D051): the example contains no form controls at all.
    expect(example.querySelector("input, textarea, button, select")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the example renderer carries no client runtime or fetch of its own", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/example-capture.tsx"),
      "utf8",
    );
    expect(source).not.toContain("use client");
    expect(source).not.toMatch(/fetch\(|useEffect|useState/);
    const fixture = readFileSync(
      join(process.cwd(), "src/lib/example-capture.ts"),
      "utf8",
    );
    expect(fixture).not.toMatch(/fetch\(/);
  });

  test("a clear sign-in path opens the modal", async () => {
    render(<AnonymousLanding />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Editor sign in" })).toBeInTheDocument());
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });
});
