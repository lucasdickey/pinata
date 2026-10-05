// The agent brief (D121): the Markdown an agent reads from the agent link.
//
// It is the project export (D077) reshaped for a reader that has only the
// URL: a short "what to do" section first, then one section per screenshot
// with a direct link to the image, then each mark exactly as the copy
// export writes it (status, position, element, path, the note, its thread).
// Resolved marks are left out — the brief is the work still to do — and the
// header says how many were left out so nothing looks lost.
//
// Pure and free of DOM APIs, like pin-export, so the exact text an agent
// receives is unit-testable.

import type { AnnotationView } from "./annotations";
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
  generatedAt: number;
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
    "1. Download each screenshot from its link (no sign-in needed) and find the mark on it. Positions are in the screenshot's own pixels, measured from its top-left corner.",
    "2. Find the element in the codebase using its text, tag, and path.",
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
    }).split("\n");
    lines.push("");
    // Only heading lines start with "#" (notes are quoted, details are list
    // items), so moving every heading down one level is safe.
    section.forEach((line, index) => {
      lines.push(line.startsWith("#") ? `#${line}` : line);
      // Straight after the "Desktop · version 2 · 3 pins" line.
      if (index === 2) lines.push("", `Screenshot: ${context.screenshotUrl(first.captureId)}`);
    });
  }
  return lines.join("\n");
}
