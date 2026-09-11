import type { ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { MONO, THEME } from "../theme";
import { Body, Card, Headline, Kicker, PinBadge, Reveal, SlideShell } from "../ui";
import type { SlideProps } from "../Walkthrough";
import { PageMock } from "./PageMock";

const PLANE_W = 1040;
// Natural coordinates from the landing's static example, scaled to the plane.
const SCALE = PLANE_W / 1440;
const PIN_1 = { x: 462 * SCALE, y: 410 * SCALE };
const PIN_2 = { x: 1004 * SCALE, y: 596 * SCALE };

function Candidate({
  children,
  selected = false,
  delay,
}: {
  children: ReactNode;
  selected?: boolean;
  delay: number;
}) {
  return (
    <Reveal delay={delay} from="left" distance={12}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, marginBottom: 8 }}>
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 999,
            border: `3px solid ${THEME.accent}`,
            background: selected ? THEME.accent : "transparent",
            flex: "0 0 auto",
          }}
        />
        <span style={{ fontWeight: selected ? 800 : 400 }}>{children}</span>
      </div>
    </Reveal>
  );
}

export function AnnotateSlide({ index }: SlideProps) {
  const frame = useCurrentFrame();
  // Camera: zoom into pin 1, then ease back out. The pins are children of the
  // same plane, so they ride the transform exactly as they do in the app.
  const zoom = interpolate(frame, [130, 200, 260, 320], [1, 2.1, 2.1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const zoomLabel = interpolate(frame, [130, 200], [100, 210], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <SlideShell index={index}>
      <Kicker>Step 3 of 4 · Annotate</Kicker>
      <Headline size={64}>Pin notes to the exact pixel</Headline>
      <div style={{ display: "grid", gridTemplateColumns: `${PLANE_W}px 1fr`, gap: 48 }}>
        <Reveal delay={6}>
          <div
            style={{
              position: "relative",
              width: PLANE_W,
              height: (PLANE_W * 900) / 1440,
              overflow: "hidden",
              borderRadius: 14,
              border: `2px solid ${THEME.line}`,
              background: THEME.bg,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                transform: `scale(${zoom})`,
                transformOrigin: `${PIN_1.x}px ${PIN_1.y - 40}px`,
              }}
            >
              <PageMock width={PLANE_W} />
              <PinBadge number={1} x={PIN_1.x} y={PIN_1.y} delay={34} size={56} selected />
              <PinBadge number={2} x={PIN_2.x} y={PIN_2.y} delay={76} size={56} />
            </div>
            <div
              style={{
                position: "absolute",
                right: 14,
                top: 12,
                background: THEME.surface,
                border: `2px solid ${THEME.line}`,
                borderRadius: 999,
                padding: "4px 14px",
                fontSize: 20,
                color: THEME.inkSoft,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Math.round(zoomLabel)}%
            </div>
          </div>
        </Reveal>
        <div>
          <Reveal delay={90}>
            <Card>
              <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 8 }}>Pin 1</div>
              <div style={{ fontSize: 25, lineHeight: 1.4, marginBottom: 16 }}>
                This billing toggle reads the same in both states. Which one is active?
              </div>
              <div style={{ fontSize: 20, color: THEME.inkSoft, fontWeight: 700, marginBottom: 8 }}>
                NEARBY ELEMENTS · pick one, or none
              </div>
              <Candidate delay={104} selected>
                <span style={{ fontFamily: MONO }}>button</span> · switch · &ldquo;Annual (save 20%)&rdquo;
              </Candidate>
              <Candidate delay={112}>
                <span style={{ fontFamily: MONO }}>div.billing-toggle</span>
              </Candidate>
              <Candidate delay={120}>No element</Candidate>
              <div style={{ fontSize: 20, color: THEME.inkSoft, marginTop: 10 }}>
                Stored: 462, 410 natural px · element snapshot as context, never as a selector.
              </div>
            </Card>
          </Reveal>
          <Reveal delay={200}>
            <Body size={25} style={{ marginTop: 22 }}>
              Coordinates live in <strong>screenshot pixels</strong>, so pan, zoom, and browser
              resize never move a target. Desktop and mobile are independent planes.
            </Body>
          </Reveal>
          <Reveal delay={280}>
            <Body size={23} soft style={{ marginTop: 16 }}>
              Later: boxes, circles, and straight arrows on the same canvas.
            </Body>
          </Reveal>
        </div>
      </div>
    </SlideShell>
  );
}
