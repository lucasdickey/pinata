// @vitest-environment jsdom
// The anonymous landing page (VAL-LANDING-001, VAL-LANDING-002): the pinata
// mark, the name, a brief value proposition, and a call to sign in — with no
// address field before sign-in (D103) — then a fully static example of a
// marked-up capture, and the sign-in form itself, with no network traffic of
// any kind on render.
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  test("renders the brand and a sign-in call, and takes no address before sign-in", () => {
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
    // The hero's way in is a call to sign in, pointing at the sign-in form.
    // It opens the one sign-in dialog (D123), which starts closed.
    const cta = screen.getByRole("button", { name: "Sign in to start a review" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(cta);
    expect(screen.getByRole("dialog", { name: "Editor sign in" })).toBeInTheDocument();
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
    // D107: technical details are available on demand, below the example.
    const details = container.querySelector("details")!;
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(within(details).getByText("Explore the details behind each pin"));
    // The details are the app's own pin table (D126): one row per mark,
    // named and badged the way the workspace names them.
    const table = within(details).getByRole("table");
    const rows = within(table).getAllByRole("rowheader").map((cell) => cell.textContent);
    expect(rows).toEqual(["1Pin 1", "2Circle 2", "3Arrow 3", "4Box 4"]);
    // A comment thread with at least two entries.
    const thread = screen.getByRole("list", { name: "Example thread" });
    expect(within(thread).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    // The element context shows in the table: text, role, and path.
    const example = container.querySelector(".landing-example")!;
    expect(table.textContent).toContain(EXAMPLE_CAPTURE.marks[0]!.element!.text);
    expect(table.textContent).toContain(EXAMPLE_CAPTURE.marks[0]!.element!.role);
    expect(table.textContent).toContain(EXAMPLE_CAPTURE.marks[0]!.element!.path.join(" > "));
    // No reply or editing control is depicted (D051): no fields at all, and
    // the only buttons are the table's own (select a row, copy as Markdown).
    expect(example.querySelector("input, textarea, select")).toBeNull();
    for (const button of example.querySelectorAll("button")) {
      expect(button.closest(".pin-table")).not.toBeNull();
    }
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

  test("the halftone washes are decoration only, drawn by CSS with no image (D119)", () => {
    render(<AnonymousLanding />);
    const washes = document.querySelectorAll(".landing-halftone");
    expect(washes).toHaveLength(2);
    for (const wash of washes) {
      // Hidden from assistive tech, empty, and not focusable.
      expect(wash).toHaveAttribute("aria-hidden", "true");
      // Nothing in it but its glow layer.
      expect([...wash.children].map((child) => child.className)).toEqual(["landing-halftone-glow"]);
      expect(wash.textContent).toBe("");
    }
    // One behind the hero, one inside the sign-in card.
    expect(washes[0]).toHaveClass("landing-halftone--hero");
    expect(washes[1]!.closest(".landing-invitation")).not.toBeNull();
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const block = css.slice(css.indexOf(".landing-halftone {"), css.indexOf(".landing-halftone--card {"));
    // The dots are gradients, never a fetched image, and the ink is the
    // accent token so both themes follow it.
    expect(block).not.toMatch(/url\(/);
    expect(block).toMatch(/background: var\(--accent\)/);
    // The group itself paints nothing, so contrast checks see the page
    // colour the text really sits on.
    const group = css.slice(css.indexOf(".landing-halftone {"), css.indexOf("}", css.indexOf(".landing-halftone {")));
    expect(group).not.toMatch(/background/);
    expect(block).toMatch(/pointer-events: none/);
    // Gone in forced-colors (high contrast) mode.
    expect(css).toMatch(/@media \(forced-colors: active\) \{\s*\.landing-halftone \{\s*display: none;/);
  });

  test("a clear sign-in path is part of the page", () => {
    render(<AnonymousLanding />);
    // Every sign-in call opens the same dialog, with focus in the password
    // field; Escape closes it and returns focus to the button (D123).
    const calls = screen.getAllByRole("button", { name: /sign in/i });
    expect(calls.map((button) => button.textContent)).toEqual([
      "Sign in",
      "Sign in to start a review",
      "Sign in",
      "editor sign in",
    ]);
    for (const call of calls) {
      call.focus();
      fireEvent.click(call);
      const dialog = screen.getByRole("dialog", { name: "Editor sign in" });
      expect(within(dialog).getByLabelText("Password")).toHaveFocus();
      fireEvent.keyDown(within(dialog).getByLabelText("Password"), { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(call).toHaveFocus();
    }
  });
});
