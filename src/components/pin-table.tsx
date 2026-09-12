"use client";

// The full pin list for the active capture, below the canvas (D071).
//
// The side panel answers "what is this one pin?"; it can only ever show one
// at a time, which makes it useless for the thing this list exists for —
// handing every note on a page to an agentic IDE in one paste. So the table
// shows the number, the captured position, the element context, and the
// comment for every pin at once, and "Copy all as Markdown" puts the same
// content on the clipboard in a form an agent can act on.
//
// Selecting a row selects the pin everywhere else: the canvas badge and the
// side panel follow, so the table is a second route to the same state, never
// a second copy of it.

import { useEffect, useState } from "react";
import type { PinAnnotationView } from "../lib/annotations";
import {
  formatPinsAsMarkdown,
  pinPosition,
  snapshotPath,
  snapshotSummary,
  type PinExportContext,
} from "../lib/pin-export";

type CopyState = "idle" | "copied" | "failed";

export function PinTable({
  pins,
  status,
  context,
  selectedPinId,
  onSelectPin,
}: {
  pins: readonly PinAnnotationView[];
  status: "loading" | "ready" | "failed" | null;
  context: PinExportContext;
  selectedPinId: string | null;
  onSelectPin: (annotationId: string | null) => void;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  // The confirmation is transient, and it must not outlive the thing it
  // describes: switching captures or editing a pin changes what "copied"
  // would even mean, so the state resets whenever the content does.
  useEffect(() => {
    setCopyState("idle");
  }, [pins, context.pageUrl, context.variant, context.attempt]);

  async function copyAll() {
    const markdown = formatPinsAsMarkdown(pins, context);
    try {
      // Older and non-secure contexts have no clipboard API at all; say so
      // rather than silently doing nothing, since the text is still
      // selectable in the table.
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(markdown);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className="pin-table" aria-labelledby="pin-table-heading">
      <div className="pin-table-head">
        <h4 id="pin-table-heading">All pins on this capture</h4>
        <p className="pin-table-actions">
          <button type="button" onClick={() => void copyAll()} disabled={pins.length === 0}>
            Copy all as Markdown
          </button>
          <span role="status" className="pin-table-status">
            {copyState === "copied" ? `Copied ${pins.length} pins as Markdown.` : null}
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
      {status === "ready" && pins.length === 0 ? (
        <p className="panel-note">
          No pins yet. Click or tap the page to drop the first one.
        </p>
      ) : null}

      {pins.length > 0 ? (
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">
              Every pin on this capture, with its position, element context, and comment.
            </caption>
            <thead>
              <tr>
                <th scope="col">Pin</th>
                <th scope="col">Position</th>
                <th scope="col">Element</th>
                <th scope="col">Comment</th>
              </tr>
            </thead>
            <tbody>
              {pins.map((pin) => {
                const path = snapshotPath(pin.elementSnapshot);
                return (
                  <tr
                    key={pin.id}
                    data-selected={pin.id === selectedPinId ? "true" : undefined}
                  >
                    <th scope="row">
                      <button
                        type="button"
                        aria-current={pin.id === selectedPinId ? "true" : undefined}
                        onClick={() => onSelectPin(pin.id === selectedPinId ? null : pin.id)}
                      >
                        Pin {pin.number}
                      </button>
                    </th>
                    <td className="pin-table-position">{pinPosition(pin)}</td>
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
