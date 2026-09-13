// @vitest-environment jsdom
// Component tests for the canvas's read-only plane (the founder's view,
// REQUIREMENTS 6 and 7): a click on the screenshot creates no draft and no
// composer, persisted pins are never draggable, the editor's keyboard
// shortcuts are absent, and selecting a pin to read it still works. The
// default (editable) plane is unchanged — capture-canvas.test.tsx keeps
// proving that.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CaptureCanvas } from "../../src/components/capture-canvas";
import { installReactFlowMocks } from "../helpers/react-flow";

installReactFlowMocks();

afterEach(() => cleanup());

const props = {
  captureId: "cap-founder-desktop-v1",
  pageUrl: "https://chickpea.co/",
  variant: "Desktop",
  attempt: 1,
  width: 1440,
  height: 8966,
};

const pins = [
  { id: "ann-1", number: 1, tip: { x: 720, y: 4000 } },
  { id: "ann-2", number: 2, tip: { x: 100, y: 200 } },
];

const composer = {
  draftBody: "",
  onDraftBodyChange: vi.fn(),
  draftChoice: null,
  onDraftChoiceChange: vi.fn(),
  draftCandidates: { status: "ready" as const, items: [] },
  onPreviewCandidate: vi.fn(),
  onSaveDraft: vi.fn(),
  onCancelDraft: vi.fn(),
  saveState: "idle" as const,
};

function stage(): HTMLElement {
  return document.querySelector('[data-testid="capture-stage"]') as HTMLElement;
}

function frameImage(): HTMLElement {
  return document.querySelector(".capture-frame-image") as HTMLElement;
}

function tap(target: Element, x: number, y: number): void {
  fireEvent.pointerDown(target, { clientX: x, clientY: y, isPrimary: true });
  fireEvent.pointerUp(target, { clientX: x, clientY: y, isPrimary: true });
}

describe("readOnly canvas", () => {
  test("renders only camera controls and marks the region read-only", () => {
    render(<CaptureCanvas {...props} readOnly pins={pins} />);
    expect(within(stage()).getByRole("group", { name: "Camera modes and zoom" })).toBeInTheDocument();
    expect(within(stage()).getByRole("button", { name: "Entire page" })).toBeInTheDocument();
    expect(within(stage()).getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    // No editing tool of any kind: no second toolbar, no composer.
    expect(within(stage()).queryByRole("group", { name: "Canvas tools" })).toBeNull();
    expect(within(stage()).queryByRole("dialog")).toBeNull();
    const region = within(stage()).getByRole("region");
    expect(region).toHaveAttribute("data-read-only", "true");
    // The editor's shortcuts have no focus target here.
    expect(region).not.toHaveAttribute("tabindex");
    expect(region).not.toHaveAttribute("aria-keyshortcuts");
  });

  test("the default plane is unchanged: focusable region and no read-only marker", () => {
    render(<CaptureCanvas {...props} pins={pins} />);
    const region = within(stage()).getByRole("region");
    expect(region).not.toHaveAttribute("data-read-only");
    expect(region).toHaveAttribute("tabindex", "0");
  });

  test("a click on the screenshot never creates a draft, a composer, or a report", () => {
    const onDraftChange = vi.fn();
    const onDraftSettled = vi.fn();
    render(
      <CaptureCanvas
        {...props}
        readOnly
        pins={pins}
        composer={composer}
        onDraftChange={onDraftChange}
        onDraftSettled={onDraftSettled}
      />,
    );
    tap(frameImage(), 400, 300);
    tap(frameImage(), 420, 320);
    expect(document.querySelectorAll(".react-flow__node-draftPin")).toHaveLength(0);
    expect(within(stage()).queryByRole("dialog")).toBeNull();
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onDraftSettled).not.toHaveBeenCalled();
  });

  test("the N and J shortcuts do nothing on a read-only plane", () => {
    const onDraftChange = vi.fn();
    const onSelectPin = vi.fn();
    render(
      <CaptureCanvas
        {...props}
        readOnly
        pins={pins}
        onDraftChange={onDraftChange}
        onSelectPin={onSelectPin}
      />,
    );
    const region = within(stage()).getByRole("region");
    fireEvent.keyDown(region, { key: "n" });
    fireEvent.keyDown(region, { key: "j" });
    expect(document.querySelectorAll(".react-flow__node-draftPin")).toHaveLength(0);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onSelectPin).not.toHaveBeenCalled();
  });

  test("persisted pins render but are never draggable", () => {
    render(<CaptureCanvas {...props} readOnly pins={pins} />);
    const nodes = Array.from(document.querySelectorAll(".react-flow__node-pin"));
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      // React Flow marks draggable nodes with its `draggable` class and
      // leaves it off otherwise; the read-only plane sets draggable false.
      expect(node.className).not.toMatch(/\bdraggable\b/);
    }
    expect(stage()).toBeInTheDocument();
  });

  test("selecting a pin still works so the founder can read its thread", () => {
    const onSelectPin = vi.fn();
    render(<CaptureCanvas {...props} readOnly pins={pins} onSelectPin={onSelectPin} />);
    const badge = document.querySelector('[data-testid="pin-badge"][data-pin-number="2"]')!;
    const node = badge.closest(".react-flow__node-pin")!;
    fireEvent.click(node);
    expect(onSelectPin).toHaveBeenCalledWith("ann-2");
  });
});

describe("readOnly rectangles (D079)", () => {
  const rectangles = [{ id: "box-3", number: 3, rect: { x: 100, y: 200, width: 300, height: 150 } }];

  test("boxes render with no handles, no drag, and no Draw a box toggle; selecting one still works", () => {
    const onSelectPin = vi.fn();
    render(
      <CaptureCanvas {...props} readOnly pins={pins} rectangles={rectangles} onSelectPin={onSelectPin} />,
    );
    const nodes = Array.from(document.querySelectorAll(".react-flow__node-rectangle"));
    expect(nodes).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="rectangle-handle"]')).toHaveLength(0);
    expect(nodes[0]!.className).not.toMatch(/\bdraggable\b/);
    expect(within(stage()).queryByRole("button", { name: "Draw a box" })).toBeNull();
    const badge = nodes[0]!.querySelector('[data-testid="rectangle-badge"]')!;
    expect(badge).toHaveAttribute("data-mark-number", "3");
    fireEvent.click(nodes[0]!);
    expect(onSelectPin).toHaveBeenCalledWith("box-3");
    // A Shift-drag on the founder's plane draws nothing.
    fireEvent.pointerDown(frameImage(), { clientX: 400, clientY: 300, isPrimary: true, shiftKey: true });
    fireEvent.pointerMove(frameImage(), { clientX: 480, clientY: 360, isPrimary: true });
    fireEvent.pointerUp(frameImage(), { clientX: 480, clientY: 360, isPrimary: true });
    expect(document.querySelectorAll(".react-flow__node-draftRectangle")).toHaveLength(0);
  });
});
