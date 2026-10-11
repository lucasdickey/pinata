// The agent brief's Markdown (D121): what to do first, one section per
// screenshot with its link and size, resolved marks left out, every open mark
// in the same shape as the copy export, and the elements around each mark
// (D136) so the text alone usually places it.

import { describe, expect, test } from "vitest";
import {
  AGENT_BRIEF_CROP_HINT,
  formatAgentBrief,
  type AgentBriefMark,
} from "../src/lib/agent-brief";
import type { PinElementSnapshot } from "../src/lib/annotations";

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

  test("tells the agent to read the text first and to crop before viewing", () => {
    const text = formatAgentBrief([pin("a", "cap-d", 1, "Tighten this")], context);
    expect(text).toContain("1. Start from the text.");
    expect(text).toContain("2. Open the screenshot only when");
    expect(text).toContain(`crop ${AGENT_BRIEF_CROP_HINT} around the mark's position`);
    expect(text).not.toContain("Download each screenshot");
  });

  test("names each screenshot's size beside its link when it is known", () => {
    const text = formatAgentBrief(
      [pin("a", "cap-d", 1, "A"), pin("b", "cap-m", 1, "B", { variant: "mobile" })],
      {
        ...context,
        screenshotSize: (captureId) =>
          captureId === "cap-d" ? { width: 1440, height: 12_880 } : null,
      },
    );
    expect(text).toContain(
      "Screenshot: https://pinata.example/a/TOKEN/captures/cap-d (1440 × 12880 px, full page)",
    );
    // Unknown size: the plain link, nothing invented.
    expect(text).toContain("Screenshot: https://pinata.example/a/TOKEN/captures/cap-m\n");
  });

  test("lists the elements around a mark, with their positions, after its own", () => {
    const element = (id: string, tag: string, text: string, y: number): PinElementSnapshot => ({
      id,
      kind: "text",
      tag,
      role: "",
      text,
      accessibleName: "",
      hints: { id: "", classes: [], alt: "", title: "", testId: "" },
      path: ["body:0", `${tag}:0`],
      rect: { x: 100.4, y, width: 400, height: 48 },
    });
    const text = formatAgentBrief(
      [
        pin("a", "cap-d", 1, "Make this heading bolder", {
          elementSnapshot: element("h", "h2", "Pricing", 1000),
        }),
        pin("b", "cap-d", 2, "No context here"),
      ],
      {
        ...context,
        nearby: new Map([
          ["a", [element("p", "p", "Three plans", 1060), element("btn", "button", "Start free", 1140)]],
        ]),
      },
    );
    expect(text).toContain(
      "- Element: <h2> “Pricing”\n- Path: `body:0 > h2:0`\n- Bounds: 400 × 48 px natural\n" +
        "- Nearby: <p> “Three plans” at 100, 1060 · 400 × 48 px\n" +
        "- Nearby: <button> “Start free” at 100, 1140 · 400 × 48 px\n\n> Make this heading bolder",
    );
    // A mark with no neighbours carries no Nearby line.
    const second = text.slice(text.indexOf("### Pin 2"));
    expect(second).not.toContain("Nearby:");
  });
});
