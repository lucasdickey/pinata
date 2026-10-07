// @vitest-environment jsdom
// Component tests for the selection panel (VAL-PIN-003, VAL-PIN-010): the
// draft composer moved beside the pin (D074, see pin-composer.test.tsx), so
// the panel's job is the selected saved pin, the pins list, and the capture
// facts. Hostile captured text in a saved snapshot renders as inert escaped
// text, the panel copy names the one gesture that drops a pin, marks are
// named by comment and element (D078), and the internals sit behind one
// Details disclosure.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CapturePanel, PANEL_STORAGE_KEY } from "../../src/components/capture-panel";
import type { PinElementSnapshot } from "../../src/lib/annotations";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage: nothing to clear.
  }
});

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
    // Nothing is selected, so no row is open (D128).
    expect(screen.queryByTestId("panel-pin")).toBeNull();
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
    expect(name).toHaveTextContent(/^4Box 4$/);
    // The comment is shown whole beneath it, never cut (D115).
    expect(screen.getByTestId("panel-pin").querySelector(".panel-pin-body")).toHaveTextContent(
      "This whole card needs more air.",
    );
    const position = within(screen.getByTestId("panel-details")).getByTestId("panel-position");
    expect(position).toHaveAttribute("data-kind", "rectangle");
    expect(position).toHaveTextContent("100, 201 · 300 × 151 px");
    expect(screen.getByRole("button", { name: "Delete box" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete pin" })).toBeNull();
    // How to move it is the canvas help's job now (D128), not the panel's.
    expect(screen.queryByText(/Drag the/)).toBeNull();
  });

  test("the list names both kinds in number order by comment, never by position", () => {
    render(<CapturePanel {...panelProps({ pins: [pin, box] })} />);
    const list = screen.getByRole("list", { name: "Saved pins" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Pin 1 · “the comment”",
      "Box 4 · “This whole card needs more air.”",
    ]);
  });

  test("each row is in parts: number badge, comment, element line (D113)", () => {
    const resolved = { ...pin, status: "resolved" as const };
    const answered = { ...box, unreadReplies: 2 };
    render(<CapturePanel {...panelProps({ pins: [resolved, answered] })} />);
    // A resolved mark sits in the closed "1 resolved" group (D128).
    const [first] = within(screen.getByRole("list", { name: "Resolved pins", hidden: true })).getAllByRole(
      "button",
      { hidden: true },
    );
    const [second] = within(screen.getByRole("list", { name: "Saved pins" })).getAllByRole("button");
    // The badge carries the number the canvas shows; the comment is the
    // main line, whole (the clamp is CSS), and the element sits under it.
    expect(first!.querySelector(".pin-row-badge")).toHaveTextContent("1");
    expect(first!.querySelector(".pin-row-comment")).toHaveTextContent("the comment");
    expect(first!.querySelector(".pin-row-element")).toHaveTextContent("No element");
    expect(first).toHaveAttribute("data-status", "resolved");
    expect(first).toHaveAccessibleName("Pin 1 · “the comment” · Resolved");
    expect(second!.querySelector(".pin-row-badge")).toHaveAttribute("data-kind", "rectangle");
    expect(second!.querySelector(".pin-row-element")).toHaveTextContent(/^Box · /);
    expect(second!.querySelector(".pin-row-meta")).toHaveTextContent("2 new");
    expect(second).toHaveAccessibleName("Box 4 · “This whole card needs more air.” · 2 new");
  });

  test("a selected pin is named the same way", () => {
    render(<CapturePanel {...panelProps({ pins: [pin, box], selectedPinId: "ann-1" })} />);
    expect(screen.getByTestId("panel-mark-name")).toHaveTextContent(/^1Pin 1$/);
    expect(within(screen.getByTestId("panel-details")).getByTestId("panel-position")).toHaveTextContent(
      "10, 10 px",
    );
    expect(screen.getByRole("button", { name: "Delete pin" })).toBeInTheDocument();
  });

  test("a selected circle is named Circle, keeps its center and width behind Details, and has circle controls", () => {
    const circle = {
      id: "circle-5",
      captureId: "cap-1",
      kind: "circle" as const,
      number: 5,
      circle: { x: 100.4, y: 200.6, size: 300.2 },
      body: "Draw the eye to this badge.",
      elementSnapshot: null,
      revision: 1,
      status: "open" as const,
      unreadReplies: 0,
      createdAt: 3,
    };
    render(<CapturePanel {...panelProps({ pins: [pin, circle], selectedPinId: "circle-5" })} />);
    const name = screen.getByTestId("panel-mark-name");
    expect(name).toHaveAttribute("data-kind", "circle");
    expect(name).toHaveTextContent(/^5Circle 5$/);
    const details = screen.getByTestId("panel-details");
    expect(within(details).getByText("Circle")).toBeInTheDocument();
    const position = within(details).getByTestId("panel-position");
    expect(position).toHaveAttribute("data-kind", "circle");
    expect(position).toHaveTextContent("251, 351 · 300 wide px");
    expect(screen.getByRole("button", { name: "Delete circle" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete box" })).toBeNull();
    // How to move it is the canvas help's job now (D128), not the panel's.
    expect(screen.queryByText(/Drag the/)).toBeNull();
  });

  test("a selected arrow is named Arrow, keeps both points behind Details, and has arrow controls", () => {
    const pointer = {
      id: "arrow-6",
      captureId: "cap-1",
      kind: "arrow" as const,
      number: 6,
      arrow: { start: { x: 100.4, y: 200.6 }, end: { x: 400.2, y: 600.9 } },
      body: "Move this up into the header.",
      elementSnapshot: null,
      revision: 1,
      status: "open" as const,
      unreadReplies: 0,
      createdAt: 4,
    };
    render(<CapturePanel {...panelProps({ pins: [pin, pointer], selectedPinId: "arrow-6" })} />);
    const name = screen.getByTestId("panel-mark-name");
    expect(name).toHaveAttribute("data-kind", "arrow");
    expect(name).toHaveTextContent(/^6Arrow 6$/);
    const details = screen.getByTestId("panel-details");
    expect(within(details).getByText("Arrow")).toBeInTheDocument();
    const position = within(details).getByTestId("panel-position");
    expect(position).toHaveAttribute("data-kind", "arrow");
    expect(position).toHaveTextContent("100, 201 → 400, 601 px");
    expect(screen.getByRole("button", { name: "Delete arrow" })).toBeInTheDocument();
    // How to move it is the canvas help's job now (D128), not the panel's.
    expect(screen.queryByText(/Drag the/)).toBeNull();
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
    // Its title, then the comment and the element in full (D115).
    expect(screen.getByTestId("panel-mark-name")).toHaveTextContent(/^1Pin 1$/);
    expect(selection).toHaveTextContent("the comment");
    expect(selection).toHaveTextContent("Starter plan");
    expect(selection.textContent).not.toMatch(/\d+, \d+/);
    expect(selection.textContent).not.toMatch(/natural pixel/i);
    // Page and device moved behind Details with the rest (D128): the
    // toolbar above the canvas already names both.
    const panel = screen.getByTestId("capture-panel");
    const visible = panel.textContent!.replace(details.textContent!, "");
    expect(details).toHaveTextContent("https://chickpea.co/pricing");
    expect(details).toHaveTextContent("Desktop");
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
      "Escape cancels, then lets go of the selected mark",
      "J and K, or the arrow keys, step through the marks",
      "N drops a pin at the center of the view",
      "B, C, or A arms the box, circle, or arrow tool for the next drag",
      "Shift-drag also draws a box",
    ]);
    // With nothing selected there is no position row.
    expect(within(details).queryByTestId("panel-position")).toBeNull();
  });
});

describe("collapsing the panel (D112)", () => {
  const saved = {
    id: "ann-2",
    captureId: "cap-1",
    kind: "pin" as const,
    number: 2,
    tip: { x: 10, y: 10 },
    body: "Tighten this.",
    elementSnapshot: null,
    revision: 1,
    status: "open" as const,
    unreadReplies: 0,
    createdAt: 1,
  };
  const panel = () => screen.getByTestId("capture-panel");
  const body = () => document.getElementById("capture-panel-body")!;

  test("the toggle hides the content but keeps it mounted, and shows it again", () => {
    render(<CapturePanel {...panelProps({ pins: [saved] })} />);
    const hide = screen.getByRole("button", { name: "Hide details panel" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    expect(hide).toHaveAttribute("aria-controls", "capture-panel-body");
    fireEvent.click(hide);
    expect(panel()).toHaveAttribute("data-collapsed", "true");
    // Hidden, not removed: the list is still in the document.
    expect(body()).not.toBeVisible();
    expect(body().querySelector('[aria-label="Saved pins"]')).not.toBeNull();
    expect(screen.queryByRole("list", { name: "Saved pins" })).toBeNull();
    const show = screen.getByRole("button", { name: "Show details panel" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(show);
    expect(panel()).not.toHaveAttribute("data-collapsed");
    expect(screen.getByRole("list", { name: "Saved pins" })).toBeInTheDocument();
  });

  test("the choice is remembered in this browser and read back after mount", async () => {
    const first = render(<CapturePanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide details panel" }));
    expect(window.localStorage.getItem(PANEL_STORAGE_KEY)).toBe("collapsed");
    first.unmount();
    render(<CapturePanel {...panelProps()} />);
    await waitFor(() => expect(panel()).toHaveAttribute("data-collapsed", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Show details panel" }));
    expect(window.localStorage.getItem(PANEL_STORAGE_KEY)).toBe("open");
  });

  test("blocked storage never breaks the toggle", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<CapturePanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide details panel" }));
    expect(panel()).toHaveAttribute("data-collapsed", "true");
  });

  test("a selection made while collapsed shows as a badge on the strip, without opening it", () => {
    const view = render(<CapturePanel {...panelProps({ pins: [saved] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide details panel" }));
    expect(screen.queryByTestId("panel-strip-badge")).toBeNull();
    view.rerender(<CapturePanel {...panelProps({ pins: [saved], selectedPinId: "ann-2" })} />);
    const badge = screen.getByTestId("panel-strip-badge");
    expect(badge).toHaveTextContent("2");
    expect(badge).toHaveAccessibleName("Pin 2 selected");
    expect(panel()).toHaveAttribute("data-collapsed", "true");
  });
});

describe("letting go of a selection (D116)", () => {
  const saved = {
    id: "ann-3",
    captureId: "cap-1",
    kind: "pin" as const,
    number: 3,
    tip: { x: 10, y: 10 },
    body: "Too loud.",
    elementSnapshot: null,
    revision: 1,
    status: "open" as const,
    unreadReplies: 0,
    createdAt: 1,
  };

  test("Clear selection is offered only while something is selected, and clears it", () => {
    const onSelectPin = vi.fn();
    const view = render(<CapturePanel {...panelProps({ pins: [saved], onSelectPin })} />);
    expect(screen.queryByRole("button", { name: "Clear selection" })).toBeNull();
    view.rerender(
      <CapturePanel {...panelProps({ pins: [saved], onSelectPin, selectedPinId: "ann-3" })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onSelectPin).toHaveBeenCalledWith(null);
  });

  test("the actions fit on one line: short words, full names", () => {
    render(
      <CapturePanel
        {...panelProps({ pins: [saved], selectedPinId: "ann-3", onSetPinStatus: vi.fn() })}
      />,
    );
    const resolve = screen.getByRole("button", { name: "Resolve pin" });
    expect(resolve).toHaveTextContent(/^Resolve$/);
    expect(screen.getByRole("button", { name: "Edit comment" })).toHaveTextContent(/^Edit$/);
    expect(screen.getByRole("button", { name: "Delete pin" })).toHaveTextContent(/^Delete$/);
  });
});

describe("the pin accordion (D128)", () => {
  const base = {
    captureId: "cap-1",
    elementSnapshot: null,
    revision: 1,
    unreadReplies: 0,
    createdAt: 1,
  };
  const marks = [
    { ...base, id: "a1", kind: "pin" as const, number: 1, tip: { x: 1, y: 1 }, body: "first note", status: "open" as const },
    { ...base, id: "a2", kind: "pin" as const, number: 2, tip: { x: 2, y: 2 }, body: "second note", status: "open" as const },
    { ...base, id: "a3", kind: "pin" as const, number: 3, tip: { x: 3, y: 3 }, body: "done note", status: "resolved" as const },
  ];

  test("the selected row opens in place, shows its comment once, and the others stay rows", () => {
    render(<CapturePanel {...panelProps({ pins: marks, selectedPinId: "a1" })} />);
    const list = screen.getByRole("list", { name: "Saved pins" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // The open body sits inside the first item, before the second row.
    expect(items[0]).toHaveAttribute("data-testid", "panel-pin");
    expect(items[1]).not.toHaveAttribute("data-testid");
    const header = within(items[0]!).getByRole("button", { name: "Pin 1 · “first note”" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(within(items[1]!).getByRole("button")).toHaveAttribute("aria-expanded", "false");
    // The comment appears exactly once in the panel.
    const panel = screen.getByTestId("capture-panel");
    expect(panel.textContent!.split("first note")).toHaveLength(2);
  });

  test("resolved marks gather in a closed group that opens for a selected resolved mark", () => {
    const { rerender } = render(<CapturePanel {...panelProps({ pins: marks })} />);
    const group = screen.getByTestId("pin-resolved");
    expect(group).not.toHaveAttribute("open");
    expect(group.querySelector("summary")).toHaveTextContent("1 resolved");
    rerender(<CapturePanel {...panelProps({ pins: marks, selectedPinId: "a3" })} />);
    expect(screen.getByTestId("pin-resolved")).toHaveAttribute("open");
    expect(within(screen.getByTestId("pin-resolved")).getByTestId("panel-pin")).toHaveTextContent("done note");
  });

  test("deleting asks first and says the number is retired", () => {
    render(
      <CapturePanel {...panelProps({ pins: marks, selectedPinId: "a2", confirmingDelete: true })} />,
    );
    expect(within(screen.getByTestId("panel-pin")).getByText(/Delete Pin 2\? Its number is retired/)).toBeInTheDocument();
  });
});
