import { SCREENSHOT_SIZES, WALKTHROUGH_ASSETS } from "../assets";
import { MONO, ORIGIN_COLORS, THEME } from "../theme";
import { Body, Headline, Kicker, Mark, Reveal, ScrollingShot, SlideShell } from "../ui";
import type { SlideProps } from "../Walkthrough";

const ORIGINS = [
  ["user-directed", "Human directed", "the human asked for it; the agent executed"],
  ["agent-proposed-user-approved", "Agent proposed, human approved", "the agent raised it; the human said yes"],
  ["agent-autonomous", "Agent decided alone", "inside granted latitude, recorded for honesty"],
  ["user-deferred", "Raised and deferred", "consciously postponed, still visible"],
] as const;

export function DocumentedSlide({ index }: SlideProps) {
  return (
    <SlideShell index={index}>
      <Kicker>The decision trail</Kicker>
      <Headline size={64}>The decisions are part of the product</Headline>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 720px", gap: 56 }}>
        <div>
          <Reveal delay={8}>
            <Body size={28}>
              Every material decision lives in one JSON file, tagged with <strong>who decided it</strong>:
            </Body>
          </Reveal>
          <div style={{ marginTop: 18 }}>
            {ORIGINS.map(([key, label, meaning], i) => (
              <Reveal key={key} delay={30 + i * 20} from="left" distance={16}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "6px 18px",
                      borderRadius: 999,
                      border: `3px solid ${ORIGIN_COLORS[key]}`,
                      color: ORIGIN_COLORS[key],
                      fontSize: 24,
                      fontWeight: 800,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label}
                  </span>
                  <span style={{ fontSize: 23, color: THEME.inkSoft }}>{meaning}</span>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={120}>
            <Body size={26} style={{ marginTop: 16 }}>
              Each tag is backed by a <strong>verbatim quote</strong>. A record without its
              evidence fails the build.
            </Body>
          </Reveal>
          <Reveal delay={150}>
            <Body size={24} soft style={{ marginTop: 14 }}>
              Rendered three ways from the one source: <span style={{ fontFamily: MONO }}>docs/DECISIONS.md</span>,
              a dependency-free browser dashboard, and live pages at{" "}
              <span style={{ fontFamily: MONO }}>/reqs</span> in the deployed app.
            </Body>
          </Reveal>
          <Reveal delay={230}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                marginTop: 40,
                paddingTop: 26,
                borderTop: `2px solid ${THEME.line}`,
              }}
            >
              <Mark size={84} />
              <div>
                <div style={{ fontSize: 40, fontWeight: 800, color: THEME.accent, lineHeight: 1.1 }}>
                  pinata
                </div>
                <div style={{ fontSize: 24, color: THEME.inkSoft }}>
                  pin + annotation + at ya · github.com/lucasdickey/pinata
                </div>
              </div>
            </div>
          </Reveal>
        </div>
        <Reveal delay={20} from="right">
          <div style={{ fontSize: 22, color: THEME.inkSoft, marginBottom: 8 }}>
            The decision dashboard, opened straight from the repository.
          </div>
          <ScrollingShot
            src={WALKTHROUGH_ASSETS.dashboard}
            alt="The decision dashboard: provenance counts, filters, and decision cards D001 to D006, scrolling"
            naturalWidth={SCREENSHOT_SIZES.dashboard.width}
            width={720}
            height={640}
            scrollTo={SCREENSHOT_SIZES.dashboard.height - 1140}
            startFrame={40}
            endFrame={280}
          />
        </Reveal>
      </div>
    </SlideShell>
  );
}
