"use client";

// The screen-fixed selection/comment/metadata panel (VAL-CANVAS-002,
// VAL-PIN-001, VAL-PIN-003, VAL-PIN-008). It lives outside the transformed
// canvas, so panning and zooming never move it. Exactly one canvas object
// can be selected at a time:
//
// - An open draft shows the comment editor and the explicit context
//   decision: the ranked nearby candidates from the capture's own persisted
//   manifest, plus "No element". A draft starts undecided, and Save stays
//   disabled until Lucas has both written a non-blank comment and explicitly
//   chosen a candidate or "No element". Save persists the pin with its
//   server-assigned number; Cancel/Escape discards it; a failed save keeps
//   the comment and the decision so a retry can replay the same intent.
// - A saved pin shows its number, comment, and immutable context snapshot
//   (or the explicit "No element"), and offers Edit comment and Delete pin.
//   Both carry the pin's current revision; a conflict means another session
//   wrote first, and the panel says so while the workspace reloads the
//   authoritative list.
// - The pins list keeps every mark reachable by keyboard, and the capture
//   identity facts follow the active plane.

import { FEEDBACK_BODY_MAX_CHARS } from "../lib/boundaries";
import type { PinAnnotationView, PinElementSnapshot } from "../lib/annotations";
import type { NaturalPoint } from "../lib/canvas/camera";
import type { AttemptView } from "./project-workspace";

export const VARIANT_LABELS: Record<string, string> = { desktop: "Desktop", mobile: "Mobile" };

export const STATE_LABELS: Record<AttemptView["state"], string> = {
  pending: "Queued",
  capturing: "Capturing",
  stale: "Stopped responding",
  ready: "Ready",
  failed: "Failed",
};

export function variantLabel(variant: string): string {
  return VARIANT_LABELS[variant] ?? variant;
}

/** The draft's nearby-candidate fetch state for the panel. */
export interface DraftCandidates {
  status: "loading" | "ready" | "failed";
  items: PinElementSnapshot[];
}

/** Short human label for one candidate or snapshot: kind plus a snippet. */
function snapshotLabel(element: PinElementSnapshot): string {
  const snippet = (element.text || element.accessibleName || element.tag || element.kind).slice(
    0,
    80,
  );
  return `${element.kind} <${element.tag || "element"}> — “${snippet}”`;
}

export function CapturePanel({
  attempt,
  pageUrl,
  variant,
  ready,
  draftTip,
  draftBody,
  onDraftBodyChange,
  draftChoice,
  onDraftChoiceChange,
  draftCandidates,
  onPreviewCandidate,
  onSaveDraft,
  onCancelDraft,
  saveState,
  pinsStatus,
  pins,
  selectedPinId,
  onSelectPin,
  moveError,
  editing,
  editBody,
  onEditBodyChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  editState,
  confirmingDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  deleteState,
}: {
  attempt: AttemptView | null;
  pageUrl: string;
  variant: string;
  /** Whether the active capture is annotatable (ready). */
  ready: boolean;
  /** The active plane's transient draft pin tip, in natural pixels. */
  draftTip: NaturalPoint | null;
  draftBody: string;
  onDraftBodyChange: (value: string) => void;
  /**
   * The explicit context decision: undefined = undecided (Save disabled),
   * null = "No element", otherwise a candidate's capture-local id.
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
  pinsStatus: "loading" | "ready" | "failed" | null;
  pins: PinAnnotationView[];
  selectedPinId: string | null;
  onSelectPin: (annotationId: string | null) => void;
  moveError: string | null;
  editing: boolean;
  editBody: string;
  onEditBodyChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  editState: "idle" | "saving" | "failed" | "conflict";
  confirmingDelete: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  deleteState: "idle" | "deleting" | "failed" | "conflict";
}) {
  const selectedPin = pins.find((pin) => pin.id === selectedPinId) ?? null;
  const saveDisabled =
    saveState === "saving" || draftBody.trim().length === 0 || draftChoice === undefined;
  return (
    <aside
      className="workspace-panel"
      aria-label="Selection and capture details"
      data-testid="capture-panel"
    >
      <h4>Selection</h4>
      {draftTip ? (
        <div className="panel-draft" data-testid="panel-draft">
          <p className="panel-empty">
            Draft pin at natural pixel ({Math.round(draftTip.x)}, {Math.round(draftTip.y)}) — not
            saved yet.
          </p>
          <label className="panel-field">
            Comment
            <textarea
              value={draftBody}
              onChange={(event) => onDraftBodyChange(event.target.value)}
              maxLength={FEEDBACK_BODY_MAX_CHARS}
              rows={3}
              placeholder="What should change here?"
            />
          </label>
          {/*
            data-candidates-state is the panel's quiescent marker: it reads
            "loading" until the nearby-candidate read resolves and "ready" /
            "failed" once the list below is final. Specs wait for a settled
            value before clicking a radio — without it the async render can
            detach a radio mid-click under CPU contention.
          */}
          <fieldset
            className="panel-field panel-candidates"
            data-testid="draft-context"
            data-candidates-state={draftCandidates?.status ?? "loading"}
          >
            <legend>Attach to a nearby element?</legend>
            {draftCandidates?.status === "loading" ? (
              <p className="panel-note">Looking for nearby elements…</p>
            ) : null}
            {draftCandidates?.status === "failed" ? (
              <p className="panel-note">
                Nearby elements could not be loaded. You can still save with No element.
              </p>
            ) : null}
            {draftCandidates?.status === "ready"
              ? draftCandidates.items.map((candidate) => (
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
                ))
              : null}
            {/*
              The explicit "No element" decision. Its key keeps this exact DOM
              node stable across the loading → ready transition above, so a
              click already in flight can never land on a detached radio.
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
            {draftChoice === undefined ? (
              <p className="panel-hint">
                Choose a nearby element or No element before saving.
              </p>
            ) : null}
          </fieldset>
          <p className="panel-actions">
            <button type="button" onClick={onSaveDraft} disabled={saveDisabled}>
              {saveState === "saving" ? "Saving…" : "Save pin"}
            </button>
            <button type="button" onClick={onCancelDraft} disabled={saveState === "saving"}>
              Cancel
            </button>
          </p>
          {saveState === "failed" ? (
            <p role="alert" className="capture-error">
              That pin could not be saved. Your draft and comment are still here — try again.
            </p>
          ) : null}
        </div>
      ) : selectedPin ? (
        <div className="panel-pin" data-testid="panel-pin">
          <p>
            <strong>Pin {selectedPin.number}</strong> at natural pixel (
            {Math.round(selectedPin.tip.x)}, {Math.round(selectedPin.tip.y)})
          </p>
          {editing ? (
            <label className="panel-field">
              Edit comment
              <textarea
                value={editBody}
                onChange={(event) => onEditBodyChange(event.target.value)}
                maxLength={FEEDBACK_BODY_MAX_CHARS}
                rows={3}
              />
            </label>
          ) : (
            <p className="panel-pin-body">{selectedPin.body}</p>
          )}
          <p className="panel-snapshot" data-testid="panel-snapshot">
            {selectedPin.elementSnapshot
              ? `Element: ${snapshotLabel(selectedPin.elementSnapshot)}`
              : "Element: No element"}
          </p>
          {editing ? (
            <p className="panel-actions">
              <button
                type="button"
                onClick={onSaveEdit}
                disabled={editState === "saving" || editBody.trim().length === 0}
              >
                {editState === "saving" ? "Saving…" : "Save edit"}
              </button>
              <button type="button" onClick={onCancelEdit} disabled={editState === "saving"}>
                Cancel edit
              </button>
            </p>
          ) : confirmingDelete ? (
            <p className="panel-actions">
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={deleteState === "deleting"}
              >
                {deleteState === "deleting" ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={onCancelDelete}
                disabled={deleteState === "deleting"}
              >
                Keep pin
              </button>
            </p>
          ) : (
            <p className="panel-actions">
              <button type="button" onClick={onStartEdit}>
                Edit comment
              </button>
              <button type="button" onClick={onRequestDelete}>
                Delete pin
              </button>
            </p>
          )}
          {editState === "failed" ? (
            <p role="alert" className="capture-error">
              That edit could not be saved. Your text is still here — try again.
            </p>
          ) : null}
          {deleteState === "failed" ? (
            <p role="alert" className="capture-error">
              That pin could not be deleted. Try again.
            </p>
          ) : null}
          {editState === "conflict" || deleteState === "conflict" ? (
            <p role="alert" className="capture-error">
              This pin changed in another session. The latest version is now shown.
            </p>
          ) : null}
          <p className="panel-note">
            Drag the pin on the screenshot (in Place pin mode) to move it. Deleting a pin retires
            its number forever.
          </p>
        </div>
      ) : (
        <p className="panel-empty">Nothing selected.</p>
      )}
      {moveError ? (
        <p role="alert" className="capture-error">
          {moveError}
        </p>
      ) : null}

      {ready ? (
        <>
          <h4>Pins on this capture</h4>
          {pinsStatus === "loading" ? <p className="panel-note">Loading pins…</p> : null}
          {pinsStatus === "failed" ? (
            <p className="panel-note">
              Pins could not be loaded. Switch to another capture and back to retry.
            </p>
          ) : null}
          {pinsStatus === "ready" && pins.length === 0 ? (
            <p className="panel-note">
              No pins yet. Choose Place pin above the screenshot, then click or tap the page to
              drop the first one.
            </p>
          ) : null}
          {pins.length > 0 ? (
            <ol className="pin-list" aria-label="Saved pins">
              {pins.map((pin) => (
                <li key={pin.id}>
                  <button
                    type="button"
                    aria-current={pin.id === selectedPinId ? "true" : undefined}
                    onClick={() => onSelectPin(pin.id === selectedPinId ? null : pin.id)}
                  >
                    Pin {pin.number} — at ({Math.round(pin.tip.x)}, {Math.round(pin.tip.y)})
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : null}

      <h4>Capture</h4>
      <dl className="panel-facts">
        <dt>Page</dt>
        <dd className="panel-url">{pageUrl}</dd>
        <dt>Device</dt>
        <dd>{variantLabel(variant)}</dd>
        <dt>Version</dt>
        <dd>{attempt ? `v${attempt.attempt}` : "—"}</dd>
        <dt>State</dt>
        <dd>{attempt ? STATE_LABELS[attempt.state] : "Not captured"}</dd>
        {attempt?.state === "ready" &&
        attempt.documentWidth !== null &&
        attempt.documentHeight !== null ? (
          <>
            <dt>Natural size</dt>
            <dd>
              {attempt.documentWidth} × {attempt.documentHeight} px
            </dd>
          </>
        ) : null}
        {attempt?.imageHash ? (
          <>
            <dt>Image hash</dt>
            <dd>
              <code>{attempt.imageHash.slice(0, 12)}…</code>
            </dd>
          </>
        ) : null}
      </dl>
    </aside>
  );
}
