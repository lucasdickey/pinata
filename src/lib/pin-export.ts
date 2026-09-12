// Markdown rendering of a capture's pins (D071), kept pure and free of DOM
// APIs so the exact text that reaches the clipboard is unit-testable.
//
// The output is written to be pasted into an agentic IDE, which is why every
// pin carries its captured DOM context inline: an agent reading the paste
// needs the element path and the on-page position to find the thing being
// talked about, and Pinata's snapshot is the only record of either — the
// capture is a screenshot, and the manifest is never re-derived after the
// pin is saved (VAL-PIN-003, VAL-PIN-008).

import type { AnnotationView, PinElementSnapshot } from "./annotations";
import { markLabel, markPosition, rectanglePosition } from "./canvas/marks";
import { PIN_STATUS_LABELS } from "./feedback-counts";

export interface PinExportContext {
  pageUrl: string;
  /** Human device label, e.g. "Desktop". */
  variant: string;
  /** Capture attempt number, or null when unknown. */
  attempt: number | null;
  /**
   * Replaces the default top heading ("Pinata pins — <page>"). The project
   * export (D077) uses it to head each capture's section with its page and
   * device instead.
   */
  heading?: string;
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

/**
 * Natural-pixel position of a mark, rounded for reading: "x, y" for a pin
 * tip, "x, y · w × h" for a rectangle (D079).
 */
export function pinPosition(pin: AnnotationView): string {
  return markPosition(pin);
}

/**
 * The heading line for one mark: its name (D078), "## Pin 3 · “comment” ·
 * element". The coordinates follow on their own detail line, because the
 * agent reading the paste needs them and the heading is for people.
 */
export function markHeading(annotation: AnnotationView): string {
  return `## ${markLabel(annotation)}`;
}

/** The detail line a pin carries: its tip in natural pixels. */
export function pinPositionLine(annotation: AnnotationView): string | null {
  if (annotation.kind !== "pin") return null;
  return `- Position: ${markPosition(annotation)} px natural`;
}

/** The extra detail line a rectangle carries: its box in natural pixels. */
export function rectangleBoundsLine(annotation: AnnotationView): string | null {
  if (annotation.kind !== "rectangle") return null;
  return `- Box: ${rectanglePosition(annotation.rect)} px natural`;
}

/**
 * The whole capture as one Markdown block. Pin bodies are emitted verbatim
 * inside a blockquote: a comment can contain any character, and quoting is
 * the one Markdown construct that survives arbitrary text without needing
 * the body escaped (which would corrupt the note the agent is meant to act
 * on).
 */
export function formatPinsAsMarkdown(
  pins: readonly AnnotationView[],
  context: PinExportContext,
): string {
  const version = context.attempt === null ? "" : ` · version ${context.attempt}`;
  const lines: string[] = [
    `# ${context.heading ?? `Pinata pins — ${context.pageUrl}`}`,
    "",
    `${context.variant}${version} · ${pins.length} pin${pins.length === 1 ? "" : "s"}`,
    "",
  ];

  if (pins.length === 0) {
    lines.push("_No pins on this capture._");
    return lines.join("\n");
  }

  for (const pin of pins) {
    lines.push(markHeading(pin));
    lines.push("");
    // The lifecycle status (D075) travels with the note so an agent reading
    // the paste can skip what is already done.
    lines.push(`- Status: ${PIN_STATUS_LABELS[pin.status] ?? pin.status}`);
    // Where the mark sits, as data rather than in its name (D078): a pin's
    // tip or a box's corner and size, in the screenshot's own pixels.
    const position = pinPositionLine(pin);
    if (position) lines.push(position);
    const bounds = rectangleBoundsLine(pin);
    if (bounds) lines.push(bounds);
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

// ---- project export (D077) --------------------------------------------------

/** One capture's marks (pins and boxes) with the context its section is headed by. */
export interface PinExportGroup {
  context: PinExportContext;
  pins: readonly AnnotationView[];
}

export interface ProjectExportContext {
  title: string;
  rootUrl: string;
}

/**
 * A whole project as one Markdown block: a project heading, then one section
 * per capture in page/device order (captures with no pins are left out),
 * each rendered by the per-capture format with its headings moved down one
 * level so the document has a single top heading. Pin numbers stay per
 * capture; the section heading names the page and device that make them
 * unambiguous.
 */
export function formatProjectPinsAsMarkdown(
  groups: readonly PinExportGroup[],
  project: ProjectExportContext,
): string {
  const withPins = groups.filter((group) => group.pins.length > 0);
  const total = withPins.reduce((sum, group) => sum + group.pins.length, 0);
  const lines: string[] = [
    `# Pinata pins — ${project.title}`,
    "",
    `${project.rootUrl} · ${withPins.length} capture${withPins.length === 1 ? "" : "s"} · ${total} pin${
      total === 1 ? "" : "s"
    }`,
    "",
  ];
  if (withPins.length === 0) {
    lines.push("_No pins in this project._");
    return lines.join("\n");
  }
  for (const group of withPins) {
    const section = formatPinsAsMarkdown(group.pins, {
      ...group.context,
      heading: group.context.heading ?? `${group.context.pageUrl} — ${group.context.variant}`,
    });
    // Only heading lines start with "#": comment bodies are quoted and the
    // detail lines are list items, so demoting is safe.
    for (const line of section.split("\n")) {
      lines.push(line.startsWith("#") ? `#${line}` : line);
    }
    lines.push("");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
