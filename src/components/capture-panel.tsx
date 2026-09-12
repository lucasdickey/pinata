"use client";

// The screen-fixed selection/metadata panel (VAL-CANVAS-002, VAL-PIN-001,
// VAL-PIN-003, VAL-PIN-008). It lives outside the transformed canvas, so
// panning and zooming never move it. Exactly one saved pin can be selected
// at a time:
//
// - A saved mark (a pin, or a rectangle since D079, which shows its bounds)
//   shows its number, comment, and immutable context snapshot (or the
//   explicit "No element"), and offers Edit comment and Delete. Both carry
//   the mark's current revision; a conflict means another session wrote
//   first, and the panel says so while the workspace reloads the
//   authoritative list.
// - The pins list keeps every mark, pin and box alike, reachable by
//   keyboard in number order, and the capture identity facts follow the
//   active plane.
//
// A draft pin is composed beside its badge, not here (D074): see
// pin-composer.tsx. The panel keeps showing the selected saved pin, if any,
// while a draft is open.

import { FEEDBACK_BODY_MAX_CHARS } from "../lib/boundaries";
import type { AnnotationView, PinElementSnapshot } from "../lib/annotations";
import type { NaturalPoint } from "../lib/canvas/camera";
import { markKindNoun, markPosition, markTitle } from "../lib/canvas/marks";
import { PIN_STATUS_LABELS } from "../lib/feedback-counts";
import type { AttemptView } from "./project-workspace";
import { snapshotLabel } from "./pin-composer";
import { ThreadView, type ThreadViewProps } from "./thread-view";

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

export function CapturePanel({
  attempt,
  pageUrl,
  variant,
  ready,
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
  onSetPinStatus,
  statusState = "idle",
  thread,
}: {
  attempt: AttemptView | null;
  pageUrl: string;
  variant: string;
  /** Whether the active capture is annotatable (ready). */
  ready: boolean;
  pinsStatus: "loading" | "ready" | "failed" | null;
  /** Every live mark on the capture, pins and rectangles, in number order. */
  pins: AnnotationView[];
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
  /**
   * Resolve or reopen the selected pin (D075). Optional so the panel's
   * existing surface is unchanged when the workspace supplies no handler.
   */
  onSetPinStatus?: (action: "resolve" | "reopen") => void;
  statusState?: "idle" | "saving" | "failed";
  /**
   * The selected pin's append-only thread plus the editor's follow-up
   * composer (REQUIREMENTS 6). Optional so the panel's existing surface is
   * unchanged when no thread state is supplied.
   */
  thread?: ThreadViewProps;
}) {
  const selectedPin = pins.find((pin) => pin.id === selectedPinId) ?? null;
  const noun = selectedPin ? markKindNoun(selectedPin.kind) : "pin";
  return (
    <aside
      className="workspace-panel"
      aria-label="Selection and capture details"
      data-testid="capture-panel"
    >
      <h4>Selection</h4>
      {selectedPin ? (
        <div className="panel-pin" data-testid="panel-pin">
          <p data-testid="panel-position" data-kind={selectedPin.kind}>
            <strong>{markTitle(selectedPin)}</strong>{" "}
            {selectedPin.kind === "rectangle"
              ? `at natural pixels (${markPosition(selectedPin)})`
              : `at natural pixel (${markPosition(selectedPin)})`}
          </p>
          {/* The pin lifecycle (D075): its status, and one control that
              resolves an open or replied pin or reopens a resolved one. */}
          <p className="panel-status" data-testid="panel-status" data-status={selectedPin.status}>
            Status: {PIN_STATUS_LABELS[selectedPin.status] ?? selectedPin.status}
            {selectedPin.unreadReplies > 0 ? (
              <span className="pin-unread"> · {selectedPin.unreadReplies} new</span>
            ) : null}
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
                Keep {noun}
              </button>
            </p>
          ) : (
            <p className="panel-actions">
              <button type="button" onClick={onStartEdit}>
                Edit comment
              </button>
              <button type="button" onClick={onRequestDelete}>
                Delete {noun}
              </button>
              {onSetPinStatus ? (
                <button
                  type="button"
                  disabled={statusState === "saving"}
                  onClick={() =>
                    onSetPinStatus(selectedPin.status === "resolved" ? "reopen" : "resolve")
                  }
                >
                  {statusState === "saving"
                    ? "Saving…"
                    : selectedPin.status === "resolved"
                      ? `Reopen ${noun}`
                      : `Resolve ${noun}`}
                </button>
              ) : null}
            </p>
          )}
          {statusState === "failed" ? (
            <p role="alert" className="capture-error">
              That status change could not be saved. Try again.
            </p>
          ) : null}
          {editState === "failed" ? (
            <p role="alert" className="capture-error">
              That edit could not be saved. Your text is still here — try again.
            </p>
          ) : null}
          {deleteState === "failed" ? (
            <p role="alert" className="capture-error">
              That {noun} could not be deleted. Try again.
            </p>
          ) : null}
          {editState === "conflict" || deleteState === "conflict" ? (
            <p role="alert" className="capture-error">
              This {noun} changed in another session. The latest version is now shown.
            </p>
          ) : null}
          <p className="panel-note">
            {selectedPin.kind === "rectangle"
              ? "Drag the box's edge or badge to move it and its handles to resize it. Deleting a box retires its number forever."
              : "Drag the pin on the screenshot to move it. Deleting a pin retires its number forever."}
          </p>
          {thread ? (
            <>
              <h4>Thread</h4>
              <ThreadView {...thread} />
            </>
          ) : null}
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
            <p className="panel-note">No pins yet. Click or tap the page to drop the first one.</p>
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
                    {markTitle(pin)} — at ({markPosition(pin)})
                    {pin.status === "resolved" ? (
                      <span className="pin-status"> · Resolved</span>
                    ) : null}
                    {pin.unreadReplies > 0 ? (
                      <span className="pin-unread"> · {pin.unreadReplies} new</span>
                    ) : null}
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
