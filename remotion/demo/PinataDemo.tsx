// The landing's demo video (D127): the experience in about eighteen seconds,
// on the same example page and with the same four marks the landing's table
// lists. A cursor picks each tool, places a pin, a circle, an arrow, and a
// box, and types each comment; then the share link appears and the founder's
// reply lands on pin 1. It loops.
//
// It plays in the browser through @remotion/player (src/components/
// example-demo.tsx), so it paints with the page's own CSS: the example page's
// classes and the color tokens, which follow light and dark. Everything
// comes from src/lib/example-capture.ts, so the video and the table below it
// can never disagree.

import type { ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import {
  EXAMPLE_CAPTURE,
  EXAMPLE_CAPTURE_FRAME,
  type ExampleMark,
} from "../../src/lib/example-capture";
import { ExamplePage, badgePoint } from "../../src/components/example-capture";

export const DEMO_FPS = 30;
export const DEMO_WIDTH = EXAMPLE_CAPTURE_FRAME.width;
export const DEMO_HEIGHT = EXAMPLE_CAPTURE_FRAME.height;

/** Frames per mark: move there, place it, type its comment. */
const SEGMENT = 95;
const START = 25;
const MOVE = 22;
const PLACE = 24;
const MARKS = EXAMPLE_CAPTURE.marks;
const SHARE_AT = START + MARKS.length * SEGMENT;
const REPLY_AT = SHARE_AT + 50;
const FADE_AT = REPLY_AT + 75;
export const DEMO_FRAMES = FADE_AT + 30;

const TOOL_LABEL: Record<ExampleMark["kind"], string> = {
  pin: "Pin",
  rectangle: "Box",
  circle: "Circle",
  arrow: "Arrow",
};
const TOOLS: ExampleMark["kind"][] = ["pin", "rectangle", "circle", "arrow"];
// A vertical strip in the page's empty left margin, clear of every card.
const TOOLBAR = { x: 18, y: 300, width: 118, step: 74 };

/** Where the cursor presses, and where a drag ends. */
function strokeEnds(mark: ExampleMark): {
  from: { x: number; y: number };
  to: { x: number; y: number };
} {
  switch (mark.kind) {
    case "pin":
      return { from: mark.tip, to: mark.tip };
    case "rectangle":
      return {
        from: { x: mark.rect.x, y: mark.rect.y },
        to: {
          x: mark.rect.x + mark.rect.width,
          y: mark.rect.y + mark.rect.height,
        },
      };
    case "circle":
      return {
        from: { x: mark.circle.x, y: mark.circle.y },
        to: {
          x: mark.circle.x + mark.circle.size,
          y: mark.circle.y + mark.circle.size,
        },
      };
    case "arrow":
      return { from: mark.arrow.start, to: mark.arrow.end };
  }
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);

/** Where the toolbar button for a tool sits, for the cursor to visit. */
function toolPoint(kind: ExampleMark["kind"]): { x: number; y: number } {
  const index = TOOLS.indexOf(kind);
  return {
    x: TOOLBAR.x + TOOLBAR.width / 2,
    y: TOOLBAR.y + 46 + index * TOOLBAR.step,
  };
}

/** The cursor's position at a frame, along tool → press → release for each mark. */
function cursorAt(frame: number): { x: number; y: number; down: boolean } {
  const rest = { x: 1340, y: 160 };
  let last = rest;
  for (let i = 0; i < MARKS.length; i += 1) {
    const mark = MARKS[i]!;
    const s = START + i * SEGMENT;
    const tool = toolPoint(mark.kind);
    const { from, to } = strokeEnds(mark);
    if (frame < s) return { ...last, down: false };
    if (frame < s + MOVE / 2) {
      const t = interpolate(frame, [s, s + MOVE / 2], [0, 1], {
        ...clamp,
        easing: ease,
      });
      return {
        x: last.x + (tool.x - last.x) * t,
        y: last.y + (tool.y - last.y) * t,
        down: false,
      };
    }
    if (frame < s + MOVE) {
      const t = interpolate(frame, [s + MOVE / 2, s + MOVE], [0, 1], {
        ...clamp,
        easing: ease,
      });
      return {
        x: tool.x + (from.x - tool.x) * t,
        y: tool.y + (from.y - tool.y) * t,
        down: false,
      };
    }
    if (frame < s + MOVE + PLACE) {
      const t = interpolate(frame, [s + MOVE, s + MOVE + PLACE], [0, 1], {
        ...clamp,
        easing: ease,
      });
      return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        down: true,
      };
    }
    last = to;
  }
  if (frame < SHARE_AT + 20) {
    const t = interpolate(frame, [SHARE_AT, SHARE_AT + 20], [0, 1], {
      ...clamp,
      easing: ease,
    });
    return {
      x: last.x + (1260 - last.x) * t,
      y: last.y + (60 - last.y) * t,
      down: false,
    };
  }
  return {
    x: 1260,
    y: 60,
    down: frame >= SHARE_AT + 20 && frame < SHARE_AT + 26,
  };
}

/** 0 → 1 as a mark is placed; 1 once it is down. */
function placed(frame: number, index: number): number {
  const s = START + index * SEGMENT + MOVE;
  return interpolate(frame, [s, s + PLACE], [0, 1], { ...clamp, easing: ease });
}

function MarkStroke({
  mark,
  progress,
}: {
  mark: ExampleMark;
  progress: number;
}) {
  if (progress <= 0) return null;
  const common = {
    fill: "none",
    stroke: "var(--accent)",
    strokeWidth: 4,
    strokeLinecap: "round" as const,
  };
  switch (mark.kind) {
    case "rectangle":
      return (
        <rect
          {...common}
          x={mark.rect.x}
          y={mark.rect.y}
          width={mark.rect.width * progress}
          height={mark.rect.height * progress}
          rx={6}
        />
      );
    case "circle": {
      const r = (mark.circle.size / 2) * progress;
      return (
        <ellipse
          {...common}
          cx={mark.circle.x + r}
          cy={mark.circle.y + r}
          rx={r}
          ry={r}
        />
      );
    }
    case "arrow": {
      const end = {
        x:
          mark.arrow.start.x +
          (mark.arrow.end.x - mark.arrow.start.x) * progress,
        y:
          mark.arrow.start.y +
          (mark.arrow.end.y - mark.arrow.start.y) * progress,
      };
      return (
        <line
          {...common}
          x1={mark.arrow.start.x}
          y1={mark.arrow.start.y}
          x2={end.x}
          y2={end.y}
          markerEnd={progress >= 1 ? "url(#demo-arrow-head)" : undefined}
        />
      );
    }
    default:
      return null;
  }
}

/** The numbered badge, a teardrop for a pin and a tag for the rest. */
function Badge({ mark, scale }: { mark: ExampleMark; scale: number }) {
  if (scale <= 0) return null;
  const at = badgePoint(mark);
  const size = 40;
  return (
    <g transform={`translate(${at.x} ${at.y}) scale(${scale})`}>
      {mark.kind === "pin" ? (
        <g transform={`translate(${-size / 2} ${-size})`}>
          <path
            d="M12 24 C7.6 17.6 4 14.2 4 9 a8 8 0 1 1 16 0 C20 14.2 16.4 17.6 12 24 Z"
            transform={`scale(${size / 24})`}
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth={0.8}
          />
          <text
            x={size / 2}
            y={size * 0.42}
            textAnchor="middle"
            fontSize={15}
            fontWeight={800}
            fill="var(--surface)"
          >
            {mark.number}
          </text>
        </g>
      ) : (
        <g transform="translate(-4 -4)">
          <rect width={28} height={28} rx={7} fill="var(--accent)" />
          <text
            x={14}
            y={19.5}
            textAnchor="middle"
            fontSize={15}
            fontWeight={800}
            fill="var(--surface)"
          >
            {mark.number}
          </text>
        </g>
      )}
    </g>
  );
}

/** Where a comment card hangs: past the mark's far edge, not over it. */
function cardAnchor(mark: ExampleMark): { x: number; y: number; left: number } {
  switch (mark.kind) {
    case "pin":
      return { x: mark.tip.x, y: mark.tip.y - 30, left: mark.tip.x };
    case "rectangle":
      return {
        x: mark.rect.x + mark.rect.width,
        y: mark.rect.y,
        left: mark.rect.x,
      };
    case "circle":
      return {
        x: mark.circle.x + mark.circle.size,
        y: mark.circle.y,
        left: mark.circle.x,
      };
    case "arrow":
      return {
        x: Math.max(mark.arrow.start.x, mark.arrow.end.x),
        y: Math.min(mark.arrow.start.y, mark.arrow.end.y),
        left: Math.min(mark.arrow.start.x, mark.arrow.end.x),
      };
  }
}

/** A dark comment card beside the mark, its text typed in. */
function Bubble({
  at,
  children,
  opacity,
}: {
  at: { x: number; y: number; left: number };
  children: ReactNode;
  opacity: number;
}) {
  if (opacity <= 0) return null;
  // To the right of the mark, or to its left when there is no room, so a
  // card never covers the mark it describes.
  const left = at.x + 24 + 450 <= DEMO_WIDTH - 16 ? at.x + 24 : at.left - 474;
  // Kept inside the frame: a card under a low mark rises above it.
  const top = Math.min(Math.max(at.y - 20, 70), DEMO_HEIGHT - 190);
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: 450,
        padding: "14px 18px",
        borderRadius: 12,
        background: "#141414",
        color: "#fcfcf9",
        fontSize: 30,
        lineHeight: 1.4,
        boxShadow: "0 12px 32px -8px rgba(0,0,0,0.45)",
        opacity,
        transform: `translateY(${(1 - opacity) * 8}px)`,
      }}
    >
      {children}
    </div>
  );
}

function typed(text: string, frame: number, start: number): string {
  const chars = Math.max(0, Math.floor((frame - start) * 1.6));
  return text.slice(0, chars);
}

function Cursor({ x, y, down }: { x: number; y: number; down: boolean }) {
  return (
    <svg
      width={34}
      height={34}
      viewBox="0 0 24 24"
      style={{
        position: "absolute",
        left: x - 4,
        top: y - 3,
        transform: `scale(${down ? 0.88 : 1})`,
        transformOrigin: "4px 3px",
        filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))",
      }}
    >
      <path
        d="M4 3 L4 19 L8.5 15 L11.5 21.5 L14 20.4 L11.1 14 L17 14 Z"
        fill="#141414"
        stroke="#fff"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Toolbar({ active }: { active: ExampleMark["kind"] | null }) {
  return (
    <div
      style={{
        position: "absolute",
        left: TOOLBAR.x,
        top: TOOLBAR.y,
        width: TOOLBAR.width,
        padding: "10px 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: TOOLBAR.step - 52,
        borderRadius: 14,
        background: "var(--surface)",
        border: "1px solid var(--line-strong)",
        boxShadow: "0 10px 28px -10px rgba(0,0,0,0.3)",
        fontSize: 26,
        fontWeight: 600,
        color: "var(--ink)",
      }}
    >
      {TOOLS.map((kind) => (
        <span
          key={kind}
          style={{
            width: TOOLBAR.width - 20,
            height: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 10,
            background: active === kind ? "var(--ink)" : "transparent",
            color: active === kind ? "var(--bg)" : "var(--ink)",
          }}
        >
          {TOOL_LABEL[kind]}
        </span>
      ))}
    </div>
  );
}

export function PinataDemo() {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [FADE_AT, FADE_AT + 24], [1, 0], clamp);
  const cursor = cursorAt(frame);
  const segment = Math.floor((frame - START) / SEGMENT);
  const activeTool =
    segment >= 0 &&
    segment < MARKS.length &&
    frame - START - segment * SEGMENT >= MOVE / 2
      ? MARKS[segment]!.kind
      : null;
  const shareIn = interpolate(
    frame,
    [SHARE_AT + 22, SHARE_AT + 36],
    [0, 1],
    clamp,
  );
  const replyIn = interpolate(frame, [REPLY_AT, REPLY_AT + 14], [0, 1], clamp);
  const pinOne = MARKS[0]!;
  const founderReply = pinOne.thread.find(
    (entry) => entry.author === "founder",
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--bg)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <ExamplePage />
      <svg
        viewBox={`0 0 ${DEMO_WIDTH} ${DEMO_HEIGHT}`}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
          opacity: fade,
        }}
      >
        <defs>
          <marker
            id="demo-arrow-head"
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerUnits="userSpaceOnUse"
            markerWidth="26"
            markerHeight="26"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
          </marker>
        </defs>
        {MARKS.map((mark, index) => (
          <MarkStroke
            key={mark.number}
            mark={mark}
            progress={mark.kind === "pin" ? 0 : placed(frame, index)}
          />
        ))}
        {MARKS.map((mark, index) => {
          const s = START + index * SEGMENT + MOVE + PLACE;
          const pop = interpolate(frame, [s - 4, s + 6], [0, 1], {
            ...clamp,
            easing: Easing.out(Easing.back(2)),
          });
          return <Badge key={mark.number} mark={mark} scale={pop} />;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, opacity: fade }}>
        {MARKS.map((mark, index) => {
          const s = START + index * SEGMENT + MOVE + PLACE;
          const shown = interpolate(
            frame,
            [s, s + 8, s + SEGMENT - 8, s + SEGMENT],
            [0, 1, 1, 0],
            clamp,
          );
          return (
            <Bubble key={mark.number} at={cardAnchor(mark)} opacity={shown}>
              <div style={{ fontSize: 22, opacity: 0.7, marginBottom: 4 }}>
                {TOOL_LABEL[mark.kind]} {mark.number}
              </div>
              {typed(mark.body, frame, s + 4)}
            </Bubble>
          );
        })}
        {founderReply ? (
          <Bubble at={cardAnchor(pinOne)} opacity={replyIn}>
            <div style={{ fontSize: 22, opacity: 0.7, marginBottom: 4 }}>
              founder replied
            </div>
            {founderReply.body}
          </Bubble>
        ) : null}
        <div
          style={{
            position: "absolute",
            right: 40,
            top: 24,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 18px",
            borderRadius: 999,
            background: "var(--ink)",
            color: "var(--bg)",
            fontSize: 28,
            fontWeight: 600,
            opacity: shareIn,
            transform: `translateY(${(1 - shareIn) * -10}px)`,
          }}
        >
          Link copied · send it to the founder
        </div>
      </div>
      <Toolbar active={activeTool} />
      <div style={{ opacity: fade }}>
        <Cursor {...cursor} />
      </div>
    </div>
  );
}
