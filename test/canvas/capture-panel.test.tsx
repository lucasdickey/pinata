// @vitest-environment jsdom
// Component tests for the draft context decision panel (VAL-PIN-003,
// VAL-PIN-004, VAL-PIN-006, VAL-PIN-010): the candidate list carries a
// quiescent marker the e2e specs wait on before clicking (the radio used to
// be detached mid-click by the async candidates render); hovering, focusing,
// or touching a candidate asks the workspace to preview exactly that
// manifest element's rectangle on the canvas; hostile captured text renders
// as inert escaped text; and the "No element" radio keeps its DOM identity
// across the loading → ready transition.

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
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

function draftProps(overrides: Record<string, unknown> = {}) {
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
    draftTip: { x: 900, y: 4210 },
    draftBody: "move this tier",
    onDraftBodyChange: vi.fn(),
    draftChoice: undefined as string | null | undefined,
    onDraftChoiceChange: vi.fn(),
    draftCandidates: {
      status: "ready" as const,
      items: [candidate("cell-1"), candidate("row-1", { kind: "text", tag: "tr" })],
    },
    onSaveDraft: vi.fn(),
    onCancelDraft: vi.fn(),
    saveState: "idle" as const,
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
    onPreviewCandidate: vi.fn(),
    ...overrides,
  };
}

const contextFieldset = () => document.querySelector('[data-testid="draft-context"]')!;
const candidateRow = (id: string) =>
  document.querySelector(`.panel-candidate[data-element-id="${id}"]`)!;

describe("quiescent marker", () => {
  test("is loading while candidates are unresolved, settled once rendered", () => {
    const { rerender } = render(
      <CapturePanel {...draftProps({ draftCandidates: null })} />,
    );
    expect(contextFieldset()).toHaveAttribute("data-candidates-state", "loading");

    rerender(
      <CapturePanel
        {...draftProps({ draftCandidates: { status: "loading", items: [] } })}
      />,
    );
    expect(contextFieldset()).toHaveAttribute("data-candidates-state", "loading");

    rerender(<CapturePanel {...draftProps()} />);
    expect(contextFieldset()).toHaveAttribute("data-candidates-state", "ready");

    rerender(
      <CapturePanel
        {...draftProps({ draftCandidates: { status: "failed", items: [] } })}
      />,
    );
    expect(contextFieldset()).toHaveAttribute("data-candidates-state", "failed");
  });

  test("the No element radio keeps its DOM identity across the loading → ready render", () => {
    const { rerender } = render(
      <CapturePanel
        {...draftProps({ draftCandidates: { status: "loading", items: [] } })}
      />,
    );
    const before = document.querySelector(
      '[data-testid="draft-context"] input[value=""]',
    ) as HTMLInputElement;
    expect(before).not.toBeNull();

    rerender(<CapturePanel {...draftProps()} />);
    const after = document.querySelector(
      '[data-testid="draft-context"] input[value=""]',
    ) as HTMLInputElement;
    // The async candidate render must not detach the radio mid-click.
    expect(after).toBe(before);
  });
});

describe("candidate preview requests", () => {
  test("mouse hover previews exactly that candidate, leaving clears", () => {
    const onPreviewCandidate = vi.fn();
    render(<CapturePanel {...draftProps({ onPreviewCandidate })} />);
    const row = candidateRow("cell-1");
    fireEvent.mouseEnter(row);
    expect(onPreviewCandidate).toHaveBeenCalledTimes(1);
    expect(onPreviewCandidate.mock.calls[0]![0]).toMatchObject({ id: "cell-1", rect: {
      x: 808.5,
      y: 4202.25,
      width: 216.75,
      height: 98.5,
    } });
    fireEvent.mouseLeave(row);
    expect(onPreviewCandidate).toHaveBeenLastCalledWith(null);
  });

  test("keyboard focus previews and blur clears", () => {
    const onPreviewCandidate = vi.fn();
    render(<CapturePanel {...draftProps({ onPreviewCandidate })} />);
    const input = candidateRow("row-1").querySelector("input")!;
    fireEvent.focus(input);
    expect(onPreviewCandidate).toHaveBeenCalledTimes(1);
    expect((onPreviewCandidate.mock.calls[0]![0] as PinElementSnapshot).id).toBe("row-1");
    fireEvent.blur(input);
    expect(onPreviewCandidate).toHaveBeenLastCalledWith(null);
  });

  test("the documented touch action — a finger held on a candidate — previews while down", () => {
    const onPreviewCandidate = vi.fn();
    render(<CapturePanel {...draftProps({ onPreviewCandidate })} />);
    const row = candidateRow("cell-1");
    fireEvent.touchStart(row);
    expect(onPreviewCandidate).toHaveBeenCalledTimes(1);
    expect((onPreviewCandidate.mock.calls[0]![0] as PinElementSnapshot).id).toBe("cell-1");
    fireEvent.touchEnd(row);
    expect(onPreviewCandidate).toHaveBeenLastCalledWith(null);
    fireEvent.touchStart(row);
    fireEvent.touchCancel(row);
    expect(onPreviewCandidate).toHaveBeenLastCalledWith(null);
  });

  test("preview requests never fire for the No element row", () => {
    const onPreviewCandidate = vi.fn();
    render(<CapturePanel {...draftProps({ onPreviewCandidate })} />);
    const noElement = document.querySelector(
      '[data-testid="draft-context"] .panel-candidate:not([data-element-id])',
    )!;
    fireEvent.mouseEnter(noElement);
    fireEvent.mouseLeave(noElement);
    expect(onPreviewCandidate).not.toHaveBeenCalled();
  });
});

describe("hostile captured content", () => {
  test("markup, controls, and bidi text render as inert escaped text", () => {
    const hostile = candidate("evil-1", {
      text: '<img src=x onerror="alert(1)"> ‮reversed‬ <button>click</button>',
      accessibleName: '<svg onload="alert(2)">',
    });
    render(
      <CapturePanel
        {...draftProps({ draftCandidates: { status: "ready", items: [hostile] } })}
      />,
    );
    const row = candidateRow("evil-1");
    // The raw markup survives as text content…
    expect(row.textContent).toContain('<img src=x onerror="alert(1)">');
    // …but no element it describes is ever created.
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector("button")).toBeNull();
    expect(row.querySelector("svg")).toBeNull();
  });

  test("a saved pin's snapshot renders the same inert way", () => {
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
    render(
      <CapturePanel
        {...draftProps({ draftTip: null, pins: [pin], selectedPinId: "ann-1" })}
      />,
    );
    const snapshot = document.querySelector('[data-testid="panel-snapshot"]')!;
    expect(snapshot.textContent).toContain('<form action="https://evil.invalid">x</form>');
    expect(snapshot.querySelector("form")).toBeNull();
  });
});
