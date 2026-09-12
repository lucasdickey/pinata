"use client";

// The full pin list below the canvas (D071), now project-scoped (D077).
//
// The side panel answers "what is this one pin?"; it can only ever show one
// at a time, which makes it useless for the thing this list exists for —
// handing every note to an agentic IDE in one paste. So the table shows the
// page, the device, the number, the captured position, the element context,
// and the comment for every pin at once, and "Copy all as Markdown" puts the
// same content on the clipboard in a form an agent can act on.
//
// In the canvas view the same table is filtered to the current capture, with
// a toggle to widen it to the whole project; the overview always shows the
// whole project. Pin numbers are per capture, which is why the Page and
// Device columns are there: they make "Pin 4" unambiguous.
//
// Selecting a row selects the pin everywhere else: the canvas badge and the
// side panel follow, so the table is a second route to the same state, never
// a second copy of it.
//
// Rectangles (D079) are rows too: the first column names the kind ("Box 4")
// and the position column shows the box's corner and size.

import { useEffect, useState } from "react";
import type { AnnotationView } from "../lib/annotations";
import { markTitle } from "../lib/canvas/marks";
import { PIN_STATUS_LABELS } from "../lib/feedback-counts";
import { pinPosition, snapshotPath, snapshotSummary } from "../lib/pin-export";

type CopyState = "idle" | "copied" | "failed";

/** One row: the mark (a pin or a box, D079) and the page and device its capture sits on. */
export interface PinTableRow {
  pin: AnnotationView;
  pageUrl: string;
  /** Human device label, e.g. "Desktop". */
  variant: string;
  /** Capture attempt number, or null when unknown. */
  attempt: number | null;
}

export type PinTableScope = "capture" | "project";

export const PIN_TABLE_SCOPE_LABELS: Record<PinTableScope, string> = {
  capture: "This capture",
  project: "Whole project",
};

export function PinTable({
  rows,
  status,
  heading,
  markdown,
  scope,
  selectedPinId,
  onSelectPin,
}: {
  rows: readonly PinTableRow[];
  status: "loading" | "ready" | "failed" | null;
  /** The visible heading; it names the scope the rows cover. */
  heading: string;
  /** The Markdown "Copy all" writes, rendered when the button is pressed. */
  markdown: () => string;
  /**
   * The scope toggle (D077): "This capture" or "Whole project". Absent in the
   * overview, where only the whole project applies.
   */
  scope?: { value: PinTableScope; onChange: (scope: PinTableScope) => void } | null;
  selectedPinId: string | null;
  onSelectPin: (annotationId: string | null) => void;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  // The confirmation is transient, and it must not outlive the thing it
  // describes: switching captures, scopes, or editing a pin changes what
  // "copied" would even mean, so the state resets whenever the rows do.
  useEffect(() => {
    setCopyState("idle");
  }, [rows, heading]);

  async function copyAll() {
    const text = markdown();
    try {
      // Older and non-secure contexts have no clipboard API at all; say so
      // rather than silently doing nothing, since the text is still
      // selectable in the table.
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  const projectScope = !scope || scope.value === "project";

  return (
    <section className="pin-table" aria-labelledby="pin-table-heading">
      <div className="pin-table-head">
        <h4 id="pin-table-heading">{heading}</h4>
        {scope ? (
          <p className="pin-table-scope" role="group" aria-label="Pins shown">
            {(Object.keys(PIN_TABLE_SCOPE_LABELS) as PinTableScope[]).map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={scope.value === candidate}
                onClick={() => scope.onChange(candidate)}
              >
                {PIN_TABLE_SCOPE_LABELS[candidate]}
              </button>
            ))}
          </p>
        ) : null}
        <p className="pin-table-actions">
          <button type="button" onClick={() => void copyAll()} disabled={rows.length === 0}>
            Copy all as Markdown
          </button>
          <span role="status" className="pin-table-status">
            {copyState === "copied" ? `Copied ${rows.length} pins as Markdown.` : null}
            {copyState === "failed"
              ? "Could not reach the clipboard. Select the table text to copy it."
              : null}
          </span>
        </p>
      </div>

      {status === "loading" ? <p className="panel-note">Loading pins…</p> : null}
      {status === "failed" ? (
        <p className="panel-note">
          Pins could not be loaded. Switch to another capture and back to retry.
        </p>
      ) : null}
      {status === "ready" && rows.length === 0 ? (
        <p className="panel-note">
          {projectScope
            ? "No pins in this project yet."
            : "No pins yet. Click or tap the page to drop the first one."}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">
              Every pin, with its page, device, status, position, element context, and comment.
            </caption>
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Device</th>
                <th scope="col">Pin</th>
                <th scope="col">Status</th>
                <th scope="col">Position</th>
                <th scope="col">Element</th>
                <th scope="col">Comment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pin = row.pin;
                const path = snapshotPath(pin.elementSnapshot);
                return (
                  <tr
                    key={pin.id}
                    data-selected={pin.id === selectedPinId ? "true" : undefined}
                  >
                    <td className="pin-table-page">{row.pageUrl}</td>
                    <td className="pin-table-device">
                      {row.variant}
                      {row.attempt !== null ? ` v${row.attempt}` : ""}
                    </td>
                    <th scope="row">
                      <button
                        type="button"
                        aria-current={pin.id === selectedPinId ? "true" : undefined}
                        onClick={() => onSelectPin(pin.id === selectedPinId ? null : pin.id)}
                      >
                        {markTitle(pin)}
                      </button>
                    </th>
                    <td className="pin-table-status" data-status={pin.status}>
                      {PIN_STATUS_LABELS[pin.status] ?? pin.status}
                      {pin.unreadReplies > 0 ? (
                        <span className="pin-unread"> · {pin.unreadReplies} new</span>
                      ) : null}
                    </td>
                    <td className="pin-table-position" data-kind={pin.kind}>
                      {pinPosition(pin)}
                    </td>
                    <td>
                      <span className="pin-table-element">
                        {snapshotSummary(pin.elementSnapshot)}
                      </span>
                      {path ? <code className="pin-table-path">{path}</code> : null}
                    </td>
                    <td className="pin-table-body">{pin.body}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
