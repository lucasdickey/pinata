// @vitest-environment jsdom
// Component tests for the canvas interaction contract (VAL-CANVAS-006,
// VAL-CANVAS-008, D074). There are no modes: a press that releases without
// moving past the placement slop drops exactly one draft, a press that
// moves does not, a second click moves that same draft, a click on a saved
// pin selects it and never stacks a draft, saved pins are draggable in
// every state, the composer opens beside the draft outside the transformed
// plane and stays inside the viewport, keyboard shortcuts step through pins
// and drop a draft at the viewport center (never while typing), Escape
// clears only transient state, drafts die with their plane, and session
// cameras restore. Rectangles (D079): a Shift-drag or an armed "Draw a box"
// drag draws one, a plain drag pans, a release below the minimum draws
// nothing, the draft box is resizable, a saved box resize commits one
// clamped write, the read-only plane has no handles, and J/K step through
// boxes and pins in one number order. jsdom proves structure and state, not
// pixels — pixel transforms are covered by the pure camera/geometry oracles
// and the real-browser measurements in e2e/canvas-interactions.spec.ts.
// React Flow node drags (a saved box moved by its edge) cannot run under
// jsdom either; the pure moveRect oracle and the credentialed e2e cover that
// commit.

import "@testing-library/jest-dom/vitest";
import { cleanup, createEvent, fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CaptureCanvas, type CaptureCameraState } from "../../src/components/capture-canvas";
import type { PinComposerProps } from "../../src/components/pin-composer";
import { MIN_SHAPE_SIZE_PX } from "../../src/lib/boundaries";
import { flowToScreen } from "../../src/lib/canvas/camera";
import { PLACEMENT_SLOP_SCREEN_PX } from "../../src/lib/canvas/geometry";
import { installReactFlowMocks, triggerObservedResize } from "../helpers/react-flow";

installReactFlowMocks();

afterEach(() => cleanup());

const props = {
  captureId: "cap-root-desktop-v1",
  pageUrl: "https://chickpea.co/",
  variant: "Desktop",
  attempt: 1,
  width: 1440,
  height: 8966,
};

function composerProps(overrides: Partial<PinComposerProps> = {}): PinComposerProps {
  return {
    draftBody: "",
    onDraftBodyChange: vi.fn(),
    draftChoice: null,
    onDraftChoiceChange: vi.fn(),
    draftCandidates: { status: "ready", items: [] },
    onPreviewCandidate: vi.fn(),
    onSaveDraft: vi.fn(),
    onCancelDraft: vi.fn(),
    saveState: "idle",
    ...overrides,
  };
}

function stage(): HTMLElement {
  return document.querySelector('[data-testid="capture-stage"]') as HTMLElement;
}

function region(): HTMLElement {
  return within(stage()).getByRole("region");
}

function frameImage(): HTMLElement {
  return document.querySelector(".capture-frame-image") as HTMLElement;
}

function draftNodes(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".react-flow__node-draftPin"));
}

function pinNodes(): HTMLElement[] {
  return Array.from(document.querySelectorAll(".react-flow__node-pin"));
}

function composer(): HTMLElement | null {
  return within(stage()).queryByRole("dialog", { name: "New pin" });
}

/** A click: press and release at one screen point. */
function tap(target: Element, x: number, y: number): void {
  fireEvent.pointerDown(target, { clientX: x, clientY: y, isPrimary: true });
  fireEvent.pointerUp(target, { clientX: x, clientY: y, isPrimary: true });
}

describe("no modes", () => {
  test("the canvas offers camera controls only: no Navigate or Place pin toggle", () => {
    render(<CaptureCanvas {...props} />);
    // One toolbar group; the other "group" roles in the stage are React
    // Flow's focusable nodes, never a second toolbar.
    expect(within(stage()).getByRole("group", { name: "Camera modes and zoom" })).toBeInTheDocument();
    expect(within(stage()).queryByRole("group", { name: "Canvas tools" })).toBeNull();
    expect(within(stage()).queryByRole("button", { name: /place pin|navigate/i })).toBeNull();
    expect(region()).not.toHaveAttribute("data-interaction");
  });
});

describe("click versus drag", () => {
  test("a press that releases without moving drops exactly one draft", () => {
    const onDraftChange = vi.fn();
    const onDraftSettled = vi.fn();
    render(
      <CaptureCanvas {...props} onDraftChange={onDraftChange} onDraftSettled={onDraftSettled} />,
    );

    tap(frameImage(), 400, 300);

    expect(draftNodes()).toHaveLength(1);
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    expect(onDraftSettled).toHaveBeenCalledTimes(1);
    const draft = onDraftChange.mock.calls[0]![0] as { kind: string; tip: { x: number; y: number } };
    expect(draft.kind).toBe("pin");
    const tip = draft.tip;
    expect(Number.isFinite(tip.x)).toBe(true);
    expect(Number.isFinite(tip.y)).toBe(true);
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x).toBeLessThanOrEqual(props.width);
    expect(tip.y).toBeGreaterThanOrEqual(0);
    expect(tip.y).toBeLessThanOrEqual(props.height);
    // The settle carries the same natural pixel the draft reports.
    expect(onDraftSettled).toHaveBeenLastCalledWith(draft);
  });

  test("a press that moves past the placement slop is a pan, not a placement", () => {
    const onDraftChange = vi.fn();
    render(<CaptureCanvas {...props} onDraftChange={onDraftChange} />);

    fireEvent.pointerDown(frameImage(), { clientX: 400, clientY: 300, isPrimary: true });
    fireEvent.pointerUp(frameImage(), { clientX: 460, clientY: 360, isPrimary: true });
    expect(draftNodes()).toHaveLength(0);
    expect(onDraftChange).not.toHaveBeenCalled();

    // Just past the slop still counts as movement.
    fireEvent.pointerDown(frameImage(), { clientX: 400, clientY: 300, isPrimary: true });
    fireEvent.pointerUp(frameImage(), {
      clientX: 400 + PLACEMENT_SLOP_SCREEN_PX + 1,
      clientY: 300,
      isPrimary: true,
    });
    expect(draftNodes()).toHaveLength(0);
  });

  test("a small wobble inside the slop is still a click", () => {
    const onDraftChange = vi.fn();
    render(<CaptureCanvas {...props} onDraftChange={onDraftChange} />);
    fireEvent.pointerDown(frameImage(), { clientX: 400, clientY: 300, isPrimary: true });
    fireEvent.pointerUp(frameImage(), { clientX: 403, clientY: 302, isPrimary: true });
    expect(draftNodes()).toHaveLength(1);
    expect(onDraftChange).toHaveBeenCalledTimes(1);
  });

  test("a second click moves the same draft — never a second mark", () => {
    const onDraftChange = vi.fn();
    render(<CaptureCanvas {...props} onDraftChange={onDraftChange} />);

    tap(frameImage(), 400, 300);
    const first = onDraftChange.mock.calls.at(-1)![0] as { tip: { x: number; y: number } };
    // At the jsdom contain zoom the tall capture occupies a narrow strip;
    // both taps must land inside the screenshot to place.
    tap(frameImage(), 410, 450);
    const second = onDraftChange.mock.calls.at(-1)![0] as { tip: { x: number; y: number } };

    expect(draftNodes()).toHaveLength(1);
    expect(second).not.toEqual(first);
  });

  test("a click on the draft itself does not re-place it", () => {
    const onDraftChange = vi.fn();
    render(<CaptureCanvas {...props} onDraftChange={onDraftChange} />);
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);

    const calls = onDraftChange.mock.calls.length;
    tap(draftNodes()[0]!, 400, 300);
    expect(onDraftChange.mock.calls.length).toBe(calls);
    expect(draftNodes()).toHaveLength(1);
  });

  test("a click that lands outside the screenshot drops nothing", () => {
    const onDraftChange = vi.fn();
    render(<CaptureCanvas {...props} onDraftChange={onDraftChange} />);
    tap(region(), -5, -5);
    expect(draftNodes()).toHaveLength(0);
    expect(onDraftChange).not.toHaveBeenCalled();
  });
});

describe("transient state lifecycle", () => {
  test("Escape clears the draft and reports it", () => {
    const onDraftChange = vi.fn();
    render(<CaptureCanvas {...props} onDraftChange={onDraftChange} />);
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(draftNodes()).toHaveLength(0);
    expect(onDraftChange).toHaveBeenLastCalledWith(null);
  });

  test("Escape while typing in an input does not clear the draft", () => {
    render(
      <>
        <input aria-label="Some field" />
        <CaptureCanvas {...props} />
      </>,
    );
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);

    const input = document.querySelector("input")!;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(draftNodes()).toHaveLength(1);
  });

  test("a draft never crosses planes: switching captures drops it", () => {
    const { unmount } = render(<CaptureCanvas {...props} />);
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);
    unmount();

    // The parent keys the canvas by capture id, so another plane is a fresh
    // mount with no draft and the entire-capture initial camera.
    render(<CaptureCanvas {...props} captureId="cap-root-mobile-v1" variant="Mobile" />);
    expect(draftNodes()).toHaveLength(0);
    expect(within(stage()).getByRole("button", { name: "Entire page" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("the composer popover", () => {
  test("opens beside the draft, outside the transformed plane, with the comment focused", () => {
    render(<CaptureCanvas {...props} composer={composerProps()} />);
    expect(composer()).toBeNull();
    tap(frameImage(), 400, 300);

    const dialog = composer();
    expect(dialog).not.toBeNull();
    // Screen-fixed: a sibling of the canvas, never inside React Flow's
    // transformed viewport or the pointer-handling wrapper.
    expect(dialog!.closest(".react-flow")).toBeNull();
    expect(dialog!.closest(".capture-canvas")).toBeNull();
    expect(dialog!.getAttribute("data-testid")).toBe("pin-composer");
    expect(within(dialog!).getByLabelText("Comment")).toHaveFocus();
    expect(within(dialog!).getByRole("button", { name: "Save pin" })).toBeInTheDocument();
    expect(within(dialog!).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  test("never leaves the viewport: the box is clamped inside the window", () => {
    render(<CaptureCanvas {...props} composer={composerProps()} />);
    tap(frameImage(), 400, 300);
    const dialog = composer()!;
    const left = Number.parseFloat(dialog.style.left);
    const top = Number.parseFloat(dialog.style.top);
    expect(Number.isFinite(left)).toBe(true);
    expect(Number.isFinite(top)).toBe(true);
    // The jsdom mock reports a box far larger than the placement wants, so
    // clamping is what keeps these inside the window.
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + dialog.offsetWidth).toBeLessThanOrEqual(window.innerWidth);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top + dialog.offsetHeight).toBeLessThanOrEqual(window.innerHeight);
  });

  test("closes when the draft is cleared", () => {
    render(<CaptureCanvas {...props} composer={composerProps()} />);
    tap(frameImage(), 400, 300);
    expect(composer()).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(composer()).toBeNull();
    expect(draftNodes()).toHaveLength(0);
  });

  test("Escape inside the composer cancels through the workspace, not the canvas", () => {
    const onCancelDraft = vi.fn();
    render(<CaptureCanvas {...props} composer={composerProps({ onCancelDraft })} />);
    tap(frameImage(), 400, 300);
    fireEvent.keyDown(within(composer()!).getByLabelText("Comment"), { key: "Escape" });
    expect(onCancelDraft).toHaveBeenCalledTimes(1);
    // The canvas itself did not clear the draft: the workspace answers the
    // cancel with the reset signal, exactly like a Cancel click.
    expect(draftNodes()).toHaveLength(1);
  });

  test("focus returns to the canvas region when the draft closes", async () => {
    const { rerender } = render(
      <CaptureCanvas {...props} composer={composerProps()} draftResetSignal={0} />,
    );
    tap(frameImage(), 400, 300);
    expect(within(composer()!).getByLabelText("Comment")).toHaveFocus();
    rerender(<CaptureCanvas {...props} composer={composerProps()} draftResetSignal={1} />);
    await waitFor(() => expect(composer()).toBeNull());
    expect(region()).toHaveFocus();
  });
});

describe("keyboard shortcuts on the canvas region", () => {
  const pins = [
    { id: "ann-1", number: 1, tip: { x: 720, y: 4000 } },
    { id: "ann-2", number: 2, tip: { x: 100, y: 200 } },
    { id: "ann-3", number: 3, tip: { x: 300, y: 600 } },
  ];

  test("the region is focusable and announces its shortcuts", () => {
    render(<CaptureCanvas {...props} pins={pins} />);
    expect(region()).toHaveAttribute("tabindex", "0");
    expect(region()).toHaveAttribute("aria-keyshortcuts");
  });

  test("J and ArrowDown select the next saved pin; K and ArrowUp the previous; both wrap", () => {
    const onSelectPin = vi.fn();
    const { rerender } = render(
      <CaptureCanvas {...props} pins={pins} selectedPinId={null} onSelectPin={onSelectPin} />,
    );
    fireEvent.keyDown(region(), { key: "j" });
    expect(onSelectPin).toHaveBeenLastCalledWith("ann-1");
    rerender(
      <CaptureCanvas {...props} pins={pins} selectedPinId="ann-1" onSelectPin={onSelectPin} />,
    );
    fireEvent.keyDown(region(), { key: "ArrowDown" });
    expect(onSelectPin).toHaveBeenLastCalledWith("ann-2");
    rerender(
      <CaptureCanvas {...props} pins={pins} selectedPinId="ann-3" onSelectPin={onSelectPin} />,
    );
    fireEvent.keyDown(region(), { key: "J" });
    expect(onSelectPin).toHaveBeenLastCalledWith("ann-1");
    rerender(
      <CaptureCanvas {...props} pins={pins} selectedPinId="ann-1" onSelectPin={onSelectPin} />,
    );
    fireEvent.keyDown(region(), { key: "k" });
    expect(onSelectPin).toHaveBeenLastCalledWith("ann-3");
    rerender(
      <CaptureCanvas {...props} pins={pins} selectedPinId={null} onSelectPin={onSelectPin} />,
    );
    fireEvent.keyDown(region(), { key: "ArrowUp" });
    expect(onSelectPin).toHaveBeenLastCalledWith("ann-3");
  });

  test("arrow keys are consumed so the page does not scroll", () => {
    render(<CaptureCanvas {...props} pins={pins} onSelectPin={vi.fn()} />);
    const event = createEvent.keyDown(region(), { key: "ArrowDown" });
    fireEvent(region(), event);
    expect(event.defaultPrevented).toBe(true);
  });

  test("with no saved pins, J and K do nothing", () => {
    const onSelectPin = vi.fn();
    render(<CaptureCanvas {...props} onSelectPin={onSelectPin} />);
    fireEvent.keyDown(region(), { key: "j" });
    fireEvent.keyDown(region(), { key: "k" });
    expect(onSelectPin).not.toHaveBeenCalled();
  });

  test("N drops a draft at the viewport center, clamped to the frame, and clears the selection", () => {
    const onDraftChange = vi.fn();
    const onDraftSettled = vi.fn();
    const onSelectPin = vi.fn();
    render(
      <CaptureCanvas
        {...props}
        pins={pins}
        selectedPinId="ann-2"
        onSelectPin={onSelectPin}
        onDraftChange={onDraftChange}
        onDraftSettled={onDraftSettled}
        composer={composerProps()}
      />,
    );
    fireEvent.keyDown(region(), { key: "n" });
    expect(draftNodes()).toHaveLength(1);
    expect(onDraftSettled).toHaveBeenCalledTimes(1);
    const tip = (onDraftChange.mock.calls.at(-1)![0] as { tip: { x: number; y: number } }).tip;
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x).toBeLessThanOrEqual(props.width);
    expect(tip.y).toBeGreaterThanOrEqual(0);
    expect(tip.y).toBeLessThanOrEqual(props.height);
    expect(onSelectPin).toHaveBeenCalledWith(null);
    // The composer opens for it like any click-placed draft.
    expect(composer()).not.toBeNull();
    // A second N moves the same draft; it never stacks.
    fireEvent.keyDown(region(), { key: "N" });
    expect(draftNodes()).toHaveLength(1);
  });

  test("shortcuts ignore modifier combinations", () => {
    const onDraftChange = vi.fn();
    const onSelectPin = vi.fn();
    render(
      <CaptureCanvas
        {...props}
        pins={pins}
        onSelectPin={onSelectPin}
        onDraftChange={onDraftChange}
      />,
    );
    fireEvent.keyDown(region(), { key: "n", ctrlKey: true });
    fireEvent.keyDown(region(), { key: "n", metaKey: true });
    fireEvent.keyDown(region(), { key: "j", altKey: true });
    expect(draftNodes()).toHaveLength(0);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onSelectPin).not.toHaveBeenCalled();
  });

  test("shortcuts never fire while focus is in an input, textarea, select, or contenteditable", () => {
    const onDraftChange = vi.fn();
    const onSelectPin = vi.fn();
    render(
      <CaptureCanvas
        {...props}
        pins={pins}
        onSelectPin={onSelectPin}
        onDraftChange={onDraftChange}
      />,
    );
    // Text fields inside the region (a future node with an input, say)
    // must keep every keystroke to themselves.
    const fields: HTMLElement[] = [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
    ];
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    fields.push(editable);
    for (const field of fields) region().appendChild(field);
    for (const field of fields) {
      fireEvent.keyDown(field, { key: "n" });
      fireEvent.keyDown(field, { key: "j" });
      fireEvent.keyDown(field, { key: "ArrowDown" });
    }
    expect(draftNodes()).toHaveLength(0);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onSelectPin).not.toHaveBeenCalled();
  });

  test("typing J or N in the composer edits the comment, nothing else", () => {
    const onSelectPin = vi.fn();
    const onDraftSettled = vi.fn();
    render(
      <CaptureCanvas
        {...props}
        pins={pins}
        onSelectPin={onSelectPin}
        onDraftSettled={onDraftSettled}
        composer={composerProps()}
      />,
    );
    tap(frameImage(), 400, 300);
    expect(onDraftSettled).toHaveBeenCalledTimes(1);
    const comment = within(composer()!).getByLabelText("Comment");
    fireEvent.keyDown(comment, { key: "j" });
    fireEvent.keyDown(comment, { key: "n" });
    expect(onSelectPin).not.toHaveBeenCalled();
    expect(onDraftSettled).toHaveBeenCalledTimes(1);
  });
});

describe("persisted pins", () => {
  const pins = [
    { id: "ann-1", number: 1, tip: { x: 720, y: 4000 } },
    { id: "ann-2", number: 2, tip: { x: 100, y: 200 } },
  ];

  test("render as numbered badges parented to the frame, before any draft", () => {
    render(<CaptureCanvas {...props} pins={pins} />);
    const badges = pinNodes();
    expect(badges).toHaveLength(2);
    // Stable number order regardless of prop order.
    expect(badges[0]!.textContent).toBe("1");
    expect(badges[1]!.textContent).toBe("2");
    // The draft still stacks after the persisted pins.
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);
    expect(pinNodes()).toHaveLength(2);
  });

  test("clicking a pin selects it; Escape does not disturb persisted pins", () => {
    const onSelectPin = vi.fn();
    render(<CaptureCanvas {...props} pins={pins} onSelectPin={onSelectPin} />);
    // A bare click event: jsdom cannot run d3-drag's mousedown (event.view
    // is null there), and selection is click-level behavior anyway. In the
    // browser the press lands on the node wrapper (the badge is
    // pointer-transparent) and React Flow raises onNodeClick.
    fireEvent.click(pinNodes()[0]!);
    expect(onSelectPin).toHaveBeenCalledWith("ann-1");

    // Escape is draft-only: with no draft open it touches nothing.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(pinNodes()).toHaveLength(2);
    expect(onSelectPin).toHaveBeenCalledTimes(1);
  });

  test("a click on a saved pin selects it instead of stacking a draft", () => {
    const onSelectPin = vi.fn();
    render(<CaptureCanvas {...props} pins={pins} onSelectPin={onSelectPin} />);
    // A no-travel pointer pair landing on the pin's node wrapper: placement
    // must skip it, and the click that follows selects.
    const wrapper = pinNodes()[0]!;
    fireEvent.pointerDown(wrapper, { clientX: 400, clientY: 300, isPrimary: true });
    fireEvent.pointerUp(wrapper, { clientX: 400, clientY: 300, isPrimary: true });
    fireEvent.click(wrapper);
    expect(draftNodes()).toHaveLength(0);
    expect(onSelectPin).toHaveBeenCalledWith("ann-1");
    // And a click on clear pane still places exactly one draft.
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);
  });

  test("saved pins are draggable in every state — with and without a draft open", () => {
    render(<CaptureCanvas {...props} pins={pins} composer={composerProps()} />);
    expect(pinNodes()[0]!.className).toContain("draggable");
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);
    expect(pinNodes()[0]!.className).toContain("draggable");
    expect(draftNodes()[0]!.className).toContain("draggable");
  });

  test("the selected pin's badge advertises the selection", () => {
    const { rerender } = render(
      <CaptureCanvas {...props} pins={pins} selectedPinId={null} />,
    );
    expect(pinNodes()[0]!.querySelector('[data-selected="true"]')).toBeNull();
    rerender(<CaptureCanvas {...props} pins={pins} selectedPinId="ann-2" />);
    expect(pinNodes()[1]!.querySelector('[data-selected="true"]')).not.toBeNull();
    expect(pinNodes()[0]!.querySelector('[data-selected="true"]')).toBeNull();
  });

  test("pins are per-plane: another capture's mount shows only its own pins", () => {
    const { unmount } = render(<CaptureCanvas {...props} pins={pins} />);
    expect(pinNodes()).toHaveLength(2);
    unmount();
    render(
      <CaptureCanvas
        {...props}
        captureId="cap-root-mobile-v1"
        variant="Mobile"
        pins={[{ id: "ann-9", number: 1, tip: { x: 50, y: 60 } }]}
      />,
    );
    const badges = pinNodes();
    expect(badges).toHaveLength(1);
    expect(badges[0]!.textContent).toBe("1");
  });

  test("the draft reset signal clears an unsaved draft after a save", async () => {
    const onDraftChange = vi.fn();
    const { rerender } = render(
      <CaptureCanvas {...props} onDraftChange={onDraftChange} draftResetSignal={0} />,
    );
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);

    rerender(
      <CaptureCanvas {...props} onDraftChange={onDraftChange} draftResetSignal={1} />,
    );
    await waitFor(() => expect(draftNodes()).toHaveLength(0));
    expect(onDraftChange).toHaveBeenLastCalledWith(null);
  });
});

describe("context preview highlight", () => {
  const rect = { x: 808.5, y: 4202.25, width: 216.75, height: 98.5 };

  function previewNodes(): HTMLElement[] {
    return Array.from(document.querySelectorAll(".react-flow__node-contextPreview"));
  }

  test("renders the candidate rect as one inert box parented to the frame", () => {
    render(<CaptureCanvas {...props} previewRect={rect} />);
    expect(previewNodes()).toHaveLength(1);
    const box = document.querySelector('[data-testid="context-preview"]') as HTMLElement;
    expect(box).not.toBeNull();
    // The wrapper carries the exact natural-pixel geometry (jsdom proves
    // structure; the one-pixel transform contract is measured in e2e).
    const wrapper = previewNodes()[0]!;
    expect(wrapper.style.transform).toContain("translate(808.5px,4202.25px)");
    expect(box).toHaveAttribute("aria-hidden", "true");
  });

  test("is absent without a preview and disappears when the preview clears", () => {
    const { rerender } = render(<CaptureCanvas {...props} previewRect={null} />);
    expect(previewNodes()).toHaveLength(0);
    rerender(<CaptureCanvas {...props} previewRect={rect} />);
    expect(previewNodes()).toHaveLength(1);
    rerender(<CaptureCanvas {...props} previewRect={null} />);
    expect(previewNodes()).toHaveLength(0);
  });

  test("never stacks: a replacement rect moves the one box", () => {
    const { rerender } = render(<CaptureCanvas {...props} previewRect={rect} />);
    rerender(<CaptureCanvas {...props} previewRect={{ ...rect, x: 10, y: 20 }} />);
    expect(previewNodes()).toHaveLength(1);
    expect(previewNodes()[0]!.style.transform).toContain("translate(10px,20px)");
  });

  test("does not disturb pins or drafts", () => {
    const pins = [{ id: "ann-1", number: 1, tip: { x: 720, y: 4000 } }];
    render(<CaptureCanvas {...props} pins={pins} previewRect={rect} />);
    expect(pinNodes()).toHaveLength(1);
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);
    expect(previewNodes()).toHaveLength(1);
    // The highlight ignores the pointer: a click aimed at it still places.
    expect(previewNodes()[0]!.style.pointerEvents).toBe("none");
  });

  test("a corrupt rect renders nothing rather than corrupting the plane", () => {
    render(
      <CaptureCanvas {...props} previewRect={{ x: Number.NaN, y: 0, width: 10, height: 10 }} />,
    );
    expect(previewNodes()).toHaveLength(0);
    expect(frameImage()).not.toBeNull();
  });
});

describe("per-capture session camera", () => {
  const saved: CaptureCameraState = {
    camera: { x: -1000, y: -20_000, zoom: 4 },
    mode: "natural",
    follow: false,
  };

  test("a plane with a remembered camera restores it instead of the initial mode", async () => {
    const onCameraChange = vi.fn();
    render(<CaptureCanvas {...props} savedCamera={saved} onCameraChange={onCameraChange} />);
    // The restore lands when React Flow initializes (async under jsdom).
    await waitFor(() =>
      expect(within(stage()).getByRole("button", { name: "Natural size" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(within(stage()).getByRole("button", { name: "Entire page" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("camera reports carry the mode and follow flag, never just a transform", async () => {
    const user = userEvent.setup();
    const onCameraChange = vi.fn();
    render(<CaptureCanvas {...props} onCameraChange={onCameraChange} />);
    await user.click(within(stage()).getByRole("button", { name: "Natural size" }));
    expect(onCameraChange).toHaveBeenCalled();
    const last = onCameraChange.mock.calls.at(-1)![0] as CaptureCameraState;
    expect(last.mode).toBe("natural");
    expect(last.follow).toBe(true);
    expect(last.camera.zoom).toBe(1);
  });

  test("a first-visit plane reports the entire-capture initial camera", async () => {
    const onCameraChange = vi.fn();
    render(<CaptureCanvas {...props} onCameraChange={onCameraChange} />);
    await waitFor(() => expect(onCameraChange).toHaveBeenCalled());
    const first = onCameraChange.mock.calls[0]![0] as CaptureCameraState;
    expect(first.mode).toBe("entire");
    expect(first.follow).toBe(true);
  });

  test("the zoom buttons take the camera over: a later resize must not re-apply the named mode", async () => {
    const user = userEvent.setup();
    const onCameraChange = vi.fn();
    render(<CaptureCanvas {...props} onCameraChange={onCameraChange} />);
    await waitFor(() => expect(onCameraChange).toHaveBeenCalled());
    // While follow is on, a resize re-applies the active mode and reports it.
    triggerObservedResize();
    await waitFor(() =>
      expect(
        onCameraChange.mock.calls.some(
          (call) => (call[0] as CaptureCameraState).follow === true,
        ),
      ).toBe(true),
    );
    const reportsBefore = onCameraChange.mock.calls.length;

    await user.click(within(stage()).getByRole("button", { name: "Zoom in" }));
    triggerObservedResize();
    // No mode re-application report may follow a button zoom.
    const later = onCameraChange.mock.calls
      .slice(reportsBefore)
      .map((call) => call[0] as CaptureCameraState);
    expect(later.some((report) => report.follow === true)).toBe(false);
  });
});

describe("rectangles (D079)", () => {
  // A remembered camera at a known zoom, so screen deltas convert to
  // natural pixels predictably: 4 screen px per natural px.
  const zoomed: CaptureCameraState = {
    camera: { x: -1000, y: -20_000, zoom: 4 },
    mode: "natural",
    follow: false,
  };
  const ZOOM = zoomed.camera.zoom;

  const pins = [
    { id: "ann-1", number: 1, tip: { x: 720, y: 4000 } },
    { id: "ann-3", number: 3, tip: { x: 300, y: 600 } },
  ];
  const rectangles = [{ id: "box-2", number: 2, rect: { x: 100, y: 200, width: 300, height: 150 } }];

  type Rect = { x: number; y: number; width: number; height: number };
  type Draft = { kind: "pin"; tip: { x: number; y: number } } | { kind: "rectangle"; rect: Rect };

  function draftRectangleNodes(): HTMLElement[] {
    return Array.from(document.querySelectorAll(".react-flow__node-draftRectangle"));
  }
  function rectangleNodes(): HTMLElement[] {
    return Array.from(document.querySelectorAll(".react-flow__node-rectangle"));
  }
  function handles(root: ParentNode = document): HTMLElement[] {
    return Array.from(root.querySelectorAll('[data-testid="rectangle-handle"]'));
  }
  function handle(root: ParentNode, name: string): HTMLElement {
    return root.querySelector(`[data-testid="rectangle-handle"][data-handle="${name}"]`)!;
  }
  function drawToggle(): HTMLElement {
    return within(stage()).getByRole("button", { name: "Draw a box" });
  }

  /** Mount at the known zoom and wait for the camera to land. */
  async function renderZoomed(extra: Record<string, unknown> = {}) {
    const result = render(<CaptureCanvas {...props} savedCamera={zoomed} {...extra} />);
    await waitFor(() =>
      expect(within(stage()).getByRole("button", { name: "Natural size" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    return result;
  }

  /** A press that moves: from one screen point to another, then releases. */
  function drag(
    target: Element,
    from: { x: number; y: number },
    to: { x: number; y: number },
    init: Record<string, unknown> = {},
  ): void {
    fireEvent.pointerDown(target, { clientX: from.x, clientY: from.y, isPrimary: true, ...init });
    fireEvent.pointerMove(target, {
      clientX: (from.x + to.x) / 2,
      clientY: (from.y + to.y) / 2,
      isPrimary: true,
      ...init,
    });
    fireEvent.pointerMove(target, { clientX: to.x, clientY: to.y, isPrimary: true, ...init });
    fireEvent.pointerUp(target, { clientX: to.x, clientY: to.y, isPrimary: true, ...init });
  }

  test("a Shift-drag draws one box from press to release, in natural pixels, and opens the box composer", async () => {
    const onDraftChange = vi.fn();
    const onDraftSettled = vi.fn();
    await renderZoomed({ onDraftChange, onDraftSettled, composer: composerProps() });

    drag(frameImage(), { x: 400, y: 300 }, { x: 480, y: 360 }, { shiftKey: true });

    expect(draftRectangleNodes()).toHaveLength(1);
    expect(draftNodes()).toHaveLength(0);
    expect(onDraftSettled).toHaveBeenCalledTimes(1);
    const draft = onDraftChange.mock.calls.at(-1)![0] as Draft;
    expect(draft.kind).toBe("rectangle");
    if (draft.kind !== "rectangle") return;
    // 80 by 60 screen px at 4x is 20 by 15 natural px, anchored where the
    // press landed.
    expect(draft.rect.width).toBeCloseTo(80 / ZOOM, 5);
    expect(draft.rect.height).toBeCloseTo(60 / ZOOM, 5);
    expect(draft.rect.x).toBeCloseTo((400 - zoomed.camera.x) / ZOOM, 5);
    expect(draft.rect.y).toBeCloseTo((300 - zoomed.camera.y) / ZOOM, 5);
    expect(onDraftSettled).toHaveBeenLastCalledWith(draft);

    // The same composer, labelled for a box, anchored inside the window.
    const dialog = within(stage()).getByRole("dialog", { name: "New box" });
    expect(dialog).toHaveAttribute("data-draft-kind", "rectangle");
    expect(within(dialog).getByRole("button", { name: "Save box" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Comment")).toHaveFocus();
    const left = Number.parseFloat(dialog.style.left);
    const top = Number.parseFloat(dialog.style.top);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left + dialog.offsetWidth).toBeLessThanOrEqual(window.innerWidth);
    expect(top + dialog.offsetHeight).toBeLessThanOrEqual(window.innerHeight);
  });

  test("a drag drawn upward and leftward still yields a box with positive size", async () => {
    const onDraftChange = vi.fn();
    await renderZoomed({ onDraftChange });
    drag(frameImage(), { x: 480, y: 360 }, { x: 400, y: 300 }, { shiftKey: true });
    const draft = onDraftChange.mock.calls.at(-1)![0] as Draft;
    expect(draft.kind).toBe("rectangle");
    if (draft.kind !== "rectangle") return;
    expect(draft.rect.width).toBeCloseTo(80 / ZOOM, 5);
    expect(draft.rect.height).toBeCloseTo(60 / ZOOM, 5);
    expect(draft.rect.x).toBeCloseTo((400 - zoomed.camera.x) / ZOOM, 5);
  });

  test("a plain drag pans: no box, no pin, nothing reported", async () => {
    const onDraftChange = vi.fn();
    await renderZoomed({ onDraftChange });
    drag(frameImage(), { x: 400, y: 300 }, { x: 480, y: 360 });
    expect(draftRectangleNodes()).toHaveLength(0);
    expect(draftNodes()).toHaveLength(0);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(region()).not.toHaveAttribute("data-drawing");
  });

  test("a release below MIN_SHAPE_SIZE_PX in either dimension draws nothing", async () => {
    const onDraftChange = vi.fn();
    const onDraftSettled = vi.fn();
    await renderZoomed({ onDraftChange, onDraftSettled });
    // At 4x, 8 natural px is 32 screen px: 20 by 60 is too narrow.
    drag(frameImage(), { x: 400, y: 300 }, { x: 420, y: 360 }, { shiftKey: true });
    expect(draftRectangleNodes()).toHaveLength(0);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onDraftSettled).not.toHaveBeenCalled();
    // Exactly the minimum in both dimensions draws.
    drag(
      frameImage(),
      { x: 400, y: 300 },
      { x: 400 + MIN_SHAPE_SIZE_PX * ZOOM, y: 300 + MIN_SHAPE_SIZE_PX * ZOOM },
      { shiftKey: true },
    );
    expect(draftRectangleNodes()).toHaveLength(1);
    const draft = onDraftChange.mock.calls.at(-1)![0] as Draft;
    if (draft.kind === "rectangle") {
      expect(draft.rect.width).toBeCloseTo(MIN_SHAPE_SIZE_PX, 5);
      expect(draft.rect.height).toBeCloseTo(MIN_SHAPE_SIZE_PX, 5);
    }
  });

  test("the box being drawn is clamped to the frame", async () => {
    const onDraftChange = vi.fn();
    await renderZoomed({ onDraftChange });
    // The frame's right edge is at screen x = 1440 * 4 - 1000 = 4760;
    // dragging far past it stops the box at the edge.
    drag(frameImage(), { x: 4700, y: 300 }, { x: 9000, y: 500 }, { shiftKey: true });
    const draft = onDraftChange.mock.calls.at(-1)![0] as Draft;
    expect(draft.kind).toBe("rectangle");
    if (draft.kind !== "rectangle") return;
    expect(draft.rect.x + draft.rect.width).toBeCloseTo(props.width, 5);
  });

  test("Escape while drawing cancels the draw: no draft, and the release drops nothing", async () => {
    const onDraftChange = vi.fn();
    await renderZoomed({ onDraftChange });
    fireEvent.pointerDown(frameImage(), { clientX: 400, clientY: 300, isPrimary: true, shiftKey: true });
    fireEvent.pointerMove(frameImage(), { clientX: 480, clientY: 360, isPrimary: true });
    expect(region()).toHaveAttribute("data-drawing", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(region()).not.toHaveAttribute("data-drawing");
    fireEvent.pointerUp(frameImage(), { clientX: 480, clientY: 360, isPrimary: true });
    expect(draftRectangleNodes()).toHaveLength(0);
    expect(draftNodes()).toHaveLength(0);
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  test("the Draw a box toggle arms exactly the next drag, then disarms itself", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    await renderZoomed({ onDraftChange });
    expect(drawToggle()).toHaveAttribute("aria-pressed", "false");
    await user.click(drawToggle());
    expect(drawToggle()).toHaveAttribute("aria-pressed", "true");
    expect(region()).toHaveAttribute("data-draw-armed", "true");

    // A plain drag now draws.
    drag(frameImage(), { x: 400, y: 300 }, { x: 480, y: 360 });
    expect(draftRectangleNodes()).toHaveLength(1);
    expect((onDraftChange.mock.calls.at(-1)![0] as Draft).kind).toBe("rectangle");
    expect(drawToggle()).toHaveAttribute("aria-pressed", "false");
    expect(region()).not.toHaveAttribute("data-draw-armed");

    // Disarmed: the next plain drag pans again and the box stays as it was.
    const calls = onDraftChange.mock.calls.length;
    drag(frameImage(), { x: 400, y: 300 }, { x: 480, y: 360 });
    expect(onDraftChange.mock.calls.length).toBe(calls);
    expect(draftRectangleNodes()).toHaveLength(1);
  });

  test("a too-small drag also spends the armed toggle, and Escape disarms it", async () => {
    const user = userEvent.setup();
    await renderZoomed();
    await user.click(drawToggle());
    drag(frameImage(), { x: 400, y: 300 }, { x: 402, y: 302 });
    expect(draftRectangleNodes()).toHaveLength(0);
    expect(drawToggle()).toHaveAttribute("aria-pressed", "false");

    await user.click(drawToggle());
    expect(drawToggle()).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(drawToggle()).toHaveAttribute("aria-pressed", "false");
  });

  test("the draft box has eight handles and resizing one re-settles the draft", async () => {
    const onDraftChange = vi.fn();
    const onDraftSettled = vi.fn();
    await renderZoomed({ onDraftChange, onDraftSettled, composer: composerProps() });
    drag(frameImage(), { x: 400, y: 300 }, { x: 480, y: 360 }, { shiftKey: true });
    const before = onDraftChange.mock.calls.at(-1)![0] as Draft;
    if (before.kind !== "rectangle") throw new Error("expected a rectangle draft");
    const box = draftRectangleNodes()[0]!;
    expect(handles(box)).toHaveLength(8);
    expect(handles(box).map((element) => element.dataset.handle)).toEqual([
      "nw", "n", "ne", "e", "se", "s", "sw", "w",
    ]);
    expect(within(box).getByTestId("draft-rectangle")).not.toHaveAttribute("data-drawing");

    // Drag the south-east handle 40 by 20 screen px: 10 by 5 natural px.
    drag(handle(box, "se"), { x: 480, y: 360 }, { x: 520, y: 380 });
    const after = onDraftChange.mock.calls.at(-1)![0] as Draft;
    if (after.kind !== "rectangle") throw new Error("expected a rectangle draft");
    expect(after.rect.x).toBe(before.rect.x);
    expect(after.rect.y).toBe(before.rect.y);
    expect(after.rect.width).toBeCloseTo(before.rect.width + 40 / ZOOM, 5);
    expect(after.rect.height).toBeCloseTo(before.rect.height + 20 / ZOOM, 5);
    // One settle for the draw, one for the resize — never per frame.
    expect(onDraftSettled).toHaveBeenCalledTimes(2);
    expect(onDraftSettled).toHaveBeenLastCalledWith(after);
    // The draft stayed one draft, and the handle press placed no pin.
    expect(draftRectangleNodes()).toHaveLength(1);
    expect(draftNodes()).toHaveLength(0);
  });

  test("a saved box renders at its persisted box with a numbered badge and handles", async () => {
    await renderZoomed({ pins, rectangles });
    const nodes = rectangleNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.style.transform).toContain("translate(100px,200px)");
    expect(nodes[0]!.style.width).toBe("300px");
    expect(nodes[0]!.style.height).toBe("150px");
    const badge = nodes[0]!.querySelector('[data-testid="rectangle-badge"]')!;
    expect(badge).toHaveAttribute("data-mark-number", "2");
    expect(badge.textContent).toBe("2");
    expect(handles(nodes[0]!)).toHaveLength(8);
    expect(nodes[0]!.className).toContain("draggable");
    // The wrapper lets the pointer through to the screenshot inside the box.
    expect(nodes[0]!.style.pointerEvents).toBe("none");
  });

  test("resizing a saved box commits exactly one clamped write at release", async () => {
    const onMoveRectangle = vi.fn();
    await renderZoomed({ pins, rectangles, onMoveRectangle });
    const box = rectangleNodes()[0]!;
    // South-east handle dragged far past the frame's right edge: the width
    // clamps to the frame, the height grows by the pointer's travel, and
    // three move frames still produce one write.
    fireEvent.pointerDown(handle(box, "se"), { clientX: 600, clientY: 600, isPrimary: true });
    fireEvent.pointerMove(frameImage(), { clientX: 2600, clientY: 700, isPrimary: true });
    fireEvent.pointerMove(frameImage(), { clientX: 5600, clientY: 800, isPrimary: true });
    expect(onMoveRectangle).not.toHaveBeenCalled();
    fireEvent.pointerMove(frameImage(), { clientX: 8600, clientY: 1000, isPrimary: true });
    fireEvent.pointerUp(frameImage(), { clientX: 8600, clientY: 1000, isPrimary: true });
    expect(onMoveRectangle).toHaveBeenCalledTimes(1);
    const [id, rect] = onMoveRectangle.mock.calls[0]! as [string, Rect];
    expect(id).toBe("box-2");
    expect(rect.x).toBe(100);
    expect(rect.y).toBe(200);
    expect(rect.x + rect.width).toBeCloseTo(props.width, 5);
    expect(rect.height).toBeCloseTo(150 + 400 / ZOOM, 5);
    // The local box snaps back to the persisted geometry until the parent
    // reloads it, and no draft was created by the handle press.
    expect(rectangleNodes()[0]!.style.width).toBe("300px");
    expect(draftNodes()).toHaveLength(0);
  });

  test("a resize can never push a box below the minimum size", async () => {
    const onMoveRectangle = vi.fn();
    await renderZoomed({ rectangles, onMoveRectangle });
    const box = rectangleNodes()[0]!;
    // North-west handle dragged far past the opposite corner.
    drag(handle(box, "nw"), { x: 0, y: 0 }, { x: 9000, y: 9000 });
    expect(onMoveRectangle).toHaveBeenCalledTimes(1);
    const rect = onMoveRectangle.mock.calls[0]![1] as Rect;
    expect(rect.width).toBeCloseTo(MIN_SHAPE_SIZE_PX, 5);
    expect(rect.height).toBeCloseTo(MIN_SHAPE_SIZE_PX, 5);
    expect(rect.x + rect.width).toBe(400);
    expect(rect.y + rect.height).toBe(350);
  });

  test("a press and release on a handle writes nothing", async () => {
    const onMoveRectangle = vi.fn();
    await renderZoomed({ rectangles, onMoveRectangle });
    const box = rectangleNodes()[0]!;
    fireEvent.pointerDown(handle(box, "e"), { clientX: 600, clientY: 600, isPrimary: true });
    fireEvent.pointerUp(frameImage(), { clientX: 600, clientY: 600, isPrimary: true });
    expect(onMoveRectangle).not.toHaveBeenCalled();
    expect(draftNodes()).toHaveLength(0);
  });

  test("clicking a saved box selects it and marks the badge", () => {
    const onSelectPin = vi.fn();
    const { rerender } = render(
      <CaptureCanvas {...props} rectangles={rectangles} onSelectPin={onSelectPin} />,
    );
    fireEvent.click(rectangleNodes()[0]!);
    expect(onSelectPin).toHaveBeenCalledWith("box-2");
    rerender(<CaptureCanvas {...props} rectangles={rectangles} selectedPinId="box-2" />);
    expect(rectangleNodes()[0]!.querySelector('[data-testid="rectangle"]')).toHaveAttribute(
      "data-selected",
      "true",
    );
  });

  test("J and K step through pins and boxes in one number order", () => {
    const onSelectPin = vi.fn();
    const { rerender } = render(
      <CaptureCanvas
        {...props}
        pins={pins}
        rectangles={rectangles}
        selectedPinId={null}
        onSelectPin={onSelectPin}
      />,
    );
    fireEvent.keyDown(region(), { key: "j" });
    expect(onSelectPin).toHaveBeenLastCalledWith("ann-1");
    rerender(
      <CaptureCanvas
        {...props}
        pins={pins}
        rectangles={rectangles}
        selectedPinId="ann-1"
        onSelectPin={onSelectPin}
      />,
    );
    fireEvent.keyDown(region(), { key: "j" });
    expect(onSelectPin).toHaveBeenLastCalledWith("box-2");
    rerender(
      <CaptureCanvas
        {...props}
        pins={pins}
        rectangles={rectangles}
        selectedPinId="box-2"
        onSelectPin={onSelectPin}
      />,
    );
    fireEvent.keyDown(region(), { key: "j" });
    expect(onSelectPin).toHaveBeenLastCalledWith("ann-3");
    fireEvent.keyDown(region(), { key: "k" });
    expect(onSelectPin).toHaveBeenLastCalledWith("ann-1");
  });

  test("the read-only plane renders boxes with no handles, no drag, and no toggle", () => {
    render(<CaptureCanvas {...props} readOnly pins={pins} rectangles={rectangles} />);
    const nodes = rectangleNodes();
    expect(nodes).toHaveLength(1);
    expect(handles()).toHaveLength(0);
    expect(nodes[0]!.className).not.toMatch(/\bdraggable\b/);
    expect(within(stage()).queryByRole("button", { name: "Draw a box" })).toBeNull();
    // Shift-drag draws nothing here.
    drag(frameImage(), { x: 400, y: 300 }, { x: 480, y: 360 }, { shiftKey: true });
    expect(draftRectangleNodes()).toHaveLength(0);
  });
});

// Bringing the selected mark into view (D078): the founder's list bumps
// revealSelected on a tap, and the plane centers the mark. jsdom's mocked
// stage is 800 × 600, so the expected screen point is its middle.
describe("revealing the selected mark (D078)", () => {
  const pins = [{ id: "ann-1", number: 1, tip: { x: 720, y: 4000 } }];
  const saved: CaptureCameraState = {
    camera: { x: -1000, y: -20_000, zoom: 4 },
    mode: "natural",
    follow: false,
  };

  test("an increment centers the selected pin at the zoom the reader has, and ends mode follow", async () => {
    const onCameraChange = vi.fn();
    const { rerender } = render(
      <CaptureCanvas
        {...props}
        readOnly
        pins={pins}
        selectedPinId="ann-1"
        savedCamera={saved}
        onCameraChange={onCameraChange}
        revealSelected={0}
      />,
    );
    // Mounting with a signal is not a tap: nothing moves until it changes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reportsBefore = onCameraChange.mock.calls.length;
    rerender(
      <CaptureCanvas
        {...props}
        readOnly
        pins={pins}
        selectedPinId="ann-1"
        savedCamera={saved}
        onCameraChange={onCameraChange}
        revealSelected={1}
      />,
    );
    await waitFor(() => expect(onCameraChange.mock.calls.length).toBeGreaterThan(reportsBefore));
    const report = onCameraChange.mock.calls.at(-1)![0] as CaptureCameraState;
    expect(report.follow).toBe(false);
    expect(report.camera.zoom).toBe(4);
    const screenPoint = flowToScreen({ x: 720, y: 4000 }, report.camera);
    expect(screenPoint.x).toBeCloseTo(400, 6);
    expect(screenPoint.y).toBeCloseTo(300, 6);
  });

  test("a box that would not fit the frame zooms out until it does, centered on its middle", async () => {
    const onCameraChange = vi.fn();
    const rectangles = [{ id: "box-1", number: 2, rect: { x: 100, y: 1000, width: 1200, height: 3000 } }];
    const { rerender } = render(
      <CaptureCanvas
        {...props}
        readOnly
        rectangles={rectangles}
        selectedPinId="box-1"
        savedCamera={saved}
        onCameraChange={onCameraChange}
        revealSelected={0}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reportsBefore = onCameraChange.mock.calls.length;
    rerender(
      <CaptureCanvas
        {...props}
        readOnly
        rectangles={rectangles}
        selectedPinId="box-1"
        savedCamera={saved}
        onCameraChange={onCameraChange}
        revealSelected={1}
      />,
    );
    await waitFor(() => expect(onCameraChange.mock.calls.length).toBeGreaterThan(reportsBefore));
    const report = onCameraChange.mock.calls.at(-1)![0] as CaptureCameraState;
    // 3000 natural px tall must fit 600 screen px minus the padding.
    expect(report.camera.zoom).toBeLessThan(4);
    expect(3000 * report.camera.zoom).toBeLessThanOrEqual(600);
    const middle = flowToScreen({ x: 700, y: 2500 }, report.camera);
    expect(middle.x).toBeCloseTo(400, 6);
    expect(middle.y).toBeCloseTo(300, 6);
  });

  test("with nothing selected an increment moves nothing", async () => {
    const onCameraChange = vi.fn();
    const { rerender } = render(
      <CaptureCanvas {...props} pins={pins} onCameraChange={onCameraChange} revealSelected={0} />,
    );
    // Let the initial entire-capture camera land and settle first.
    await waitFor(() => expect(onCameraChange).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reportsBefore = onCameraChange.mock.calls.length;
    rerender(
      <CaptureCanvas {...props} pins={pins} onCameraChange={onCameraChange} revealSelected={1} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onCameraChange.mock.calls.length).toBe(reportsBefore);
  });
});
