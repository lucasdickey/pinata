// @vitest-environment jsdom
// Component tests for the selection panel (VAL-PIN-003, VAL-PIN-010): the
// draft composer moved beside the pin (D074, see pin-composer.test.tsx), so
// the panel's job is the selected saved pin, the pins list, and the capture
// facts. Hostile captured text in a saved snapshot renders as inert escaped
// text, the panel copy names the one gesture that drops a pin, marks are
// named by comment and element (D078), and the internals sit behind one
// Details disclosure.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CapturePanel } from "../../src/components/capture-panel";
import type { PinElementSnapshot } from "../../src/lib/annotations";

afterEach(() => cleanup());

function candidate(id: string, overrides: Partial<PinElementSnapshot> = {}): PinElementSnapshot {
  return {
    id,
    kind: "table-cell",
    tag: "td",
    role: "cell",
    text: `cell copy ${id}`,
    accessibleName: "",
    hints: { id: "", classes: [], alt: "", title: "", testId: "" },
    path: ["body:0", "main:0", "table:0", "tr:2", "td:3"],
    rect: { x: 808.5, y: 4202.25, width: 216.75, height: 98.5 },
    ...overrides,
  };
}

function panelProps(overrides: Record<string, unknown> = {}) {
  return {
    attempt: {
      id: "cap-1",
      variant: "desktop",
      attempt: 1,
      state: "ready" as const,
      errorCode: null,
      imageHash: "hash",
      documentWidth: 1440,
      documentHeight: 8966,
    },
    pageUrl: "https://chickpea.co/pricing",
    variant: "desktop",
    ready: true,
    pinsStatus: "ready" as const,
    pins: [],
    selectedPinId: null,
    onSelectPin: vi.fn(),
    moveError: null,
    editing: false,
    editBody: "",
    onEditBodyChange: vi.fn(),
    onStartEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onSaveEdit: vi.fn(),
    editState: "idle" as const,
    confirmingDelete: false,
    onRequestDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    deleteState: "idle" as const,
    ...overrides,
  };
}

describe("no draft surface in the panel", () => {
  test("renders no comment editor, candidate radios, or draft context marker", () => {
    render(<CapturePanel {...panelProps()} />);
    expect(screen.queryByLabelText("Comment")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(document.querySelector('[data-testid="draft-context"]')).toBeNull();
    expect(screen.getByText("Nothing selected.")).toBeInTheDocument();
  });

  test("the empty-list note names the one gesture, with no mode to switch to", () => {
    render(<CapturePanel {...panelProps()} />);
    const note = screen.getByText(/No pins yet/);
    expect(note).toHaveTextContent(/click or tap the page/i);
    expect(note.textContent?.toLowerCase()).not.toContain("place pin");
  });
});

describe("hostile captured content", () => {
  test("a saved pin's snapshot renders as inert escaped text", () => {
    const pin = {
      id: "ann-1",
      captureId: "cap-1",
      kind: "pin" as const,
      number: 3,
      tip: { x: 10, y: 10 },
      body: "the comment",
      elementSnapshot: candidate("evil-2", {
        text: '<form action="https://evil.invalid">x</form>',
      }),
      revision: 1,
      createdAt: 1,
    };
    render(<CapturePanel {...panelProps({ pins: [pin], selectedPinId: "ann-1" })} />);
    const snapshot = document.querySelector('[data-testid="panel-snapshot"]')!;
    expect(snapshot.textContent).toContain('<form action="https://evil.invalid">x</form>');
    expect(snapshot.querySelector("form")).toBeNull();
    // The move instruction no longer names a mode.
    expect(screen.getByText(/Drag the pin on the screenshot/).textContent).not.toMatch(
      /place pin/i,
    );
  });
});

describe("rectangles in the panel (D079)", () => {
  const box = {
    id: "box-4",
    captureId: "cap-1",
    kind: "rectangle" as const,
    number: 4,
    rect: { x: 100.4, y: 200.6, width: 300.2, height: 150.5 },
    body: "This whole card needs more air.",
    elementSnapshot: null,
    revision: 2,
    status: "open" as const,
    unreadReplies: 0,
    createdAt: 2,
  };
  const pin = {
    id: "ann-1",
    captureId: "cap-1",
    kind: "pin" as const,
    number: 1,
    tip: { x: 10, y: 10 },
    body: "the comment",
    elementSnapshot: null,
    revision: 1,
    status: "open" as const,
    unreadReplies: 0,
    createdAt: 1,
  };

  test("the selected box is named by its comment, keeps its bounds behind Details, and has box controls", () => {
    render(<CapturePanel {...panelProps({ pins: [pin, box], selectedPinId: "box-4" })} />);
    const name = screen.getByTestId("panel-mark-name");
    expect(name).toHaveAttribute("data-kind", "rectangle");
    expect(name).toHaveTextContent("Box 4 · “This whole card needs more air.”");
    const position = within(screen.getByTestId("panel-details")).getByTestId("panel-position");
    expect(position).toHaveAttribute("data-kind", "rectangle");
    expect(position).toHaveTextContent("100, 201 · 300 × 151 px");
    expect(screen.getByRole("button", { name: "Delete box" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete pin" })).toBeNull();
    expect(screen.getByText(/Drag the box's edge or badge/)).toBeInTheDocument();
  });

  test("the list names both kinds in number order by comment, never by position", () => {
    render(<CapturePanel {...panelProps({ pins: [pin, box] })} />);
    const list = screen.getByRole("list", { name: "Saved pins" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Pin 1 · “the comment”",
      "Box 4 · “This whole card needs more air.”",
    ]);
  });

  test("a selected pin is named the same way", () => {
    render(<CapturePanel {...panelProps({ pins: [pin, box], selectedPinId: "ann-1" })} />);
    expect(screen.getByTestId("panel-mark-name")).toHaveTextContent("Pin 1 · “the comment”");
    expect(within(screen.getByTestId("panel-details")).getByTestId("panel-position")).toHaveTextContent(
      "10, 10 px",
    );
    expect(screen.getByRole("button", { name: "Delete pin" })).toBeInTheDocument();
  });
});

// The internals behind one disclosure (D078): closed by default, a real
// <summary>, the capture facts and coordinates inside, and the keyboard list.
describe("Details disclosure (D078)", () => {
  const pin = {
    id: "ann-1",
    captureId: "cap-1",
    kind: "pin" as const,
    number: 1,
    tip: { x: 10.4, y: 10.6 },
    body: "the comment",
    elementSnapshot: candidate("el-1", { text: "Starter plan" }),
    revision: 1,
    status: "open" as const,
    unreadReplies: 0,
    createdAt: 1,
  };

  test("is a native details element, closed by default, with a summary that says Details", () => {
    render(<CapturePanel {...panelProps({ pins: [pin], selectedPinId: "ann-1" })} />);
    const details = screen.getByTestId("panel-details") as HTMLDetailsElement;
    expect(details.tagName.toLowerCase()).toBe("details");
    expect(details.open).toBe(false);
    const summary = details.querySelector(":scope > summary")!;
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent("Details");
    // Not a heading: the panel's heading order is the h4s alone.
    expect(within(details).queryByRole("heading")).toBeNull();
  });

  test("holds the coordinates, version, state, size, and hash, and nothing outside it prints them", () => {
    render(<CapturePanel {...panelProps({ pins: [pin], selectedPinId: "ann-1" })} />);
    const details = screen.getByTestId("panel-details");
    expect(details).toHaveTextContent("Position");
    expect(within(details).getByTestId("panel-position")).toHaveTextContent("10, 11 px");
    expect(details).toHaveTextContent("v1");
    expect(details).toHaveTextContent("Ready");
    expect(details).toHaveTextContent("1440 × 8966 px");
    expect(details).toHaveTextContent("hash");
    // The selection block itself names the pin without coordinates.
    const selection = screen.getByTestId("panel-pin");
    expect(selection).toHaveTextContent("Pin 1 · “the comment” · Starter plan");
    expect(selection.textContent).not.toMatch(/\d+, \d+/);
    expect(selection.textContent).not.toMatch(/natural pixel/i);
    // Page and device stay in plain view under Capture.
    const panel = screen.getByTestId("capture-panel");
    const visible = panel.textContent!.replace(details.textContent!, "");
    expect(visible).toContain("https://chickpea.co/pricing");
    expect(visible).toContain("Desktop");
    expect(visible).not.toContain("Image hash");
    expect(visible).not.toContain("Version");
  });

  test("lists the keyboard shortcuts", () => {
    render(<CapturePanel {...panelProps()} />);
    const details = screen.getByTestId("panel-details");
    const keys = within(details).getByTestId("panel-keys");
    const items = within(keys).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "Enter saves a comment; Shift+Enter starts a new line",
      "Escape cancels",
      "J and K, or the arrow keys, step through the marks",
      "N drops a pin at the center of the view",
      "Shift-drag, or the Box tool, draws a box",
    ]);
    // With nothing selected there is no position row.
    expect(within(details).queryByTestId("panel-position")).toBeNull();
  });
});
