// @vitest-environment jsdom
// Component tests for the pin composer (D074, VAL-PIN-003, VAL-PIN-004,
// VAL-PIN-006, VAL-PIN-010): the textarea takes focus when the composer
// opens; the nearby-element choice shows as one chip (the pre-selected top
// candidate, or No element) with Change and No element beside it; the
// candidates section carries the quiescent marker the e2e specs wait on;
// Change expands the ranked radio list with the same hover, focus, and
// touch preview as before and a stable No element radio; Enter saves,
// Shift+Enter does not, Escape cancels; Save waits for a non-blank comment
// and a settled choice; and hostile captured text renders inert.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PinComposer, type PinComposerProps } from "../../src/components/pin-composer";
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

const items = [candidate("cell-1"), candidate("row-1", { kind: "text", tag: "tr" })];

function props(overrides: Partial<PinComposerProps> = {}): PinComposerProps {
  return {
    draftBody: "move this tier",
    onDraftBodyChange: vi.fn(),
    draftChoice: "cell-1",
    onDraftChoiceChange: vi.fn(),
    draftCandidates: { status: "ready", items },
    onPreviewCandidate: vi.fn(),
    onSaveDraft: vi.fn(),
    onCancelDraft: vi.fn(),
    saveState: "idle",
    ...overrides,
  };
}

const context = () => document.querySelector('[data-testid="draft-context"]')!;
const chip = () => document.querySelector('[data-testid="draft-choice"]')!;
const candidateRow = (id: string) =>
  document.querySelector(`.panel-candidate[data-element-id="${id}"]`)!;
const comment = () => screen.getByLabelText("Comment") as HTMLTextAreaElement;

describe("opening", () => {
  test("focuses the comment field as soon as it mounts", () => {
    render(<PinComposer {...props()} />);
    expect(document.activeElement).toBe(comment());
  });
});

describe("the pre-selected choice", () => {
  test("shows the chosen candidate as one chip and marks it by id", () => {
    render(<PinComposer {...props()} />);
    expect(chip()).toHaveAttribute("data-element-id", "cell-1");
    expect(chip()).toHaveTextContent("cell copy cell-1");
    expect(chip()).toHaveTextContent("table-cell");
    // The ranked list stays folded until asked for.
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("button", { name: "Change" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("shows No element when that is the choice, and the button reads as pressed", () => {
    render(<PinComposer {...props({ draftChoice: null })} />);
    expect(chip()).toHaveTextContent("No element");
    expect(chip()).not.toHaveAttribute("data-element-id");
    expect(screen.getByRole("button", { name: "No element" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("says it is still looking while the candidates request is in flight", () => {
    render(
      <PinComposer
        {...props({ draftChoice: undefined, draftCandidates: { status: "loading", items: [] } })}
      />,
    );
    expect(chip()).toHaveTextContent(/looking for nearby elements/i);
    expect(screen.getByRole("button", { name: "Change" })).toBeDisabled();
  });

  test("the No element button asks the workspace for the null decision", async () => {
    const user = userEvent.setup();
    const onDraftChoiceChange = vi.fn();
    render(<PinComposer {...props({ onDraftChoiceChange })} />);
    await user.click(screen.getByRole("button", { name: "No element" }));
    expect(onDraftChoiceChange).toHaveBeenCalledWith(null);
  });

  test("a failed candidates read is explained and Change has nothing to open", () => {
    render(
      <PinComposer
        {...props({ draftChoice: null, draftCandidates: { status: "failed", items: [] } })}
      />,
    );
    expect(context()).toHaveTextContent(/could not be loaded/i);
    expect(screen.getByRole("button", { name: "Change" })).toBeDisabled();
  });
});

describe("quiescent marker", () => {
  test("is loading while candidates are unresolved, settled once they are", () => {
    const { rerender } = render(<PinComposer {...props({ draftCandidates: null })} />);
    expect(context()).toHaveAttribute("data-candidates-state", "loading");
    rerender(<PinComposer {...props({ draftCandidates: { status: "loading", items: [] } })} />);
    expect(context()).toHaveAttribute("data-candidates-state", "loading");
    rerender(<PinComposer {...props()} />);
    expect(context()).toHaveAttribute("data-candidates-state", "ready");
    rerender(<PinComposer {...props({ draftCandidates: { status: "failed", items: [] } })} />);
    expect(context()).toHaveAttribute("data-candidates-state", "failed");
  });
});

describe("Change: the ranked list", () => {
  test("expands the candidates as radios in ranked order with No element last", async () => {
    const user = userEvent.setup();
    render(<PinComposer {...props()} />);
    await user.click(screen.getByRole("button", { name: "Change" }));
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0]).toBeChecked();
    expect(radios[2]).toHaveAccessibleName("No element");
    expect(screen.getByRole("button", { name: "Change" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("choosing a radio reports the candidate id; the No element radio reports null", async () => {
    const user = userEvent.setup();
    const onDraftChoiceChange = vi.fn();
    render(<PinComposer {...props({ onDraftChoiceChange })} />);
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("radio", { name: /row-1/ }));
    expect(onDraftChoiceChange).toHaveBeenLastCalledWith("row-1");
    await user.click(screen.getByRole("radio", { name: "No element" }));
    expect(onDraftChoiceChange).toHaveBeenLastCalledWith(null);
  });

  test("the No element radio keeps its DOM identity while the list re-renders", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PinComposer {...props()} />);
    await user.click(screen.getByRole("button", { name: "Change" }));
    const before = screen.getByRole("radio", { name: "No element" });
    rerender(
      <PinComposer
        {...props({
          draftCandidates: { status: "ready", items: [candidate("cell-9"), ...items] },
        })}
      />,
    );
    expect(screen.getByRole("radio", { name: "No element" })).toBe(before);
  });

  test("mouse hover previews exactly that candidate, leaving clears", async () => {
    const user = userEvent.setup();
    const onPreviewCandidate = vi.fn();
    render(<PinComposer {...props({ onPreviewCandidate })} />);
    await user.click(screen.getByRole("button", { name: "Change" }));
    const row = candidateRow("cell-1");
    fireEvent.mouseEnter(row);
    expect(onPreviewCandidate).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "cell-1", rect: { x: 808.5, y: 4202.25, width: 216.75, height: 98.5 } }),
    );
    fireEvent.mouseLeave(row);
    expect(onPreviewCandidate).toHaveBeenLastCalledWith(null);
  });

  test("keyboard focus previews and blur clears", async () => {
    const user = userEvent.setup();
    const onPreviewCandidate = vi.fn();
    render(<PinComposer {...props({ onPreviewCandidate })} />);
    await user.click(screen.getByRole("button", { name: "Change" }));
    const input = candidateRow("row-1").querySelector("input")!;
    fireEvent.focus(input);
    expect((onPreviewCandidate.mock.calls.at(-1)![0] as PinElementSnapshot).id).toBe("row-1");
    fireEvent.blur(input);
    expect(onPreviewCandidate).toHaveBeenLastCalledWith(null);
  });

  test("the documented touch action — a finger held on a candidate — previews while down", async () => {
    const user = userEvent.setup();
    const onPreviewCandidate = vi.fn();
    render(<PinComposer {...props({ onPreviewCandidate })} />);
    await user.click(screen.getByRole("button", { name: "Change" }));
    const row = candidateRow("cell-1");
    fireEvent.touchStart(row);
    expect((onPreviewCandidate.mock.calls.at(-1)![0] as PinElementSnapshot).id).toBe("cell-1");
    fireEvent.touchEnd(row);
    expect(onPreviewCandidate).toHaveBeenLastCalledWith(null);
    fireEvent.touchStart(row);
    fireEvent.touchCancel(row);
    expect(onPreviewCandidate).toHaveBeenLastCalledWith(null);
  });

  test("hovering the chip previews the chosen element; the No element row never previews", async () => {
    const user = userEvent.setup();
    const onPreviewCandidate = vi.fn();
    render(<PinComposer {...props({ onPreviewCandidate })} />);
    fireEvent.mouseEnter(chip());
    expect((onPreviewCandidate.mock.calls.at(-1)![0] as PinElementSnapshot).id).toBe("cell-1");
    fireEvent.mouseLeave(chip());
    expect(onPreviewCandidate).toHaveBeenLastCalledWith(null);
    onPreviewCandidate.mockClear();
    await user.click(screen.getByRole("button", { name: "Change" }));
    const noElement = document.querySelector(".panel-candidate:not([data-element-id])")!;
    fireEvent.mouseEnter(noElement);
    fireEvent.mouseLeave(noElement);
    expect(onPreviewCandidate).not.toHaveBeenCalled();
  });
});

describe("keyboard", () => {
  test("Enter saves when the comment is non-blank and the choice has settled", () => {
    const onSaveDraft = vi.fn();
    render(<PinComposer {...props({ onSaveDraft })} />);
    fireEvent.keyDown(comment(), { key: "Enter" });
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
  });

  test("Shift+Enter does not save (the textarea keeps its newline)", () => {
    const onSaveDraft = vi.fn();
    render(<PinComposer {...props({ onSaveDraft })} />);
    fireEvent.keyDown(comment(), { key: "Enter", shiftKey: true });
    expect(onSaveDraft).not.toHaveBeenCalled();
  });

  test("Enter does nothing while the comment is blank or the choice is unsettled", () => {
    const onSaveDraft = vi.fn();
    const { rerender } = render(<PinComposer {...props({ onSaveDraft, draftBody: "   " })} />);
    fireEvent.keyDown(comment(), { key: "Enter" });
    rerender(
      <PinComposer
        {...props({
          onSaveDraft,
          draftChoice: undefined,
          draftCandidates: { status: "loading", items: [] },
        })}
      />,
    );
    fireEvent.keyDown(comment(), { key: "Enter" });
    expect(onSaveDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save pin" })).toBeDisabled();
  });

  test("Escape cancels from the textarea and from any control inside", async () => {
    const user = userEvent.setup();
    const onCancelDraft = vi.fn();
    render(<PinComposer {...props({ onCancelDraft })} />);
    fireEvent.keyDown(comment(), { key: "Escape" });
    expect(onCancelDraft).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.keyDown(screen.getByRole("radio", { name: "No element" }), { key: "Escape" });
    expect(onCancelDraft).toHaveBeenCalledTimes(2);
  });

  test("Escape inside the composer does not reach window listeners", () => {
    const windowListener = vi.fn();
    window.addEventListener("keydown", windowListener);
    render(<PinComposer {...props()} />);
    fireEvent.keyDown(comment(), { key: "Escape" });
    fireEvent.keyDown(comment(), { key: "a" });
    window.removeEventListener("keydown", windowListener);
    const keys = windowListener.mock.calls.map((call) => (call[0] as KeyboardEvent).key);
    expect(keys).toEqual(["a"]);
  });
});

describe("Save and Cancel", () => {
  test("Save is enabled only with a non-blank comment and a settled choice", () => {
    const { rerender } = render(<PinComposer {...props()} />);
    expect(screen.getByRole("button", { name: "Save pin" })).toBeEnabled();
    rerender(<PinComposer {...props({ draftBody: "" })} />);
    expect(screen.getByRole("button", { name: "Save pin" })).toBeDisabled();
    rerender(<PinComposer {...props({ draftChoice: null })} />);
    expect(screen.getByRole("button", { name: "Save pin" })).toBeEnabled();
    rerender(<PinComposer {...props({ saveState: "saving" })} />);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  test("a failed save keeps everything and says so", () => {
    render(<PinComposer {...props({ saveState: "failed" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved/i);
    expect(comment()).toHaveValue("move this tier");
    expect(chip()).toHaveAttribute("data-element-id", "cell-1");
  });
});

describe("hostile captured content", () => {
  test("markup, controls, and bidi text render as inert escaped text", async () => {
    const user = userEvent.setup();
    const hostile = candidate("evil-1", {
      text: '<img src=x onerror="alert(1)"> ‮reversed‬ <button>click</button>',
      accessibleName: '<svg onload="alert(2)">',
    });
    render(
      <PinComposer
        {...props({ draftChoice: "evil-1", draftCandidates: { status: "ready", items: [hostile] } })}
      />,
    );
    // In the chip…
    expect(chip().textContent).toContain('<img src=x onerror="alert(1)">');
    expect(chip().querySelector("img")).toBeNull();
    // …and in the expanded list.
    await user.click(screen.getByRole("button", { name: "Change" }));
    const row = candidateRow("evil-1");
    expect(row.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector("button")).toBeNull();
    expect(row.querySelector("svg")).toBeNull();
  });
});

describe("the box draft (D079)", () => {
  test("names the kind in the title, the save button, and the candidate legend", async () => {
    const user = userEvent.setup();
    render(<PinComposer {...props({ draftKind: "rectangle" })} />);
    expect(screen.getByText(/^New box/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save box" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Save pin" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByText("Nearby elements, most overlap first")).toBeInTheDocument();
    // The chip, the choice controls, and the keyboard contract are shared.
    expect(chip()).toHaveAttribute("data-element-id", "cell-1");
    expect(context()).toHaveAttribute("data-candidates-state", "ready");
  });

  test("defaults to a pin when no kind is given", () => {
    render(<PinComposer {...props()} />);
    expect(screen.getByText(/^New pin/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save pin" })).toBeInTheDocument();
  });
});
