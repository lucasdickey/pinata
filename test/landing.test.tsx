// @vitest-environment jsdom
// The anonymous landing page (VAL-LANDING-001, VAL-LANDING-002): the pinata
// mark sits directly above the URL capture entry (required root URL, optional
// additional rows, one visible primary action), a brief value proposition, a
// fully static example of a marked-up capture (two numbered pins, a two-entry
// comment thread, a DOM metadata panel), and a clear sign-in path — with no
// network traffic of any kind on render.
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CAPTURE_DRAFT_STORAGE_KEY } from "../src/lib/capture-draft";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { AnonymousLanding } from "../src/components/landing";
import { EXAMPLE_CAPTURE } from "../src/lib/example-capture";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("anonymous landing", () => {
  test("renders the brand mark directly above the capture entry form", () => {
    render(<AnonymousLanding />);
    expect(screen.getByRole("heading", { level: 1, name: "pinata" })).toBeInTheDocument();
    const logo = screen.getByRole("img", { name: "pinata logo" });
    expect(logo.tagName.toLowerCase()).toBe("svg");
    const rootField = screen.getByLabelText("Root URL");
    // DOM order: the logo precedes the capture form.
    expect(
      logo.compareDocumentPosition(rootField) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The form contract: required root URL, add-more-URLs control, one
    // visible primary action.
    expect(rootField).toBeRequired();
    expect(screen.getByRole("button", { name: "Add URL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start capturing" })).toBeInTheDocument();
    // A brief value proposition.
    expect(screen.getByText(/pin plain, directional notes/i)).toBeInTheDocument();
    // Rendering the page fired no request at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("renders the static example: pins, comment thread, and DOM metadata", () => {
    const { container } = render(<AnonymousLanding />);
    const shot = screen.getByTestId("example-shot");
    // The screenshot region names its project/page/device/version context.
    expect(shot).toHaveAttribute(
      "aria-label",
      expect.stringContaining(EXAMPLE_CAPTURE.pageUrl),
    );
    expect(shot.getAttribute("aria-label")).toContain(EXAMPLE_CAPTURE.device);
    // At least two numbered pins inside the screenshot region.
    const pins = shot.querySelectorAll("[data-pin-number]");
    expect(pins.length).toBeGreaterThanOrEqual(2);
    expect([...pins].map((p) => p.getAttribute("data-pin-number"))).toContain("1");
    // A comment thread with at least two entries.
    const thread = screen.getByRole("list", { name: "Example thread" });
    expect(within(thread).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    // A visible DOM metadata panel.
    expect(screen.getByRole("heading", { name: "DOM context" })).toBeInTheDocument();
    const example = container.querySelector(".landing-example")!;
    expect(example.textContent).toContain(EXAMPLE_CAPTURE.pins[0]!.element!.text);
    expect(example.textContent).toContain(EXAMPLE_CAPTURE.pins[0]!.element!.role);
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

  test("a clear sign-in path is part of the page", () => {
    render(<AnonymousLanding />);
    expect(screen.getByRole("heading", { name: "Editor sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  test("submitting the entry parks a draft and routes to sign-in, with no request", () => {
    render(<AnonymousLanding />);
    fireEvent.change(screen.getByLabelText("Root URL"), {
      target: { value: "https://chickpea.co/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add URL" }));
    fireEvent.change(screen.getByLabelText("URL 2"), {
      target: { value: "https://chickpea.co/pricing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start capturing" }));

    // The draft is parked for the editor form to consume after sign-in.
    expect(JSON.parse(sessionStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY)!)).toEqual({
      rootUrl: "https://chickpea.co/",
      urls: ["https://chickpea.co/pricing"],
    });
    // Routed to the sign-in prompt: focus lands on the password field, and a
    // status line explains the handoff. No request was made.
    expect(screen.getByLabelText("Password")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(/sign in/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a blank root URL is a named inline error and parks nothing", () => {
    render(<AnonymousLanding />);
    fireEvent.click(screen.getByRole("button", { name: "Start capturing" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/public https/i);
    expect(screen.getByLabelText("Root URL")).toHaveFocus();
    expect(sessionStorage.getItem(CAPTURE_DRAFT_STORAGE_KEY)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
