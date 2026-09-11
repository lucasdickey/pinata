import { useCurrentFrame } from "remotion";
import { WALKTHROUGH_ASSETS } from "../assets";
import { THEME } from "../theme";
import { Body, Mark, Reveal, SlideShell, Tile, usePop } from "../ui";
import type { SlideProps } from "../Walkthrough";

const BOARD_TILES = [
  WALKTHROUGH_ASSETS.appIconLight,
  WALKTHROUGH_ASSETS.appIconDark,
  WALKTHROUGH_ASSETS.markCircle,
  WALKTHROUGH_ASSETS.markCircleDark,
  WALKTHROUGH_ASSETS.pLetter,
  WALKTHROUGH_ASSETS.loading,
];

export function TitleSlide({ index }: SlideProps) {
  const frame = useCurrentFrame();
  const pop = usePop(2, 30);
  const wobble = Math.sin(frame / 9) * (1 - Math.min(1, frame / 60)) * 6;
  return (
    <SlideShell index={index}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div style={{ transform: `scale(${pop}) rotate(${wobble}deg)`, transformOrigin: "50% 100%" }}>
          <Mark size={200} />
        </div>
        <Reveal delay={10}>
          <div
            style={{
              fontSize: 168,
              fontWeight: 800,
              color: THEME.accent,
              lineHeight: 1,
              letterSpacing: "-0.03em",
              marginTop: 18,
            }}
          >
            pinata
          </div>
        </Reveal>
        <div style={{ display: "flex", gap: 22, fontSize: 52, marginTop: 20, color: THEME.inkSoft }}>
          <Reveal delay={34}>
            <span>
              <strong style={{ color: THEME.ink }}>pin</strong>
            </span>
          </Reveal>
          <Reveal delay={46}>
            <span>
              + <strong style={{ color: THEME.ink }}>anno</strong>tation
            </span>
          </Reveal>
          <Reveal delay={58}>
            <span>
              + at <strong style={{ color: THEME.ink }}>ya</strong>
            </span>
          </Reveal>
        </div>
        <Reveal delay={82}>
          <Body size={36} soft style={{ marginTop: 28, maxWidth: 1100 }}>
            Directional feedback on a friend&rsquo;s public website, pinned to the exact spot
            on the page, answered in place.
          </Body>
        </Reveal>
      </div>

      <div style={{ position: "absolute", left: 96, right: 96, bottom: 128 }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 26 }}>
          {BOARD_TILES.map((src, i) => (
            <Reveal key={src} delay={120 + i * 8} from="up" distance={24}>
              <Tile src={src} width={124} radius={22} />
            </Reveal>
          ))}
        </div>
        <Reveal delay={170}>
          <div style={{ textAlign: "center", fontSize: 22, color: THEME.inkSoft, marginTop: 14 }}>
            From the brand exploration board committed with the project, 6 September 2026.
          </div>
        </Reveal>
      </div>
    </SlideShell>
  );
}
