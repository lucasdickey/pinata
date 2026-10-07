"use client";

// The screen-fixed pins panel (VAL-CANVAS-002, VAL-PIN-001, VAL-PIN-003,
// VAL-PIN-008). It lives outside the transformed canvas, so panning and
// zooming never move it.
//
// Since D128 it is one accordion: every mark (pin, box, circle, arrow) is a
// row in number order, and the selected one opens in place to show its
// status, its whole comment once, the element it points at, Resolve / Edit /
// Delete, and its replies (scrolling inside the row, latest first in view,
// with the reply box behind a Reply button). Exactly one row is open at a
// time, matching the one selection on the canvas; the rows never move
// while you pick between them. Resolved marks sink into one closed
// "N resolved" group that opens when its mark is selected. Edits and deletes
// carry the mark's revision; a conflict says so while the workspace reloads.
//
// Page, device, natural-pixel coordinates, the capture's version, state,
// size, and image hash, and the keyboard shortcuts sit behind one native
// "Details" disclosure, closed by default (D078). A draft is composed beside
// its badge, not here (D074): see pin-composer.tsx.

import { useEffect, useState } from "react";
import { FEEDBACK_BODY_MAX_CHARS } from "../lib/boundaries";
import type { AnnotationView, PinElementSnapshot } from "../lib/annotations";
import type { NaturalPoint } from "../lib/canvas/camera";
import { markKindNoun, markPosition, markTitle } from "../lib/canvas/marks";
import { PIN_STATUS_LABELS } from "../lib/feedback-counts";
import type { AttemptView } from "./project-workspace";
import { CanvasIcon } from "./canvas-icons";
import { PinBadge, PinRowContent, pinRowName } from "./pin-row";
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

/** What Details calls the selected mark's geometry line, by kind. */
const MARK_DETAIL_LABELS: Record<AnnotationView["kind"], string> = {
  pin: "Position",
  rectangle: "Box",
  circle: "Circle",
  arrow: "Arrow",
};

/**
 * Where the panel's collapsed state is remembered (D112), per browser. A
 * convenience only: read after mount, every access guarded, and a missing
 * or blocked store simply means the panel opens.
 */
export const PANEL_STORAGE_KEY = "pinata.capture-panel";

function readPanelCollapsed(): boolean {
  try {
    return window.localStorage.getItem(PANEL_STORAGE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

function writePanelCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(PANEL_STORAGE_KEY, collapsed ? "collapsed" : "open");
  } catch {
    // Private windows and blocked storage: the choice lasts this visit only.
  }
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
  // Collapsing only hides the panel (D112): it stays mounted, so the
  // workspace's writes, seen-marking, and live refresh carry on behind it.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (readPanelCollapsed()) setCollapsed(true);
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((current) => {
      writePanelCollapsed(!current);
      return !current;
    });
  };
  const openPins = pins.filter((pin) => pin.status !== "resolved");
  const resolvedPins = pins.filter((pin) => pin.status === "resolved");
  const selectedResolved = selectedPin?.status === "resolved";
  const [resolvedOpen, setResolvedOpen] = useState(false);
  // Selecting a resolved mark (from the canvas, or J/K) opens its group.
  useEffect(() => {
    if (selectedResolved) setResolvedOpen(true);
  }, [selectedResolved, selectedPinId]);

  /** What an open row shows below its header: the mark, once, in full. */
  const openBody = (pin: AnnotationView) => (
    <div
      className="pin-open"
      id={`pin-open-${pin.id}`}
      role="group"
      aria-label={markTitle(pin)}
    >
      {/* The pin lifecycle (D075): its status, and one control that
          resolves an open or replied pin or reopens a resolved one. */}
      <p className="panel-status" data-testid="panel-status" data-status={pin.status}>
        Status: {PIN_STATUS_LABELS[pin.status] ?? pin.status}
        {pin.unreadReplies > 0 ? <span className="pin-unread"> · {pin.unreadReplies} new</span> : null}
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
        <p className="panel-pin-body">{pin.body}</p>
      )}
      <p className="panel-snapshot" data-testid="panel-snapshot">
        {pin.elementSnapshot
          ? `Element: ${snapshotLabel(pin.elementSnapshot)}`
          : "Element: No element"}
      </p>
      {(pin.alsoElements ?? []).map((also) => (
        <p key={also.id} className="panel-snapshot panel-snapshot-also">
          Also: {snapshotLabel(also)}
        </p>
      ))}
      {editing ? (
        <p className="panel-actions">
          <button
            type="button"
            className="button-primary"
            aria-label={editState === "saving" ? undefined : "Save edit"}
            onClick={onSaveEdit}
            disabled={editState === "saving" || editBody.trim().length === 0}
          >
            {editState === "saving" ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            aria-label="Cancel edit"
            onClick={onCancelEdit}
            disabled={editState === "saving"}
          >
            Cancel
          </button>
        </p>
      ) : confirmingDelete ? (
        <>
          <p className="panel-note">
            Delete {markTitle(pin)}? Its number is retired and never reused.
          </p>
          <p className="panel-actions">
            <button
              type="button"
              className="button-primary"
              aria-label={deleteState === "deleting" ? undefined : "Confirm delete"}
              onClick={onConfirmDelete}
              disabled={deleteState === "deleting"}
            >
              {deleteState === "deleting" ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              aria-label={`Keep ${noun}`}
              onClick={onCancelDelete}
              disabled={deleteState === "deleting"}
            >
              Keep
            </button>
          </p>
        </>
      ) : (
        <p className="panel-actions">
          {/* Short visible words so the row fits the panel on one line;
              each name still says what it acts on (D114). The lifecycle
              step comes first, as the usual next thing to do. */}
          {onSetPinStatus ? (
            <button
              type="button"
              className="button-primary"
              aria-label={
                statusState === "saving"
                  ? undefined
                  : pin.status === "resolved"
                    ? `Reopen ${noun}`
                    : `Resolve ${noun}`
              }
              disabled={statusState === "saving"}
              onClick={() => onSetPinStatus(pin.status === "resolved" ? "reopen" : "resolve")}
            >
              {statusState === "saving"
                ? "Saving…"
                : pin.status === "resolved"
                  ? "Reopen"
                  : "Resolve"}
            </button>
          ) : null}
          <button type="button" aria-label="Edit comment" onClick={onStartEdit}>
            Edit
          </button>
          <button type="button" aria-label={`Delete ${noun}`} onClick={onRequestDelete}>
            Delete
          </button>
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
      {/* The replies only: the comment is shown once, above (D128). A long
          thread scrolls inside the row, starting at the latest. */}
      {thread ? <ThreadView {...thread} showOriginal={false} scrollEntries replyBehindButton /> : null}
    </div>
  );

  /** One row (D113, shared with the founder's list, D117); open when selected. */
  const row = (pin: AnnotationView) => {
    const open = pin.id === selectedPinId;
    return (
      <li
        key={pin.id}
        className="pin-item"
        data-open={open ? "true" : undefined}
        // The open row as a whole, header and body, is the selected mark.
        data-testid={open ? "panel-pin" : undefined}
      >
        <button
          type="button"
          className="pin-row"
          aria-label={pinRowName(pin, "notable")}
          aria-current={open ? "true" : undefined}
          aria-expanded={open}
          aria-controls={open ? `pin-open-${pin.id}` : undefined}
          data-status={pin.status}
          onClick={() => onSelectPin(open ? null : pin.id)}
        >
          {open ? (
            // Open: the kind and number with its badge (D115); the comment
            // follows in full just below, so it is not repeated here.
            <span className="panel-mark-name" data-testid="panel-mark-name" data-kind={pin.kind}>
              <PinBadge pin={pin} />
              <strong>{markTitle(pin)}</strong>
            </span>
          ) : (
            <PinRowContent pin={pin} status="notable" />
          )}
        </button>
        {open ? openBody(pin) : null}
      </li>
    );
  };

  return (
    <aside
      className="workspace-panel"
      aria-label="Selection and capture details"
      data-testid="capture-panel"
      data-collapsed={collapsed ? "true" : undefined}
    >
      <div className="panel-strip">
        <button
          type="button"
          className="tool-button panel-toggle"
          aria-label={collapsed ? "Show details panel" : "Hide details panel"}
          aria-expanded={!collapsed}
          aria-controls="capture-panel-body"
          onClick={toggleCollapsed}
        >
          <CanvasIcon name={collapsed ? "panel-show" : "panel-hide"} />
        </button>
        {/* While collapsed, the selected mark shows as its number on the
            strip instead of forcing the panel open (D112). */}
        {collapsed && selectedPin ? (
          <span
            className="panel-strip-badge"
            data-testid="panel-strip-badge"
            data-status={selectedPin.status}
            role="status"
            aria-label={`${markTitle(selectedPin)} selected`}
          >
            {selectedPin.number}
          </span>
        ) : null}
      </div>
      <div className="panel-body" id="capture-panel-body" hidden={collapsed}>
        <div className="panel-heading">
          <h4>
            {ready ? "Pins" : "Capture"}
            {ready && pins.length > 0 ? <span className="panel-count">{pins.length}</span> : null}
          </h4>
          {/* The plain way out of a selection (D116); Escape does the same. */}
          {selectedPin ? (
            <button
              type="button"
              className="tool-button panel-clear"
              aria-label="Clear selection"
              aria-keyshortcuts="Escape"
              onClick={() => onSelectPin(null)}
            >
              <CanvasIcon name="close" size={16} />
            </button>
          ) : null}
        </div>
        {moveError ? (
          <p role="alert" className="capture-error">
            {moveError}
          </p>
        ) : null}

        {ready ? (
          <>
            {pinsStatus === "loading" ? <p className="panel-note">Loading pins…</p> : null}
            {pinsStatus === "failed" ? (
              <p className="panel-note">
                Pins could not be loaded. Switch to another capture and back to retry.
              </p>
            ) : null}
            {pinsStatus === "ready" && pins.length === 0 ? (
              <p className="panel-note">No pins yet. Click or tap the page to drop the first one.</p>
            ) : null}
            {/* One accordion (D128): every mark is a row, and the selected
                one opens in place, so the list never moves out from under
                the pointer and nothing is shown twice. */}
            {openPins.length > 0 ? (
              <ol className="pin-list pin-accordion" aria-label="Saved pins">
                {openPins.map(row)}
              </ol>
            ) : null}
            {pinsStatus === "ready" && pins.length > 0 && openPins.length === 0 ? (
              <p className="panel-note">Every pin here is resolved.</p>
            ) : null}
            {/* Resolved marks sink into one closed group (D128): the open
                ones are the work. It opens on its own when the selected
                mark is resolved. */}
            {resolvedPins.length > 0 ? (
              <details
                className="pin-resolved"
                data-testid="pin-resolved"
                open={resolvedOpen}
                onToggle={(event) => setResolvedOpen(event.currentTarget.open)}
              >
                <summary>{resolvedPins.length} resolved</summary>
                <ol className="pin-list pin-accordion" aria-label="Resolved pins">
                  {resolvedPins.map(row)}
                </ol>
              </details>
            ) : null}
          </>
        ) : null}

        {/* The internals (D078), one click away and closed by default: the
            page and device, where the selected mark sits in screenshot
            pixels, the capture's version, state, size, and image hash, and
            the keyboard shortcuts. A native <details> so the browser
            supplies the toggle and its announcement. */}
        <details className="panel-details" data-testid="panel-details">
          <summary>Details</summary>
          <dl className="panel-facts">
            <dt>Page</dt>
            <dd className="panel-url">{pageUrl}</dd>
            <dt>Device</dt>
            <dd>{variantLabel(variant)}</dd>
            {selectedPin ? (
              <>
                <dt>{MARK_DETAIL_LABELS[selectedPin.kind]}</dt>
                <dd data-testid="panel-position" data-kind={selectedPin.kind}>
                  {markPosition(selectedPin)} px
                </dd>
              </>
            ) : null}
            <dt>Version</dt>
            <dd>{attempt ? `v${attempt.attempt}` : "—"}</dd>
            <dt>State</dt>
            <dd>{attempt ? STATE_LABELS[attempt.state] : "Not captured"}</dd>
            {attempt?.state === "ready" &&
            attempt.documentWidth !== null &&
            attempt.documentHeight !== null ? (
              <>
                <dt>Screenshot size</dt>
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
          <p className="panel-facts-label">Keyboard</p>
          <ul className="panel-keys" data-testid="panel-keys">
            <li>Enter saves a comment; Shift+Enter starts a new line</li>
            <li>Escape cancels, then lets go of the selected mark</li>
            <li>J and K, or the arrow keys, step through the marks</li>
            <li>N drops a pin at the center of the view</li>
            <li>B, C, or A arms the box, circle, or arrow tool for the next drag</li>
            <li>Shift-drag also draws a box</li>
          </ul>
        </details>
      </div>
    </aside>
  );
}
