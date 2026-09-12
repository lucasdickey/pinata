"use client";

// The pin composer (D074): the comment editor for the one transient draft
// pin. It opens in a popover beside the draft badge instead of in the side
// panel — the canvas renders it outside the transformed React Flow plane,
// positions it from the draft's projected screen point, and re-positions it
// on every pan and zoom (see DraftComposerPopover in capture-canvas.tsx).
//
// The nearby-element decision stays explicit in the data (VAL-PIN-003,
// D061): the client still sends one candidate id or null and the server
// derives the snapshot. What changes is the default. When the nearby
// candidate read resolves, the workspace pre-selects the top-ranked
// candidate — or "No element" when there is none or the read failed — and
// the composer shows that choice as one chip with "Change" (which expands
// the ranked radio list, with the same hover, focus, and touch preview as
// before) and "No element" beside it. Save is enabled as soon as the comment
// is non-blank and the candidates request has settled, so the common case is
// type, then Enter. Enter saves, Shift+Enter inserts a newline, Escape
// cancels. The composer never writes on its own: Save and Cancel are the
// workspace's callbacks.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { FEEDBACK_BODY_MAX_CHARS } from "../lib/boundaries";
import type { PinElementSnapshot } from "../lib/annotations";

/** The draft's nearby-candidate fetch state. */
export interface DraftCandidates {
  status: "loading" | "ready" | "failed";
  items: PinElementSnapshot[];
}

export interface PinComposerProps {
  draftBody: string;
  onDraftBodyChange: (value: string) => void;
  /**
   * The nearby-element decision: undefined while the candidates request is
   * still in flight (Save disabled), null for "No element", otherwise a
   * candidate's capture-local id.
   */
  draftChoice: string | null | undefined;
  onDraftChoiceChange: (choice: string | null) => void;
  draftCandidates: DraftCandidates | null;
  /**
   * Preview one candidate's manifest rectangle on the canvas (null clears).
   * Fired by mouse hover, keyboard focus, and the documented touch action —
   * a finger held on a candidate row — and never persists anything.
   */
  onPreviewCandidate: (candidate: PinElementSnapshot | null) => void;
  onSaveDraft: () => void;
  onCancelDraft: () => void;
  saveState: "idle" | "saving" | "failed";
}

/** Human label for one candidate or snapshot: kind, tag, and a snippet. */
export function snapshotLabel(element: PinElementSnapshot): string {
  const snippet = (element.text || element.accessibleName || element.tag || element.kind).slice(
    0,
    80,
  );
  return `${element.kind} <${element.tag || "element"}> — “${snippet}”`;
}

/** The shorter form the chip shows: the snippet first, then the kind. */
export function chipLabel(element: PinElementSnapshot): string {
  const snippet = (element.text || element.accessibleName || element.tag || element.kind).slice(
    0,
    60,
  );
  return `“${snippet}” (${element.kind})`;
}

export function PinComposer({
  draftBody,
  onDraftBodyChange,
  draftChoice,
  onDraftChoiceChange,
  draftCandidates,
  onPreviewCandidate,
  onSaveDraft,
  onCancelDraft,
  saveState,
}: PinComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  // The comment is what the editor came to write: focus it as soon as the
  // draft appears, without scrolling the page under the pin.
  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  const status = draftCandidates?.status ?? "loading";
  const items = draftCandidates?.status === "ready" ? draftCandidates.items : [];
  const chosen =
    typeof draftChoice === "string"
      ? (items.find((candidate) => candidate.id === draftChoice) ?? null)
      : null;
  const saveDisabled =
    saveState === "saving" || draftBody.trim().length === 0 || draftChoice === undefined;

  const onTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter saves; Shift+Enter keeps the textarea's own newline. A composing
    // IME keystroke is never a save.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!saveDisabled) onSaveDraft();
  };

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    // Handled here: the canvas's own Escape listener must not act twice.
    event.stopPropagation();
    if (saveState !== "saving") onCancelDraft();
  };

  return (
    <div className="pin-composer-body" onKeyDown={onRootKeyDown}>
      <p className="pin-composer-title">
        New pin <span className="panel-note">— not saved yet</span>
      </p>
      <label className="panel-field">
        Comment
        <textarea
          ref={textareaRef}
          value={draftBody}
          onChange={(event) => onDraftBodyChange(event.target.value)}
          onKeyDown={onTextareaKeyDown}
          maxLength={FEEDBACK_BODY_MAX_CHARS}
          rows={3}
          placeholder="What should change here?"
        />
      </label>
      {/*
        data-candidates-state is the composer's quiescent marker: it reads
        "loading" until the nearby-candidate read resolves and "ready" /
        "failed" once the choice below is final. Specs wait for a settled
        value before touching the controls in here.
      */}
      <div
        className="pin-composer-context"
        data-testid="draft-context"
        data-candidates-state={status}
      >
        <p className="pin-composer-attach">
          <span className="pin-composer-attach-label">Attached to</span>
          <span
            className="pin-composer-chip"
            data-testid="draft-choice"
            data-element-id={chosen?.id}
            onMouseEnter={() => onPreviewCandidate(chosen)}
            onMouseLeave={() => onPreviewCandidate(null)}
            onTouchStart={() => onPreviewCandidate(chosen)}
            onTouchEnd={() => onPreviewCandidate(null)}
            onTouchCancel={() => onPreviewCandidate(null)}
          >
            {draftChoice === undefined
              ? "Looking for nearby elements…"
              : chosen
                ? chipLabel(chosen)
                : "No element"}
          </span>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            disabled={items.length === 0}
            onClick={() => setExpanded((value) => !value)}
          >
            Change
          </button>
          <button
            type="button"
            aria-pressed={draftChoice === null}
            onClick={() => onDraftChoiceChange(null)}
          >
            No element
          </button>
        </p>
        {status === "failed" ? (
          <p className="panel-note">
            Nearby elements could not be loaded, so this pin is not attached to one.
          </p>
        ) : null}
        {expanded ? (
          <fieldset id={listId} className="panel-candidates">
            <legend>Nearby elements, closest first</legend>
            {items.map((candidate) => (
              <label
                key={candidate.id}
                className="panel-candidate"
                data-element-id={candidate.id}
                onMouseEnter={() => onPreviewCandidate(candidate)}
                onMouseLeave={() => onPreviewCandidate(null)}
                onTouchStart={() => onPreviewCandidate(candidate)}
                onTouchEnd={() => onPreviewCandidate(null)}
                onTouchCancel={() => onPreviewCandidate(null)}
              >
                <input
                  type="radio"
                  name="draft-element"
                  value={candidate.id}
                  checked={draftChoice === candidate.id}
                  onChange={() => onDraftChoiceChange(candidate.id)}
                  onFocus={() => onPreviewCandidate(candidate)}
                  onBlur={() => onPreviewCandidate(null)}
                />
                <span>{snapshotLabel(candidate)}</span>
              </label>
            ))}
            {/*
              The explicit "No element" choice, always last. Its key keeps
              this exact DOM node stable while the list above re-renders, so
              a click already in flight can never land on a detached radio.
            */}
            <label key="no-element" className="panel-candidate">
              <input
                type="radio"
                name="draft-element"
                value=""
                checked={draftChoice === null}
                onChange={() => onDraftChoiceChange(null)}
              />
              <span>No element</span>
            </label>
          </fieldset>
        ) : null}
      </div>
      <p className="panel-actions">
        <button type="button" onClick={onSaveDraft} disabled={saveDisabled}>
          {saveState === "saving" ? "Saving…" : "Save pin"}
        </button>
        <button type="button" onClick={onCancelDraft} disabled={saveState === "saving"}>
          Cancel
        </button>
      </p>
      <p className="panel-hint">Enter saves · Shift+Enter starts a new line · Escape cancels</p>
      {saveState === "failed" ? (
        <p role="alert" className="capture-error">
          That pin could not be saved. Your draft and comment are still here — try again.
        </p>
      ) : null}
    </div>
  );
}
