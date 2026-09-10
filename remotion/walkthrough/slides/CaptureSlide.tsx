import { SCREENSHOT_SIZES, WALKTHROUGH_ASSETS } from "../assets";
import { MONO, THEME } from "../theme";
import { Body, Card, Headline, Kicker, Reveal, ScrollingShot, SlideShell } from "../ui";
import type { SlideProps } from "../Walkthrough";

const STEPS = [
  "Load the page in a fresh headless browser (Browserless)",
  "Scroll out lazy-loaded content, return to the top",
  "Freeze animation and hide carets, without touching layout",
  "Take one full-page screenshot per viewport",
  "Extract a small, sanitized manifest of visible elements",
];

export function CaptureSlide({ index }: SlideProps) {
  const desktopW = 620;
  const desktopH = 440;
  const phoneW = 200;
  const phoneH = 433;
  // The landing screenshot's centered column, as a phone would frame it.
  const phoneCropWidth = 720;
  const phoneCropX = (SCREENSHOT_SIZES.landing.width - phoneCropWidth) / 2;
  const phoneVisibleNatural = phoneH / (phoneW / phoneCropWidth);
  return (
    <SlideShell index={index}>
      <Kicker>Step 2 of 4 · Capture</Kicker>
      <Headline size={64}>Capture each page, twice, as a still</Headline>
      <div style={{ display: "grid", gridTemplateColumns: "880px 1fr", gap: 56, marginTop: 4 }}>
        <div style={{ display: "flex", gap: 30, alignItems: "flex-start" }}>
          <Reveal delay={8}>
            <div style={{ fontSize: 22, color: THEME.inkSoft, marginBottom: 8 }}>
              Desktop · 1440 × 900
            </div>
            <ScrollingShot
              src={WALKTHROUGH_ASSETS.landing}
              alt="The pinata landing page, captured full-page at desktop width, scrolling from top to bottom"
              naturalWidth={SCREENSHOT_SIZES.landing.width}
              width={desktopW}
              height={desktopH}
              scrollTo={SCREENSHOT_SIZES.landing.height - 900}
              startFrame={40}
              endFrame={200}
            />
            <Reveal delay={220}>
              <div style={{ fontSize: 22, color: THEME.inkSoft, marginTop: 10 }}>
                Full page, one image, natural pixel size.
              </div>
            </Reveal>
          </Reveal>
          <Reveal delay={20}>
            <div style={{ fontSize: 22, color: THEME.inkSoft, marginBottom: 8 }}>
              Mobile · 390 × 844
            </div>
            <ScrollingShot
              src={WALKTHROUGH_ASSETS.landing}
              alt="The same landing page framed at phone width"
              naturalWidth={SCREENSHOT_SIZES.landing.width}
              cropX={phoneCropX}
              cropWidth={phoneCropWidth}
              width={phoneW}
              height={phoneH}
              scrollTo={Math.max(0, SCREENSHOT_SIZES.landing.height - phoneVisibleNatural)}
              startFrame={60}
              endFrame={220}
              radius={26}
            />
          </Reveal>
        </div>
        <div>
          <ol style={{ margin: 0, paddingLeft: 40 }}>
            {STEPS.map((step, i) => (
              <Reveal key={step} delay={30 + i * 26} from="left" distance={18}>
                <li style={{ fontSize: 27, lineHeight: 1.35, marginBottom: 12 }}>{step}</li>
              </Reveal>
            ))}
          </ol>
          <Reveal delay={200}>
            <Card style={{ marginTop: 18, padding: "18px 24px" }}>
              <div style={{ fontSize: 22, color: THEME.inkSoft, marginBottom: 8, fontWeight: 700 }}>
                MANIFEST ROW · tag, role, text, position
              </div>
              <div style={{ fontFamily: MONO, fontSize: 23, lineHeight: 1.5 }}>
                button · switch · &ldquo;Annual (save 20%)&rdquo;
                <br />
                main › section.pricing › div.billing-toggle
                <br />
                392, 386 · 176 × 44 px
              </div>
            </Card>
          </Reveal>
          <Reveal delay={260}>
            <Body size={25} style={{ marginTop: 18 }}>
              <strong>Never</strong> HTML source, cookies, storage, form values, hidden text, or
              cross-origin iframe internals. At most 500 elements, 256 KiB.
            </Body>
          </Reveal>
        </div>
      </div>
    </SlideShell>
  );
}
