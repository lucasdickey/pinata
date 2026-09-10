// @vitest-environment jsdom
// Component tests for the canvas's read-only plane (the founder's view,
// REQUIREMENTS 6 and 7): no editing tool exists in the DOM at all, a
// deliberate tap creates no draft, persisted pins are never draggable, and
// selecting a pin to read it still works. The default (editable) plane is
// unchanged — capture-canvas.test.tsx keeps proving that.

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
  test("renders no editing tools, only camera controls", () => {
    render(<CaptureCanvas {...props} readOnly pins={pins} />);
    expect(within(stage()).queryByRole("group", { name: "Canvas tools" })).toBeNull();
    expect(within(stage()).queryByRole("button", { name: "Place pin" })).toBeNull();
    expect(within(stage()).queryByRole("button", { name: "Navigate" })).toBeNull();
    expect(within(stage()).getByRole("group", { name: "Camera modes and zoom" })).toBeInTheDocument();
    expect(within(stage()).getByRole("button", { name: "Entire page" })).toBeInTheDocument();
    expect(within(stage()).getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    const region = within(stage()).getByRole("region");
    expect(region).toHaveAttribute("data-interaction", "navigate");
    expect(region).toHaveAttribute("data-read-only", "true");
  });

  test("the default plane is unchanged: tools present and no read-only marker", () => {
    render(<CaptureCanvas {...props} pins={pins} />);
    expect(within(stage()).getByRole("group", { name: "Canvas tools" })).toBeInTheDocument();
    expect(within(stage()).getByRole("button", { name: "Place pin" })).toBeInTheDocument();
    expect(within(stage()).getByRole("region")).not.toHaveAttribute("data-read-only");
  });

  test("a deliberate tap never creates a draft and reports nothing", () => {
    const onDraftChange = vi.fn();
    const onDraftSettled = vi.fn();
    render(
      <CaptureCanvas
        {...props}
        readOnly
        pins={pins}
        onDraftChange={onDraftChange}
        onDraftSettled={onDraftSettled}
      />,
    );
    tap(frameImage(), 400, 300);
    tap(frameImage(), 420, 320);
    expect(document.querySelectorAll(".react-flow__node-draftPin")).toHaveLength(0);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onDraftSettled).not.toHaveBeenCalled();
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
