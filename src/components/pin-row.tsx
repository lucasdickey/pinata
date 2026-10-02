// One mark's row in a list, in parts (D113, D117): the number badge as the
// canvas shows it, the comment as the main line, what it points at beneath,
// and its state. Shared by the editor's panel list and the founder's list
// so the two read the same. Clamping is CSS only; nothing here is cut.
// The row's accessible name stays the mark's short name (D078) plus its
// state, which is what assistive tech and the tests address.

import type { AnnotationView } from "../lib/annotations";
import { elementText, markKindLabel, markLabel, markTitle } from "../lib/canvas/marks";
import { PIN_STATUS_LABELS } from "../lib/feedback-counts";

/**
 * Which state a row shows: "notable" (the editor) names only a resolved
 * mark, "always" (the founder, who acts on Open) names every status.
 */
export type PinRowStatus = "notable" | "always";

/** The row's accessible name: the short name, then its state. */
export function pinRowName(pin: AnnotationView, status: PinRowStatus): string {
  let name = markLabel(pin);
  const label = PIN_STATUS_LABELS[pin.status] ?? pin.status;
  if (status === "always") name += ` · ${label}`;
  else if (pin.status === "resolved") name += " · Resolved";
  if (pin.unreadReplies > 0) name += ` · ${pin.unreadReplies} new`;
  return name;
}

/** The number badge a mark carries, as on the canvas. */
export function PinBadge({ pin }: { pin: Pick<AnnotationView, "kind" | "number" | "status"> }) {
  return (
    <span
      className="pin-row-badge"
      data-kind={pin.kind}
      data-status={pin.status}
      aria-hidden="true"
    >
      {pin.number}
    </span>
  );
}

/** The visible parts of a row; the button around it carries the name. */
export function PinRowContent({ pin, status }: { pin: AnnotationView; status: PinRowStatus }) {
  const element = elementText(pin.elementSnapshot);
  const showStatus = status === "always" || pin.status === "resolved";
  return (
    <>
      <PinBadge pin={pin} />
      <span className="pin-row-text" aria-hidden="true">
        <span className="pin-row-comment">
          {pin.body.trim() === "" ? markTitle(pin) : pin.body}
        </span>
        <span className="pin-row-element">
          {pin.kind === "pin" ? "" : `${markKindLabel(pin.kind)} · `}
          {element ?? "No element"}
        </span>
      </span>
      {showStatus || pin.unreadReplies > 0 ? (
        <span className="pin-row-meta" aria-hidden="true">
          {showStatus ? (
            <span className="pin-status">{PIN_STATUS_LABELS[pin.status] ?? pin.status}</span>
          ) : null}
          {pin.unreadReplies > 0 ? (
            <span className="pin-unread">{pin.unreadReplies} new</span>
          ) : null}
        </span>
      ) : null}
    </>
  );
}
