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
// Box 3 (D079): drawn around the three pricing cards of the page mock,
// scaled the same way. Same numbering sequence as the pins.
const BOX_3 = { x: 140 * SCALE, y: 450 * SCALE, width: 1160 * SCALE, height: 340 * SCALE };

/** A drawn box as the canvas renders it: stroked, with its number at the corner. */
function BoxMark({ number, delay }: { number: number; delay: number }) {
  return (
    <Reveal delay={delay} from="none">
      <div
        style={{
          position: "absolute",
          left: BOX_3.x,
          top: BOX_3.y,
          width: BOX_3.width,
          height: BOX_3.height,
          border: `3px solid ${THEME.accent}`,
          borderRadius: 6,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -3,
            top: -3,
            minWidth: 34,
            height: 34,
            padding: "0 8px",
            borderRadius: 8,
            background: THEME.accent,
            color: THEME.surface,
            fontSize: 20,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {number}
        </div>
      </div>
    </Reveal>
  );
}

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
              <BoxMark number={3} delay={290} />
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
              {/* The mark's name, as every list in the product prints it
                  (D078): kind and number, the comment, the element. */}
              <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, lineHeight: 1.3 }}>
                Pin 1 · &ldquo;This billing toggle reads the same in both&hellip;&rdquo; · Annual
                (save 20%)
              </div>
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
                Stored in screenshot pixels · the element travels as context, never as a
                selector.
              </div>
            </Card>
          </Reveal>
          <Reveal delay={200}>
            <Body size={25} style={{ marginTop: 22 }}>
              Coordinates live in <strong>screenshot pixels</strong>, so pan, zoom, and browser
              resize never move a target. Desktop and mobile each keep their own marks.
            </Body>
          </Reveal>
          <Reveal delay={280}>
            <Body size={23} soft style={{ marginTop: 16 }}>
              <strong>Shift-drag draws a box</strong> around a region, numbered in the same
              sequence. Circles and arrows are still to come.
            </Body>
          </Reveal>
        </div>
      </div>
    </SlideShell>
  );
}
