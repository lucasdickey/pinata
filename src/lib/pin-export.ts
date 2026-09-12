// Markdown rendering of a capture's pins (D071), kept pure and free of DOM
// APIs so the exact text that reaches the clipboard is unit-testable.
//
// The output is written to be pasted into an agentic IDE, which is why every
// pin carries its captured DOM context inline: an agent reading the paste
// needs the element path and the on-page position to find the thing being
// talked about, and Pinata's snapshot is the only record of either — the
// capture is a screenshot, and the manifest is never re-derived after the
// pin is saved (VAL-PIN-003, VAL-PIN-008).

import type { PinAnnotationView, PinElementSnapshot } from "./annotations";
import { PIN_STATUS_LABELS } from "./feedback-counts";

export interface PinExportContext {
  pageUrl: string;
  /** Human device label, e.g. "Desktop". */
  variant: string;
  /** Capture attempt number, or null when unknown. */
  attempt: number | null;
}

/** The element path as a single readable trail, or null for "No element". */
export function snapshotPath(element: PinElementSnapshot | null): string | null {
  if (!element) return null;
  const trail = element.path.filter((step) => step.trim() !== "");
  return trail.length > 0 ? trail.join(" > ") : null;
}

/** Short element descriptor: tag, role, and the trimmed visible text. */
export function snapshotSummary(element: PinElementSnapshot | null): string {
  if (!element) return "No element";
  const parts = [`<${element.tag || "element"}>`];
  if (element.role) parts.push(`role=${element.role}`);
  const text = (element.text || element.accessibleName).trim();
  if (text !== "") parts.push(`“${text}”`);
  return parts.join(" ");
}

/** Natural-pixel position of a pin tip, rounded for reading. */
export function pinPosition(pin: PinAnnotationView): string {
  return `${Math.round(pin.tip.x)}, ${Math.round(pin.tip.y)}`;
}

/**
 * The whole capture as one Markdown block. Pin bodies are emitted verbatim
 * inside a blockquote: a comment can contain any character, and quoting is
 * the one Markdown construct that survives arbitrary text without needing
 * the body escaped (which would corrupt the note the agent is meant to act
 * on).
 */
export function formatPinsAsMarkdown(
  pins: readonly PinAnnotationView[],
  context: PinExportContext,
): string {
  const version = context.attempt === null ? "" : ` · version ${context.attempt}`;
  const lines: string[] = [
    `# Pinata pins — ${context.pageUrl}`,
    "",
    `${context.variant}${version} · ${pins.length} pin${pins.length === 1 ? "" : "s"}`,
    "",
  ];

  if (pins.length === 0) {
    lines.push("_No pins on this capture._");
    return lines.join("\n");
  }

  for (const pin of pins) {
    lines.push(`## Pin ${pin.number} — at (${pinPosition(pin)})`);
    lines.push("");
    // The lifecycle status (D075) travels with the note so an agent reading
    // the paste can skip what is already done.
    lines.push(`- Status: ${PIN_STATUS_LABELS[pin.status] ?? pin.status}`);
    lines.push(`- Element: ${snapshotSummary(pin.elementSnapshot)}`);
    const path = snapshotPath(pin.elementSnapshot);
    if (path) lines.push(`- Path: \`${path}\``);
    if (pin.elementSnapshot) {
      const { width, height } = pin.elementSnapshot.rect;
      lines.push(`- Bounds: ${Math.round(width)} × ${Math.round(height)} px natural`);
    }
    lines.push("");
    for (const line of pin.body.split("\n")) lines.push(`> ${line}`);
    lines.push("");
  }

  // One trailing newline, never a run of blank lines at the end.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
