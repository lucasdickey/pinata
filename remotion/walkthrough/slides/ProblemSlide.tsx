import type { ReactNode } from "react";
import { THEME } from "../theme";
import { Body, Card, Headline, Kicker, PinBadge, Reveal, SlideShell } from "../ui";
import type { SlideProps } from "../Walkthrough";
import { PageMock } from "./PageMock";

function Bubble({
  children,
  delay,
  right = false,
  image = false,
}: {
  children: ReactNode;
  delay: number;
  right?: boolean;
  image?: boolean;
}) {
  return (
    <Reveal delay={delay} from={right ? "left" : "right"} distance={30}>
      <div
        style={{
          display: "flex",
          justifyContent: right ? "flex-end" : "flex-start",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            maxWidth: 560,
            background: right ? THEME.accentSoft : THEME.surface,
            border: `2px solid ${THEME.line}`,
            borderRadius: right ? "22px 22px 6px 22px" : "22px 22px 22px 6px",
            padding: image ? 10 : "12px 20px",
            fontSize: 26,
            lineHeight: 1.35,
          }}
        >
          {children}
        </div>
      </div>
    </Reveal>
  );
}

function ScreenshotThumb({ label }: { label: string }) {
  return (
    <div
      style={{
        width: 260,
        height: 120,
        background: THEME.bg,
        borderRadius: 12,
        border: `2px dashed ${THEME.line}`,
        display: "flex",
        alignItems: "flex-end",
        padding: 12,
        fontSize: 20,
        color: THEME.inkSoft,
        fontFamily: "ui-monospace, Menlo, monospace",
      }}
    >
      {label}
    </div>
  );
}

export function ProblemSlide({ index }: SlideProps) {
  return (
    <SlideShell index={index}>
      <Kicker>The problem</Kicker>
      <Headline size={60}>Feedback comes loose from the spot it points at</Headline>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, marginTop: 8 }}>
        <div>
          <Reveal delay={6}>
            <Body size={24} soft style={{ marginBottom: 12 }}>
              Today: a chat thread
            </Body>
          </Reveal>
          <Bubble delay={12} image>
            <ScreenshotThumb label="IMG_4021.png" />
          </Bubble>
          <Bubble delay={30}>the pricing table feels cramped</Bubble>
          <Bubble delay={48} image>
            <ScreenshotThumb label="Screenshot 2026-09-06 at 4.05.16 PM.png" />
          </Bubble>
          <Bubble delay={80} right>
            which table? on which page? the monthly one?
          </Bubble>
        </div>
        <div>
          <Reveal delay={120}>
            <Body size={24} soft style={{ marginBottom: 12 }}>
              With Pinata: the same note, on the pixel
            </Body>
          </Reveal>
          <Reveal delay={126} from="up">
            <div style={{ position: "relative", width: 720 }}>
              <PageMock width={720} />
              <PinBadge number={1} x={352} y={203} delay={150} size={60} />
              <Reveal
                delay={168}
                from="up"
                distance={16}
                style={{ position: "absolute", left: 400, top: 96, width: 330 }}
              >
                <Card
                  style={{
                    padding: "14px 18px",
                    boxShadow: "0 8px 24px rgba(51,38,26,0.15)",
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 800 }}>Lucas · pin 1</div>
                  <div style={{ fontSize: 24, lineHeight: 1.3 }}>
                    the pricing table feels cramped
                  </div>
                  <div style={{ fontSize: 18, color: THEME.inkSoft, marginTop: 6 }}>
                    chickpea.co/pricing · desktop · (462, 410)
                  </div>
                </Card>
              </Reveal>
            </div>
          </Reveal>
        </div>
      </div>
      <Reveal delay={215}>
        <Body size={27} style={{ marginTop: 14, maxWidth: 1600 }}>
          Pinata is deliberately <strong>not</strong> an editing tool: no copy rewrites, no
          style changes, no IDE. The founder owns the edits. Pinata makes &ldquo;try
          tightening this&rdquo; unambiguous.
        </Body>
      </Reveal>
    </SlideShell>
  );
}
