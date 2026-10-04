// The agent brief's Markdown (D121): what to do first, one section per
// screenshot with its link, resolved marks left out, and every open mark in
// the same shape as the copy export.

import { describe, expect, test } from "vitest";
import { formatAgentBrief, type AgentBriefMark } from "../src/lib/agent-brief";

const T0 = 1_800_000_000_000;

function pin(
  id: string,
  captureId: string,
  number: number,
  body: string,
  extra: Partial<AgentBriefMark> = {},
): AgentBriefMark {
  return {
    id,
    captureId,
    kind: "pin",
    number,
    tip: { x: 100 + number, y: 200 },
    body,
    elementSnapshot: null,
    revision: 1,
    status: "open",
    unreadReplies: 0,
    createdAt: T0,
    normalizedUrl: "https://a-ok.ai/",
    variant: "desktop",
    attempt: 2,
    thread: [],
    ...extra,
  } as AgentBriefMark;
}

const context = {
  title: "a-ok.ai",
  rootUrl: "https://a-ok.ai/",
  screenshotUrl: (captureId: string) => `https://pinata.example/a/TOKEN/captures/${captureId}`,
  generatedAt: T0,
};

describe("formatAgentBrief", () => {
  test("lists open marks per screenshot, with the screenshot link and instructions", () => {
    const text = formatAgentBrief(
      [
        pin("a", "cap-d", 1, "Make the headline bigger"),
        pin("b", "cap-d", 2, "Done already", { status: "resolved" }),
        pin("c", "cap-m", 1, "Tighten the nav\nand the footer", { variant: "mobile" }),
      ],
      context,
    );
    expect(text).toMatch(/^# Pinata brief — a-ok.ai\n/);
    expect(text).toContain("- To do: 2 pins on 2 screenshots (1 resolved left out)");
    expect(text).toContain("## What to do");
    expect(text).toContain("## https://a-ok.ai/ — Desktop");
    expect(text).toContain("## https://a-ok.ai/ — Mobile");
    expect(text).toContain("Screenshot: https://pinata.example/a/TOKEN/captures/cap-d");
    expect(text).toContain("Screenshot: https://pinata.example/a/TOKEN/captures/cap-m");
    expect(text).toContain("### Pin 1");
    // The note arrives whole, quoted line by line.
    expect(text).toContain("> Tighten the nav\n> and the footer");
    expect(text).not.toContain("Done already");
    // Exactly one top heading.
    expect(text.split("\n").filter((line) => /^# /.test(line))).toHaveLength(1);
  });

  test("says plainly when nothing is left to do", () => {
    const text = formatAgentBrief([pin("b", "cap-d", 1, "Done", { status: "resolved" })], context);
    expect(text).toContain("_Nothing to do: there are no open marks in this project._");
    expect(text).not.toContain("Screenshot:");
  });

  test("carries each mark's replies", () => {
    const text = formatAgentBrief(
      [
        pin("a", "cap-d", 1, "Swap the photo", {
          status: "replied",
          thread: [
            {
              id: "t1",
              annotationId: "a",
              actorRole: "founder",
              authorLabel: "founder",
              kind: "message",
              body: "Use the blue one instead",
              createdAt: T0 + 1,
            },
          ],
        }),
      ],
      context,
    );
    expect(text).toContain("Use the blue one instead");
    expect(text).toContain("- Status: Replied");
  });
});
