// @vitest-environment jsdom
// Component tests for the thread under a saved pin in the editor panel
// (REQUIREMENTS 6): the original comment leads the thread, entries render
// in server order with server labels, the follow-up composer is bounded and
// sends through the supplied callback, and entries carry no edit or delete
// control. The panel without thread state is unchanged.

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CapturePanel } from "../../src/components/capture-panel";
import { ThreadView } from "../../src/components/thread-view";
import { FEEDBACK_BODY_MAX_CHARS } from "../../src/lib/boundaries";

afterEach(() => cleanup());

const savedPin = {
  id: "ann-1",
  captureId: "cap-1",
  kind: "pin" as const,
  number: 4,
  tip: { x: 720, y: 4000 },
  body: "Tighten the pricing table.",
  elementSnapshot: null,
  revision: 2,
  createdAt: 1_800_000_000_000,
};

const entries = [
  {
    id: "thr-1",
    annotationId: "ann-1",
    actorRole: "founder" as const,
    authorLabel: "founder" as const,
    body: "On it.",
    createdAt: 1_800_000_000_500,
  },
  {
    id: "thr-2",
    annotationId: "ann-1",
    actorRole: "editor" as const,
    authorLabel: "Lucas" as const,
    body: "<img src=x onerror=alert(1)> thanks",
    createdAt: 1_800_000_001_000,
  },
];

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
    draftTip: null,
    draftBody: "",
    onDraftBodyChange: vi.fn(),
    draftChoice: undefined,
    onDraftChoiceChange: vi.fn(),
    draftCandidates: null,
    onPreviewCandidate: vi.fn(),
    onSaveDraft: vi.fn(),
    onCancelDraft: vi.fn(),
    saveState: "idle" as const,
    pinsStatus: "ready" as const,
    pins: [savedPin],
    selectedPinId: "ann-1",
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

describe("CapturePanel thread section", () => {
  test("renders no thread section when no thread state is supplied", () => {
    render(<CapturePanel {...panelProps()} />);
    expect(screen.queryByTestId("thread")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Thread" })).toBeNull();
    // The editor's own controls are untouched.
    expect(screen.getByRole("button", { name: "Edit comment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete pin" })).toBeInTheDocument();
  });

  test("renders the original comment, entries in order with server labels, and the follow-up composer", async () => {
    const user = userEvent.setup();
    const onSendReply = vi.fn();
    const onReplyBodyChange = vi.fn();
    render(
      <CapturePanel
        {...panelProps()}
        thread={{
          originalBody: savedPin.body,
          status: "ready",
          entries,
          replyBody: "",
          onReplyBodyChange,
          onSendReply,
          sendState: "idle",
          composerLabel: "Follow up as Lucas",
          sendLabel: "Send follow-up",
        }}
      />,
    );
    const thread = screen.getByTestId("thread");
    const items = within(within(thread).getByRole("list", { name: "Thread entries" })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute("data-author", "Lucas");
    expect(items[0]).toHaveTextContent("Tighten the pricing table.");
    expect(items[1]).toHaveAttribute("data-author", "founder");
    expect(items[1]).toHaveTextContent("founder");
    expect(items[1]).toHaveTextContent("On it.");
    expect(items[2]).toHaveAttribute("data-author", "Lucas");
    // Hostile text is inert.
    expect(thread.querySelector("img")).toBeNull();
    expect(items[2]).toHaveTextContent("<img src=x onerror=alert(1)> thanks");
    // Entries carry no mutation control; the only button is the composer's.
    expect(within(thread).getAllByRole("button")).toHaveLength(1);
    const composer = within(thread).getByLabelText("Follow up as Lucas");
    expect(composer).toHaveAttribute("maxlength", String(FEEDBACK_BODY_MAX_CHARS));
    expect(within(thread).getByRole("button", { name: "Send follow-up" })).toBeDisabled();
    await user.type(composer, "x");
    expect(onReplyBodyChange).toHaveBeenCalledWith("x");
    expect(thread).toHaveTextContent(/cannot be edited or deleted/);
  });

  test("the send button enables with text and reports send states", async () => {
    const user = userEvent.setup();
    const onSendReply = vi.fn();
    const base = {
      originalBody: savedPin.body,
      entries: [],
      onReplyBodyChange: vi.fn(),
      onSendReply,
      composerLabel: "Follow up as Lucas",
      sendLabel: "Send follow-up",
    };
    const { rerender } = render(
      <ThreadView {...base} status="ready" replyBody="Ready to send" sendState="idle" />,
    );
    expect(screen.getByText("No replies yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send follow-up" }));
    expect(onSendReply).toHaveBeenCalledTimes(1);

    rerender(<ThreadView {...base} status="ready" replyBody="Ready to send" sendState="sending" />);
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    rerender(<ThreadView {...base} status="ready" replyBody="Ready to send" sendState="failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be sent/);
    rerender(<ThreadView {...base} status="ready" replyBody="Ready to send" sendState="throttled" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Too many replies/);
    rerender(<ThreadView {...base} status="loading" replyBody="" sendState="idle" />);
    expect(screen.getByText("Loading replies…")).toBeInTheDocument();
    rerender(<ThreadView {...base} status="failed" replyBody="" sendState="idle" />);
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
  });
});
