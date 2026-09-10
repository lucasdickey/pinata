// Shared drawing primitives for the walkthrough slides. Everything animates
// from useCurrentFrame() so the same code renders identically in the in-app
// player, Remotion Studio, and a headless render.
import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BRAND_MARK } from "../../src/lib/brand-mark";
import { SLIDES } from "./slides";
import { FONT, MONO, THEME } from "./theme";

export type Tone = "light" | "dark";

const FADE_FRAMES = 12;

/** Page background, fade in/out at the slide boundaries, and the footer. */
export function SlideShell({
  index,
  tone = "light",
  children,
}: {
  index: number;
  tone?: Tone;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, FADE_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - FADE_FRAMES, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const dark = tone === "dark";
  return (
    <AbsoluteFill
      style={{
        background: dark ? THEME.night : THEME.bg,
        color: dark ? THEME.surface : THEME.ink,
        fontFamily: FONT,
        opacity: Math.min(fadeIn, fadeOut),
      }}
    >
      <AbsoluteFill style={{ padding: "84px 96px 120px" }}>{children}</AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 96,
          right: 96,
          bottom: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 24,
          color: dark ? "rgba(255,253,248,0.7)" : THEME.inkSoft,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Mark size={36} />
          <span style={{ fontWeight: 800, color: dark ? THEME.surface : THEME.accent }}>
            pinata
          </span>
          <span>· how it works</span>
        </div>
        <div style={{ fontVariantNumeric: "tabular-nums" }}>
          {String(index + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** The product's own mark, from the one shared source the favicon uses. */
export function Mark({ size = 64, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg viewBox={BRAND_MARK.viewBox} width={size} height={size} style={style} aria-hidden="true">
      <rect width="64" height="64" rx={BRAND_MARK.tileRadius} fill={BRAND_MARK.tileFill} />
      <path d={BRAND_MARK.pinPath} fill={BRAND_MARK.pinFill} />
      <path d={BRAND_MARK.starPath} fill={BRAND_MARK.starFill} />
    </svg>
  );
}

/** Spring a block in with a small translate; `delay` is in frames. */
export function Reveal({
  delay = 0,
  from = "up",
  distance = 36,
  children,
  style,
}: {
  delay?: number;
  from?: "up" | "down" | "left" | "right" | "none";
  distance?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, stiffness: 120, mass: 0.8 },
    durationInFrames: 26,
  });
  const offset = (1 - p) * distance;
  const translate =
    from === "up"
      ? `translateY(${offset}px)`
      : from === "down"
        ? `translateY(${-offset}px)`
        : from === "left"
          ? `translateX(${offset}px)`
          : from === "right"
            ? `translateX(${-offset}px)`
            : "none";
  return <div style={{ opacity: p, transform: translate, ...style }}>{children}</div>;
}

/** A spring that pops something from 0 to full scale; `delay` in frames. */
export function usePop(delay: number, durationInFrames = 22): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, stiffness: 160, mass: 0.7 },
    durationInFrames,
  });
}

export function Kicker({ children, tone = "light" }: { children: ReactNode; tone?: Tone }) {
  return (
    <div
      style={{
        fontSize: 26,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: tone === "dark" ? THEME.ember : THEME.accent,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

export function Headline({ children, size = 72 }: { children: ReactNode; size?: number }) {
  return (
    <h1
      style={{
        fontSize: size,
        lineHeight: 1.1,
        margin: "0 0 24px",
        fontWeight: 800,
        letterSpacing: "-0.01em",
        maxWidth: 1500,
      }}
    >
      {children}
    </h1>
  );
}

export function Body({
  children,
  size = 32,
  soft = false,
  style,
}: {
  children: ReactNode;
  size?: number;
  soft?: boolean;
  style?: CSSProperties;
}) {
  return (
    <p
      style={{
        fontSize: size,
        lineHeight: 1.45,
        margin: 0,
        color: soft ? THEME.inkSoft : "inherit",
        ...style,
      }}
    >
      {children}
    </p>
  );
}

export function Card({
  children,
  style,
  tone = "light",
}: {
  children: ReactNode;
  style?: CSSProperties;
  tone?: Tone;
}) {
  return (
    <div
      style={{
        background: tone === "dark" ? "rgba(255,253,248,0.06)" : THEME.surface,
        border: `2px solid ${tone === "dark" ? "rgba(255,253,248,0.16)" : THEME.line}`,
        borderRadius: 20,
        padding: "28px 32px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Mono({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        background: THEME.codeBg,
        borderRadius: 8,
        padding: "2px 10px",
        fontSize: "0.92em",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** A numbered teardrop pin, the same badge the canvas draws, dropping in. */
export function PinBadge({
  number,
  size = 72,
  delay = 0,
  x,
  y,
  selected = false,
}: {
  number: number;
  size?: number;
  delay?: number;
  /** Position of the pin TIP inside the parent, in px. */
  x: number;
  y: number;
  selected?: boolean;
}) {
  const p = usePop(delay);
  const drop = (1 - p) * -40;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        transform: `translate(-50%, -100%) translateY(${drop}px) scale(${p})`,
        transformOrigin: "50% 100%",
        opacity: p,
        filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.35))",
      }}
    >
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <path
          d={BRAND_MARK.pinPath}
          fill={THEME.accent}
          stroke={selected ? THEME.ink : THEME.surface}
          strokeWidth={selected ? 2 : 1.4}
        />
        <text
          x="32"
          y="32"
          textAnchor="middle"
          fontFamily={FONT}
          fontWeight={800}
          fontSize="17"
          fill={THEME.surface}
        >
          {number}
        </text>
      </svg>
    </div>
  );
}

/**
 * A raster from public/, sized by width, corners rounded. Decorative by
 * default (empty alt); pass `alt` when the image carries meaning.
 */
export function Tile({
  src,
  width,
  radius = 24,
  alt = "",
  style,
}: {
  src: string;
  width: number;
  radius?: number;
  alt?: string;
  style?: CSSProperties;
}) {
  return (
    <Img
      src={staticFile(src)}
      alt={alt}
      style={{ width, display: "block", borderRadius: radius, ...style }}
    />
  );
}

/**
 * A screenshot inside a fixed frame, scrolled from `scrollFrom` to
 * `scrollTo` natural pixels between two frames. The image is scaled so its
 * natural width fills the frame.
 */
export function ScrollingShot({
  src,
  alt,
  naturalWidth,
  cropX = 0,
  cropWidth = naturalWidth,
  width,
  height,
  scrollFrom = 0,
  scrollTo,
  startFrame,
  endFrame,
  radius = 14,
  style,
}: {
  src: string;
  /** What the screenshot shows; the frame is otherwise opaque to a reader. */
  alt: string;
  naturalWidth: number;
  /** Natural-pixel left edge of the visible column; defaults to the full width. */
  cropX?: number;
  /** Natural-pixel width of the visible column; defaults to the full width. */
  cropWidth?: number;
  width: number;
  height: number;
  scrollFrom?: number;
  scrollTo: number;
  startFrame: number;
  endFrame: number;
  radius?: number;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const scale = width / cropWidth;
  const y = interpolate(frame, [startFrame, endFrame], [scrollFrom, scrollTo], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  return (
    <div
      style={{
        width,
        height,
        overflow: "hidden",
        borderRadius: radius,
        border: `2px solid ${THEME.line}`,
        background: THEME.surface,
        ...style,
      }}
    >
      <Img
        src={staticFile(src)}
        alt={alt}
        style={{
          width: naturalWidth * scale,
          maxWidth: "none",
          display: "block",
          transform: `translate(${-cropX * scale}px, ${-y * scale}px)`,
        }}
      />
    </div>
  );
}

/** Characters of `text` revealed between two frames, with a caret while typing. */
export function Typed({
  text,
  startFrame,
  endFrame,
  style,
}: {
  text: string;
  startFrame: number;
  endFrame: number;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const count = Math.round(
    interpolate(frame, [startFrame, endFrame], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const typing = frame >= startFrame && frame < endFrame;
  return (
    <span style={{ fontFamily: MONO, ...style }}>
      {text.slice(0, count)}
      {typing ? <span style={{ color: THEME.accent }}>|</span> : null}
    </span>
  );
}

/** Straight connector with an arrowhead; grows from left to right. */
export function Arrow({
  width,
  delay = 0,
  label,
  color = THEME.accent,
}: {
  width: number;
  delay?: number;
  label?: string;
  color?: string;
}) {
  const p = usePop(delay, 28);
  const w = Math.max(0, width * p);
  return (
    <div style={{ position: "relative", width, height: 60 }}>
      <svg width={width} height={60} aria-hidden="true">
        <line x1={0} y1={30} x2={w} y2={30} stroke={color} strokeWidth={5} strokeLinecap="round" />
        {p > 0.85 ? (
          <polygon points={`${w},30 ${w - 22},18 ${w - 22},42`} fill={color} />
        ) : null}
      </svg>
      {label ? (
        <div
          style={{
            position: "absolute",
            top: -8,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 22,
            color: THEME.inkSoft,
            opacity: p,
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}

/** A chat-style entry as the app's thread view draws it. */
export function ThreadEntry({
  author,
  children,
  delay = 0,
  founder = false,
}: {
  author: string;
  children: ReactNode;
  delay?: number;
  founder?: boolean;
}) {
  return (
    <Reveal delay={delay} from="left" distance={24}>
      <div
        style={{
          borderLeft: `6px solid ${founder ? THEME.accent : THEME.line}`,
          background: THEME.bg,
          borderRadius: "0 12px 12px 0",
          padding: "12px 20px",
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 800, color: founder ? THEME.accent : THEME.ink }}>
          {author}
        </div>
        <div style={{ fontSize: 26, lineHeight: 1.4 }}>{children}</div>
      </div>
    </Reveal>
  );
}
