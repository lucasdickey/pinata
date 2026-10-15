// The landing's demo video (D140): the real product, filmed screen by screen
// (scripts/demo/film.mjs) and played back here with a cursor, typing, a
// drawn circle, and a camera that leans in on what matters. The script is
// timeline.ts; the screens and where their buttons sit are shots.json; how
// it all fits together, and how to update one part, is README.md.
//
// It plays in the browser through @remotion/player (src/components/
// demo-video.tsx), in the page's own fonts and colors; `theme` picks the
// light or dark filming of each screen to match the page.

import type { CSSProperties } from "react";
import { AbsoluteFill, Easing, Img, interpolate, useCurrentFrame } from "remotion";
import { BRAND_MARK } from "../../src/lib/brand-mark";
import { getShot, SHOT_TEXT, shotSrc, type Shot, type ShotField, type ShotMark, type Theme } from "./shots";
import {
  beatAt,
  briefExcerpt,
  cameraAt,
  cameraTransform,
  CHAPTERS,
  chapterAt,
  cursorAt,
  HEIGHT,
  TIMELINE,
  WIDTH,
  type TimedBeat,
} from "./timeline";

export { DURATION as DEMO_FRAMES, FPS as DEMO_FPS, HEIGHT as DEMO_HEIGHT, WIDTH as DEMO_WIDTH } from "./timeline";

// A type, not an interface: Remotion wants props it can treat as a record.
export type PinataDemoProps = {
  theme: Theme;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);

/** The page's tokens, with the theme's values for anywhere they are not defined. */
const TOKENS: Record<Theme, Record<string, string>> = {
  light: { bg: "#fcfcf9", surface: "#ffffff", ink: "#141414", soft: "#666666", line: "#cfcec8", accent: "#c9381a" },
  dark: { bg: "#181818", surface: "#1f1f1e", ink: "#efefe4", soft: "#a8a8a2", line: "#464641", accent: "#ff6b47" },
};

function token(theme: Theme, name: keyof (typeof TOKENS)["light"]): string {
  const css = { bg: "--bg", surface: "--surface", ink: "--ink", soft: "--ink-soft", line: "--line-strong", accent: "--accent" }[name];
  return `var(${css}, ${TOKENS[theme][name]})`;
}

/** One filmed screen, laid at the shot's own pixel size. */
function ShotLayer({ shot, theme, opacity, offsetY }: { shot: Shot; theme: Theme; opacity: number; offsetY: number }) {
  return (
    <Img
      src={shotSrc(shot, theme)}
      alt=""
      pauseWhenLoading
      style={{
        position: "absolute",
        left: 0,
        top: offsetY,
        width: WIDTH,
        height: HEIGHT,
        opacity,
      }}
    />
  );
}

/** The screens to show at a frame: this beat's, over the last beat's while it gives way. */
function layersAt(frame: number, beat: TimedBeat): { shot: Shot; opacity: number; offsetY: number }[] {
  const shot = getShot(beat.shot);
  const previous = TIMELINE[beat.index - 1];
  const local = frame - beat.start;
  if (!previous || previous.shot === beat.shot || previous.end) {
    return [{ shot, opacity: 1, offsetY: 0 }];
  }
  const kind = beat.enter?.kind ?? "cut";
  // After typing, cut at once: the typed text was drawn over the last shot,
  // and fading would let its empty field show through.
  const frames = previous.type ? 0 : (beat.enter?.frames ?? 3);
  if (local >= frames) return [{ shot, opacity: 1, offsetY: 0 }];
  const before = getShot(previous.shot);
  const t = interpolate(local, [0, frames], [0, 1], { ...clamp, easing: ease });
  if (kind === "scroll") {
    // The page moves up: the old screen leaves by the distance scrolled and
    // the new one, which starts at that scroll, rises into its place.
    const distance = (shot.scrollY ?? 0) - (before.scrollY ?? 0);
    return [
      { shot: before, opacity: 1, offsetY: -distance * t },
      { shot, opacity: 1, offsetY: distance * (1 - t) },
    ];
  }
  return [
    { shot: before, opacity: 1, offsetY: 0 },
    { shot, opacity: t, offsetY: 0 },
  ];
}

/** Text typed into a field, set where the field sets it, with a caret. */
function Typing({
  field,
  frame,
  start,
  perFrame,
  theme,
}: {
  field: ShotField;
  frame: number;
  start: number;
  perFrame: number;
  theme: Theme;
}) {
  const text = field.text ?? "";
  const { color, background } = field.colors[theme] ?? field.colors.light ?? Object.values(field.colors)[0]!;
  const shown = text.slice(0, Math.max(0, Math.floor((frame - start) * perFrame)));
  const { rect, padding, font } = field;
  const caretOn = Math.floor(frame / 8) % 2 === 0 || shown.length < text.length;
  const box: CSSProperties = {
    position: "absolute",
    left: rect.x + padding.left,
    top: rect.y + padding.top,
    width: rect.width - padding.left - padding.right,
    height: rect.height - padding.top - padding.bottom,
    background,
    color,
    fontFamily: font.family,
    fontSize: font.size,
    fontWeight: font.weight as CSSProperties["fontWeight"],
    lineHeight: `${font.lineHeight}px`,
    letterSpacing: font.letterSpacing,
    whiteSpace: field.multiline ? "pre-wrap" : "pre",
    overflowWrap: "break-word",
    overflow: "hidden",
    display: field.multiline ? "block" : "flex",
    alignItems: "center",
  };
  return (
    <div style={box}>
      <span>
        {shown}
        <span
          style={{
            display: "inline-block",
            width: 1.5,
            height: font.size * 1.15,
            marginLeft: 1,
            verticalAlign: "text-bottom",
            background: color,
            opacity: caretOn ? 1 : 0,
          }}
        />
      </span>
    </div>
  );
}

/** A mark being drawn as the cursor drags: dashed, as the canvas draws a draft. */
function Drawing({ mark, progress, theme }: { mark: ShotMark; progress: number; theme: Theme }) {
  if (progress <= 0) return null;
  const stroke = {
    fill: "none",
    stroke: token(theme, "accent"),
    strokeWidth: 2,
    strokeDasharray: "6 4",
    strokeLinecap: "round" as const,
  };
  let shape = null;
  if (mark.kind === "circle" || mark.kind === "rectangle") {
    const width = mark.rect.width * progress;
    const height = mark.rect.height * progress;
    shape =
      mark.kind === "circle" ? (
        <ellipse {...stroke} cx={mark.rect.x + width / 2} cy={mark.rect.y + height / 2} rx={width / 2} ry={height / 2} />
      ) : (
        <rect {...stroke} x={mark.rect.x} y={mark.rect.y} width={width} height={height} />
      );
  } else if (mark.kind === "arrow") {
    shape = (
      <line
        {...stroke}
        x1={mark.start.x}
        y1={mark.start.y}
        x2={mark.start.x + (mark.end.x - mark.start.x) * progress}
        y2={mark.start.y + (mark.end.y - mark.start.y) * progress}
      />
    );
  }
  return (
    <svg width={WIDTH} height={HEIGHT} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      {shape}
    </svg>
  );
}

/** The pointer: an arrow, or a crosshair while a tool draws; pressed, it shrinks and ripples. */
function Cursor({ frame, crosshair }: { frame: number; crosshair: boolean }) {
  const { x, y, down, pressedAt } = cursorAt(frame);
  const since = pressedAt === null ? Infinity : frame - pressedAt;
  const ripple = since < 14 ? interpolate(since, [0, 14], [0, 1], clamp) : null;
  return (
    <>
      {ripple !== null && !crosshair ? (
        <div
          style={{
            position: "absolute",
            left: x - 22,
            top: y - 22,
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: "2px solid rgba(20, 20, 20, 0.45)",
            transform: `scale(${0.4 + ripple * 0.8})`,
            opacity: 1 - ripple,
          }}
        />
      ) : null}
      {crosshair ? (
        <svg width={28} height={28} viewBox="0 0 28 28" style={{ position: "absolute", left: x - 14, top: y - 14 }}>
          <path d="M14 2v24M2 14h24" stroke="#fff" strokeWidth={4} strokeLinecap="round" />
          <path d="M14 2v24M2 14h24" stroke="#141414" strokeWidth={1.6} strokeLinecap="round" />
        </svg>
      ) : (
        <svg
          width={26}
          height={26}
          viewBox="0 0 24 24"
          style={{
            position: "absolute",
            left: x - 4,
            top: y - 3,
            transform: `scale(${down ? 0.86 : 1})`,
            transformOrigin: "4px 3px",
            filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.3))",
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
      )}
    </>
  );
}

/** How long a chapter's title stays up once the chapter starts. */
const CAPTION_FRAMES = 80;

/**
 * The chapter's title, up for a moment as the chapter starts and then out of
 * the way; the chapter buttons under the player keep the place after that.
 */
function Caption({ frame, theme }: { frame: number; theme: Theme }) {
  const id = chapterAt(frame);
  const index = CHAPTERS.findIndex((chapter) => chapter.id === id);
  const start = TIMELINE.find((beat) => beat.chapter === id)!.start;
  const since = frame - start;
  if (since > CAPTION_FRAMES) return null;
  const appear = interpolate(since, [0, 10, CAPTION_FRAMES - 12, CAPTION_FRAMES], [0, 1, 1, 0], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: 28,
        top: 24,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 22px 12px 14px",
        borderRadius: 999,
        background: token(theme, "ink"),
        color: token(theme, "bg"),
        fontFamily: "var(--font-sans, Inter, system-ui, sans-serif)",
        fontSize: 26,
        fontWeight: 500,
        letterSpacing: "-0.01em",
        boxShadow: "0 10px 30px -12px rgba(0,0,0,0.45)",
        opacity: appear,
        transform: `translateY(${(1 - appear) * -8}px)`,
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 36,
          height: 36,
          borderRadius: "50%",
          // As the canvas sets a badge's number: --surface on --accent.
          background: token(theme, "accent"),
          color: token(theme, "surface"),
          fontSize: 20,
          fontWeight: 600,
        }}
      >
        {index + 1}
      </span>
      {CHAPTERS[index]!.title}
    </div>
  );
}

/** A key press, shown as a key cap while the note saves. */
function KeyCap({ label, since, theme }: { label: string; since: number; theme: Theme }) {
  if (since < 0 || since > 18) return null;
  const opacity = interpolate(since, [0, 3, 14, 18], [0, 1, 1, 0], clamp);
  const press = since >= 3 && since < 8 ? 0.94 : 1;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 34,
        transform: `translateX(-50%) scale(${press})`,
        padding: "10px 22px",
        borderRadius: 10,
        border: `2px solid ${token(theme, "line")}`,
        borderBottomWidth: 5,
        background: token(theme, "surface"),
        color: token(theme, "ink"),
        fontFamily: "var(--font-sans, Inter, system-ui, sans-serif)",
        fontSize: 26,
        fontWeight: 550,
        opacity,
      }}
    >
      {label} ↵
    </div>
  );
}

/**
 * What the coding agent does with the link: the prompt Pinata wrote, pasted,
 * then the brief the link returns, as the agent reads it. The words are the
 * product's own, kept when the scene was filmed; the terminal around them is
 * only a frame.
 */
function Terminal({ since, theme }: { since: number; theme: Theme }) {
  if (since < 0) return null;
  const enter = interpolate(since, [0, 12], [0, 1], { ...clamp, easing: ease });
  const text = SHOT_TEXT[theme] ?? SHOT_TEXT.light ?? SHOT_TEXT.dark ?? {};
  const prompt = text.prompt ?? "";
  const lines = briefExcerpt(text.brief ?? "").slice(0, 20);
  const reading = since >= 30;
  const shownLines = Math.max(0, Math.floor((since - 38) / 2.2));
  const mono = "var(--font-mono, ui-monospace, Menlo, monospace)";
  return (
    <div
      style={{
        position: "absolute",
        left: 150,
        right: 150,
        top: 56,
        bottom: 56,
        borderRadius: 18,
        overflow: "hidden",
        background: "#1f1f1e",
        color: "#efefe4",
        boxShadow: "0 40px 90px -30px rgba(0,0,0,0.7)",
        opacity: enter,
        transform: `translateY(${(1 - enter) * 40}px)`,
        fontFamily: mono,
        fontSize: 18,
        lineHeight: 1.45,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "14px 20px",
          borderBottom: "1px solid #2e2e2b",
          color: "#a8a8a2",
          fontFamily: "var(--font-sans, Inter, system-ui, sans-serif)",
          fontSize: 18,
        }}
      >
        {["#464641", "#464641", "#464641"].map((fill, i) => (
          <span key={i} style={{ width: 12, height: 12, borderRadius: "50%", background: fill }} />
        ))}
        <span style={{ marginLeft: 10 }}>Your coding agent</span>
      </div>
      <div style={{ padding: "22px 28px" }}>
        <div style={{ display: "flex", gap: 12 }}>
          <span style={{ color: "#ff6b47" }}>›</span>
          <span style={{ opacity: since >= 10 ? 1 : 0, color: "#efefe4" }}>{prompt}</span>
        </div>
        {reading ? (
          <div style={{ marginTop: 18, color: "#a8a8a2" }}>
            Reading {prompt.match(/https:\/\/\S+/)?.[0]?.replace(/(\/a\/.{6}).*/, "$1…") ?? "the brief"}
          </div>
        ) : null}
        <div style={{ marginTop: 10, borderLeft: "2px solid #464641", paddingLeft: 18 }}>
          {lines.slice(0, shownLines).map((line, i) => (
            <div
              key={i}
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: line.startsWith("#") ? "#efefe4" : "#a8a8a2",
                fontWeight: line.startsWith("#") ? 600 : 400,
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The close: the mark, the name, the promise. */
function EndCard({ since, frames, theme }: { since: number; frames: number; theme: Theme }) {
  const opacity = interpolate(since, [0, 12, frames - 14, frames], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill
      style={{
        background: token(theme, "bg"),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 26,
        opacity,
        fontFamily: "var(--font-sans, Inter, system-ui, sans-serif)",
      }}
    >
      <svg viewBox={BRAND_MARK.viewBox} width={132} height={132} aria-hidden="true">
        <rect width="64" height="64" rx={BRAND_MARK.tileRadius} fill={BRAND_MARK.tileFill} />
        <path d={BRAND_MARK.bodyPath} fill={BRAND_MARK.bodyFill} fillRule={BRAND_MARK.fillRule} />
        <path d={BRAND_MARK.inkPath} fill={BRAND_MARK.inkFill} fillRule={BRAND_MARK.fillRule} />
      </svg>
      <div style={{ textAlign: "center", fontSize: 64, fontWeight: 360, letterSpacing: "-0.025em", lineHeight: 1.08 }}>
        <div style={{ color: token(theme, "ink") }}>Pinata</div>
        <div style={{ color: token(theme, "soft") }}>Feedback pinned to the exact pixel,</div>
        <div style={{ color: token(theme, "soft") }}>sent in one link</div>
      </div>
    </AbsoluteFill>
  );
}

export function PinataDemo({ theme }: PinataDemoProps) {
  const frame = useCurrentFrame();
  const beat = beatAt(frame);
  const local = frame - beat.start;
  const shot = getShot(beat.shot);
  const camera = cameraAt(frame);
  const terminalSince = beat.terminal ? local - beat.terminal.at : -1;
  const drawing = beat.draw;
  const drawProgress = drawing ? interpolate(local, [drawing.at, drawing.at + drawing.frames], [0, 1], clamp) : 0;
  const crosshair = Boolean(drawing && local >= drawing.at - 3 && local <= drawing.at + drawing.frames);
  const field = beat.type ? shot.fields[beat.type.field] : undefined;
  const showCursor = !beat.end && terminalSince < 6;

  return (
    <AbsoluteFill style={{ background: token(theme, "bg"), overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: WIDTH,
          height: HEIGHT,
          transformOrigin: "0 0",
          transform: cameraTransform(camera),
        }}
      >
        {layersAt(frame, beat).map((layer, i) => (
          <ShotLayer key={`${i}-${layer.shot.files.light}`} theme={theme} {...layer} />
        ))}
        {field && beat.type && local >= beat.type.at ? (
          <Typing
            field={field}
            frame={frame}
            start={beat.start + beat.type.at}
            perFrame={beat.type.perFrame ?? 1.6}
            theme={theme}
          />
        ) : null}
        {drawing && shot.marks?.[drawing.mark] ? (
          <Drawing mark={shot.marks[drawing.mark]!} progress={drawProgress} theme={theme} />
        ) : null}
        {showCursor ? <Cursor frame={frame} crosshair={crosshair} /> : null}
      </div>
      {beat.terminal ? (
        <>
          <AbsoluteFill
            style={{ background: "rgba(10, 10, 10, 0.5)", opacity: interpolate(terminalSince, [0, 12], [0, 1], clamp) }}
          />
          <Terminal since={terminalSince} theme={theme} />
        </>
      ) : null}
      {beat.key ? <KeyCap label={beat.key.label} since={local - beat.key.at} theme={theme} /> : null}
      {!beat.end ? <Caption frame={frame} theme={theme} /> : null}
      {beat.end ? <EndCard since={local} frames={beat.frames} theme={theme} /> : null}
    </AbsoluteFill>
  );
}
