// @vitest-environment jsdom
// Component tests for the selection panel (VAL-PIN-003, VAL-PIN-010): the
// draft composer moved beside the pin (D074, see pin-composer.test.tsx), so
// the panel's job is the selected saved pin, the pins list, and the capture
// facts. Hostile captured text in a saved snapshot renders as inert escaped
// text, and the panel copy names the one gesture that drops a pin.

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

  test("the selected box shows its bounds and box-specific controls", () => {
    render(<CapturePanel {...panelProps({ pins: [pin, box], selectedPinId: "box-4" })} />);
    const position = document.querySelector('[data-testid="panel-position"]')!;
    expect(position).toHaveAttribute("data-kind", "rectangle");
    expect(position).toHaveTextContent("Box 4 at natural pixels (100, 201 · 300 × 151)");
    expect(screen.getByRole("button", { name: "Delete box" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete pin" })).toBeNull();
    expect(screen.getByText(/Drag the box's edge or badge/)).toBeInTheDocument();
  });

  test("the list names both kinds in number order with their positions", () => {
    render(<CapturePanel {...panelProps({ pins: [pin, box] })} />);
    const list = screen.getByRole("list", { name: "Saved pins" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Pin 1 — at (10, 10)",
      "Box 4 — at (100, 201 · 300 × 151)",
    ]);
  });

  test("a selected pin still reads as before", () => {
    render(<CapturePanel {...panelProps({ pins: [pin, box], selectedPinId: "ann-1" })} />);
    expect(document.querySelector('[data-testid="panel-position"]')).toHaveTextContent(
      "Pin 1 at natural pixel (10, 10)",
    );
    expect(screen.getByRole("button", { name: "Delete pin" })).toBeInTheDocument();
  });
});
