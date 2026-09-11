import type { ReactNode } from "react";
import { THEME } from "../theme";
import { Body, Card, Headline, Kicker, Reveal, SlideShell, Typed, usePop } from "../ui";
import type { SlideProps } from "../Walkthrough";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>{label}</div>
      <div
        style={{
          border: `2px solid ${THEME.line}`,
          borderRadius: 10,
          background: THEME.surface,
          padding: "12px 18px",
          fontSize: 28,
          minHeight: 60,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function NoCrawl() {
  // A little site graph with the discovered links struck out.
  return (
    <svg width={220} height={150} viewBox="0 0 220 150" aria-hidden="true">
      <circle cx={40} cy={75} r={22} fill={THEME.accent} />
      {[
        [150, 30],
        [170, 75],
        [150, 120],
      ].map(([x, y], i) => (
        <g key={i}>
          <line x1={60} y1={75} x2={x! - 20} y2={y!} stroke={THEME.line} strokeWidth={5} strokeDasharray="8 8" />
          <circle cx={x} cy={y} r={16} fill="none" stroke={THEME.line} strokeWidth={4} />
        </g>
      ))}
      <line x1={90} y1={20} x2={200} y2={130} stroke={THEME.accent} strokeWidth={8} strokeLinecap="round" />
    </svg>
  );
}

export function ProjectSlide({ index }: SlideProps) {
  const press = usePop(178, 16);
  return (
    <SlideShell index={index}>
      <Kicker>Step 1 of 4 · Create a project</Kicker>
      <Headline>Start from explicit URLs. Never crawl.</Headline>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, marginTop: 8 }}>
        <Reveal delay={6}>
          <Card>
            <div style={{ fontSize: 34, fontWeight: 800, marginBottom: 18 }}>Capture a page</div>
            <Field label="Root URL">
              <Typed text="https://chickpea.co" startFrame={20} endFrame={68} />
            </Field>
            <Field label="Additional URLs (optional)">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {["/pricing", "/about", "/privacy"].map((path, i) => (
                  <Reveal key={path} delay={92 + i * 22} from="left" distance={14}>
                    <div style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
                      <span style={{ color: THEME.inkSoft }}>{i + 2}. </span>
                      https://chickpea.co{path}
                    </div>
                  </Reveal>
                ))}
              </div>
            </Field>
            <div
              style={{
                display: "inline-block",
                background: THEME.accent,
                color: THEME.surface,
                borderRadius: 10,
                padding: "12px 26px",
                fontSize: 28,
                fontWeight: 800,
                transform: `scale(${1 - 0.08 * Math.sin(press * Math.PI)})`,
              }}
            >
              Start capturing
            </div>
          </Card>
        </Reveal>
        <div>
          <Reveal delay={60}>
            <Card style={{ display: "flex", gap: 26, alignItems: "center" }}>
              <NoCrawl />
              <div>
                <div style={{ fontSize: 34, fontWeight: 800, marginBottom: 8 }}>No crawling. Ever.</div>
                <Body size={26}>
                  Pinata captures exactly these addresses, in this order. It never discovers or
                  follows links on its own.
                </Body>
              </div>
            </Card>
          </Reveal>
          <Reveal delay={130}>
            <Card style={{ marginTop: 26 }}>
              <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 8 }}>Public HTTPS only</div>
              <Body size={26}>
                Every address is revalidated on the server: no credentials, no IP literals, no
                private or loopback destinations, and every redirect hop is checked again.
              </Body>
            </Card>
          </Reveal>
          <Reveal delay={200}>
            <Body size={26} soft style={{ marginTop: 26 }}>
              A project keeps a page per URL and, under each page, one capture per device.
            </Body>
          </Reveal>
        </div>
      </div>
    </SlideShell>
  );
}
