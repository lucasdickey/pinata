// @vitest-environment jsdom
// Component tests for the canvas interaction contract (VAL-CANVAS-006,
// VAL-CANVAS-008): explicit Navigate and Place pin modes, one deliberate tap
// creating exactly one draft, a second tap moving that same draft, Escape
// clearing only transient state, per-plane draft death on capture switch,
// and session camera restore. jsdom proves structure and state, not pixels —
// pixel transforms are covered by the pure camera/geometry oracles and the
// real-browser measurements in e2e/canvas-interactions.spec.ts.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CaptureCanvas, type CaptureCameraState } from "../../src/components/capture-canvas";
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

function stage(): HTMLElement {
  return document.querySelector('[data-testid="capture-stage"]') as HTMLElement;
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

/** A deliberate placement tap at one screen point. */
function tap(target: Element, x: number, y: number): void {
  fireEvent.pointerDown(target, { clientX: x, clientY: y, isPrimary: true });
  fireEvent.pointerUp(target, { clientX: x, clientY: y, isPrimary: true });
}

describe("interaction modes", () => {
  test("Navigate is the initial mode and Place pin is an explicit toggle", async () => {
    const user = userEvent.setup();
    render(<CaptureCanvas {...props} />);
    const navigate = within(stage()).getByRole("button", { name: "Navigate" });
    const pin = within(stage()).getByRole("button", { name: "Place pin" });
    expect(navigate).toHaveAttribute("aria-pressed", "true");
    expect(pin).toHaveAttribute("aria-pressed", "false");

    await user.click(pin);
    expect(pin).toHaveAttribute("aria-pressed", "true");
    expect(navigate).toHaveAttribute("aria-pressed", "false");

    await user.click(navigate);
    expect(navigate).toHaveAttribute("aria-pressed", "true");
    expect(pin).toHaveAttribute("aria-pressed", "false");
  });

  test("the canvas region advertises the active mode", async () => {
    const user = userEvent.setup();
    render(<CaptureCanvas {...props} />);
    const region = within(stage()).getByRole("region");
    expect(region).toHaveAttribute("data-interaction", "navigate");
    await user.click(within(stage()).getByRole("button", { name: "Place pin" }));
    expect(region).toHaveAttribute("data-interaction", "pin");
  });
});

describe("placement gestures", () => {
  test("navigation-mode taps create no mark", () => {
    const onDraftChange = vi.fn();
    render(<CaptureCanvas {...props} onDraftChange={onDraftChange} />);
    tap(frameImage(), 400, 300);
    tap(frameImage(), 420, 320);
    expect(draftNodes()).toHaveLength(0);
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  test("one deliberate tap in Place pin mode creates exactly one draft", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(<CaptureCanvas {...props} onDraftChange={onDraftChange} />);
    await user.click(within(stage()).getByRole("button", { name: "Place pin" }));

    tap(frameImage(), 400, 300);

    expect(draftNodes()).toHaveLength(1);
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    const tip = onDraftChange.mock.calls[0]![0] as { x: number; y: number };
    expect(Number.isFinite(tip.x)).toBe(true);
    expect(Number.isFinite(tip.y)).toBe(true);
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x).toBeLessThanOrEqual(props.width);
    expect(tip.y).toBeGreaterThanOrEqual(0);
    expect(tip.y).toBeLessThanOrEqual(props.height);
    // The draft badge anchors its tip on that exact natural pixel.
    expect(onDraftChange).toHaveBeenLastCalledWith(tip);
  });

  test("a second deliberate tap moves the same draft — never a second mark", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(<CaptureCanvas {...props} onDraftChange={onDraftChange} />);
    await user.click(within(stage()).getByRole("button", { name: "Place pin" }));

    tap(frameImage(), 400, 300);
    const first = onDraftChange.mock.calls.at(-1)![0] as { x: number; y: number };
    // At the jsdom contain zoom the tall capture occupies a narrow strip;
    // both taps must land inside the screenshot to place.
    tap(frameImage(), 410, 450);
    const second = onDraftChange.mock.calls.at(-1)![0] as { x: number; y: number };

    expect(draftNodes()).toHaveLength(1);
    expect(second).not.toEqual(first);
  });

  test("a drag beyond the placement slop is not a placement", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(<CaptureCanvas {...props} onDraftChange={onDraftChange} />);
    await user.click(within(stage()).getByRole("button", { name: "Place pin" }));

    fireEvent.pointerDown(frameImage(), { clientX: 400, clientY: 300, isPrimary: true });
    fireEvent.pointerUp(frameImage(), { clientX: 460, clientY: 360, isPrimary: true });
    expect(draftNodes()).toHaveLength(0);
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  test("a tap on the draft itself does not re-place it", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(<CaptureCanvas {...props} onDraftChange={onDraftChange} />);
    await user.click(within(stage()).getByRole("button", { name: "Place pin" }));
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);

    const calls = onDraftChange.mock.calls.length;
    tap(draftNodes()[0]!, 400, 300);
    expect(onDraftChange.mock.calls.length).toBe(calls);
    expect(draftNodes()).toHaveLength(1);
  });
});

describe("transient state lifecycle", () => {
  test("Escape clears the draft and reports it", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(<CaptureCanvas {...props} onDraftChange={onDraftChange} />);
    await user.click(within(stage()).getByRole("button", { name: "Place pin" }));
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(draftNodes()).toHaveLength(0);
    expect(onDraftChange).toHaveBeenLastCalledWith(null);
  });

  test("Escape while typing in an input does not clear the draft", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Some field" />
        <CaptureCanvas {...props} />
      </>,
    );
    await user.click(within(stage()).getByRole("button", { name: "Place pin" }));
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);

    const input = document.querySelector("input")!;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(draftNodes()).toHaveLength(1);
  });

  test("a draft never crosses planes: switching captures drops it", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CaptureCanvas {...props} />);
    await user.click(within(stage()).getByRole("button", { name: "Place pin" }));
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

describe("persisted pins", () => {
  const pins = [
    { id: "ann-1", number: 1, tip: { x: 720, y: 4000 } },
    { id: "ann-2", number: 2, tip: { x: 100, y: 200 } },
  ];

  test("render as numbered badges parented to the frame, before any draft", async () => {
    const user = userEvent.setup();
    render(<CaptureCanvas {...props} pins={pins} />);
    const badges = pinNodes();
    expect(badges).toHaveLength(2);
    // Stable number order regardless of prop order.
    expect(badges[0]!.textContent).toBe("1");
    expect(badges[1]!.textContent).toBe("2");
    // The draft still stacks after the persisted pins.
    await user.click(within(stage()).getByRole("button", { name: "Place pin" }));
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
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const { rerender } = render(
      <CaptureCanvas {...props} onDraftChange={onDraftChange} draftResetSignal={0} />,
    );
    await user.click(within(stage()).getByRole("button", { name: "Place pin" }));
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);

    rerender(
      <CaptureCanvas {...props} onDraftChange={onDraftChange} draftResetSignal={1} />,
    );
    await waitFor(() => expect(draftNodes()).toHaveLength(0));
    expect(onDraftChange).toHaveBeenLastCalledWith(null);
  });

  test("a pin-mode tap on a saved pin selects it instead of stacking a draft", async () => {
    const user = userEvent.setup();
    render(<CaptureCanvas {...props} pins={pins} />);
    await user.click(within(stage()).getByRole("button", { name: "Place pin" }));
    // A no-travel pointer pair landing on the pin's node wrapper: placement
    // must skip it.
    const wrapper = pinNodes()[0]!;
    fireEvent.pointerDown(wrapper, { clientX: 400, clientY: 300, isPrimary: true });
    fireEvent.pointerUp(wrapper, { clientX: 400, clientY: 300, isPrimary: true });
    expect(draftNodes()).toHaveLength(0);
    // And a tap on clear pane still places exactly one draft.
    tap(frameImage(), 400, 300);
    expect(draftNodes()).toHaveLength(1);
  });

  test("pins are draggable only in Place pin mode; Navigate never moves a mark", async () => {
    const user = userEvent.setup();
    render(<CaptureCanvas {...props} pins={pins} />);
    expect(pinNodes()[0]!.className).not.toContain("draggable");
    await user.click(within(stage()).getByRole("button", { name: "Place pin" }));
    expect(pinNodes()[0]!.className).toContain("draggable");
    await user.click(within(stage()).getByRole("button", { name: "Navigate" }));
    expect(pinNodes()[0]!.className).not.toContain("draggable");
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
