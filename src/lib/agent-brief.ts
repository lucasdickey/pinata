// The agent brief (D121): the Markdown an agent reads from the agent link.
//
// It is the project export (D077) reshaped for a reader that has only the
// URL: a short "what to do" section first, then one section per screenshot
// with a direct link to the image and its size, then each mark as the copy
// export writes it (status, position, element, path, the note, its thread)
// plus the elements around it (D136). Resolved marks are left out — the
// brief is the work still to do — and the header says how many were left out
// so nothing looks lost.
//
// The brief is written to cost an agent as few tokens as it can (D136). A
// full-page screenshot is tall, and a vision model shrinks it until nothing
// is readable, so the brief leads with text: the element, its path, and what
// sits around it. It names each screenshot's size so an agent knows before
// downloading that the image needs cropping, and it says how to crop.
//
// Pure and free of DOM APIs, like pin-export, so the exact text an agent
// receives is unit-testable.

import type { AnnotationView, PinElementSnapshot } from "./annotations";
import { markCountLabel } from "./canvas/marks";
import { formatPinsAsMarkdown } from "./pin-export";
import type { ThreadEntryView } from "./threads";

/** A mark plus where its screenshot sits in the project. */
export type AgentBriefMark = AnnotationView & {
  normalizedUrl: string;
  variant: string;
  attempt: number;
  thread: readonly ThreadEntryView[];
};

export interface AgentBriefContext {
  title: string;
  rootUrl: string;
  /** The absolute URL of one screenshot, readable without signing in. */
  screenshotUrl: (captureId: string) => string;
  /**
   * The pixel size of one screenshot, or null when unknown (D136). Printed
   * beside the link so an agent can decide to crop before it downloads.
   */
  screenshotSize?: (captureId: string) => { width: number; height: number } | null;
  /** Elements around each mark, by annotation id, nearest first (D136). */
  nearby?: ReadonlyMap<string, readonly PinElementSnapshot[]>;
  generatedAt: number;
}

/**
 * The crop an agent should take around a mark before looking (D136): about
 * the size of one desktop viewport, which a vision model reads at full
 * detail, where a whole tall page would be shrunk past reading.
 */
export const AGENT_BRIEF_CROP_HINT = "about 1400 × 800 px";

/** The screenshot line: the link, then the size when it is known. */
function screenshotLine(context: AgentBriefContext, captureId: string): string {
  const size = context.screenshotSize?.(captureId) ?? null;
  const url = context.screenshotUrl(captureId);
  if (!size) return `Screenshot: ${url}`;
  return `Screenshot: ${url} (${size.width} × ${size.height} px, full page)`;
}

const VARIANT_LABELS: Record<string, string> = { desktop: "Desktop", mobile: "Mobile" };

function deviceLabel(variant: string): string {
  return VARIANT_LABELS[variant] ?? variant;
}

/** The whole brief. Marks arrive in project order (page, device, version, number). */
export function formatAgentBrief(
  marks: readonly AgentBriefMark[],
  context: AgentBriefContext,
): string {
  const open = marks.filter((mark) => mark.status !== "resolved");
  const resolved = marks.length - open.length;

  // One group per screenshot, in the order the marks already have.
  const groups: AgentBriefMark[][] = [];
  for (const mark of open) {
    const last = groups[groups.length - 1];
    if (last && last[0]?.captureId === mark.captureId) last.push(mark);
    else groups.push([mark]);
  }

  const lines: string[] = [
    `# Pinata brief — ${context.title}`,
    "",
    `- Site: ${context.rootUrl}`,
    `- To do: ${markCountLabel(open)} on ${groups.length} screenshot${groups.length === 1 ? "" : "s"}` +
      (resolved > 0 ? ` (${resolved} resolved left out)` : ""),
    `- Generated: ${new Date(context.generatedAt).toISOString()}`,
    "",
    "## What to do",
    "",
    `This is design feedback on ${context.rootUrl}, left as marks on screenshots in Pinata. Each section below is one screenshot; each mark under it is one note about the page.`,
    "",
    "1. Start from the text. Each mark names its element (tag, role, visible text), the element's path in the page, its size, and the elements nearby with their positions. For most notes that is enough to find the code and make the change without opening the image.",
    `2. Open the screenshot only when the note cannot be understood from the text (a visual judgement, a layout problem, something the note points at but does not name). Each screenshot is a full-page image at the size shown beside its link; a tall one is shrunk past reading when viewed whole, so crop ${AGENT_BRIEF_CROP_HINT} around the mark's position first and view the crop. Positions are in the screenshot's own pixels, measured from its top-left corner.`,
    "3. Make the change the note asks for. When a mark has replies, read them in order: the latest one is the current ask.",
    "4. When you finish, list what you changed for each mark (for example, \"Desktop, pin 2: …\") so it can be checked and resolved in Pinata.",
    "",
    "This link only reads; it cannot change anything in Pinata. Fetch it again for the latest notes — resolved marks drop off.",
  ];

  if (groups.length === 0) {
    lines.push("", "_Nothing to do: there are no open marks in this project._");
    return lines.join("\n");
  }

  const threads = new Map(open.map((mark) => [mark.id, mark.thread] as const));
  for (const group of groups) {
    const first = group[0]!;
    const section = formatPinsAsMarkdown(group, {
      pageUrl: first.normalizedUrl,
      variant: deviceLabel(first.variant),
      attempt: first.attempt,
      heading: `${first.normalizedUrl} — ${deviceLabel(first.variant)}`,
      threads,
      nearby: context.nearby,
    }).split("\n");
    lines.push("");
    // Only heading lines start with "#" (notes are quoted, details are list
    // items), so moving every heading down one level is safe.
    section.forEach((line, index) => {
      lines.push(line.startsWith("#") ? `#${line}` : line);
      // Straight after the "Desktop · version 2 · 3 pins" line.
      if (index === 2) lines.push("", screenshotLine(context, first.captureId));
    });
  }
  return lines.join("\n");
}
