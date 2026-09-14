import { THEME } from "../theme";
import { Body, Card, Headline, Kicker, Reveal, SlideShell, Tile, usePop } from "../ui";
import { WALKTHROUGH_ASSETS } from "../assets";
import type { SlideProps } from "../Walkthrough";

const RAILS = [
  ["Public pages only", "No logins, no private sites, no IP literals or internal hosts."],
  ["Static captures only", "A frozen full-page still. No interaction, no animation, no video."],
  ["No runtime AI", "Nothing in the product spends a token. Feedback is human-written."],
  ["Directional feedback only", "No copy rewrites, no style changes, no IDE. The founder owns the edits."],
  ["No crawling", "Explicit URL lists, captured in order. Never link discovery."],
  ["No editing of a founder's words", "Replies are append-only for everyone, including the founder."],
] as const;

function Rail({ title, body, delay }: { title: string; body: string; delay: number }) {
  const p = usePop(delay, 24);
  return (
    <div style={{ transform: `scale(${0.9 + 0.1 * p})`, opacity: p }}>
      <Card style={{ minHeight: 210 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
          <svg width={34} height={34} viewBox="0 0 34 34" aria-hidden="true">
            <circle cx={17} cy={17} r={16} fill={THEME.accent} />
            <path d="M9 17.5 l5 5 l11 -11" stroke={THEME.surface} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 31, fontWeight: 800 }}>{title}</div>
        </div>
        <Body size={24} soft>
          {body}
        </Body>
      </Card>
    </div>
  );
}

export function GuardrailsSlide({ index }: SlideProps) {
  return (
    <SlideShell index={index}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <Kicker>Scope</Kicker>
          <Headline>Guardrails, on purpose</Headline>
        </div>
        <Reveal delay={10} from="left">
          <Tile
            src={WALKTHROUGH_ASSETS.markCircleDark}
            width={150}
            radius={999}
            alt="The pinata mark from the brand exploration board: a llama-headed pin on a dark circle"
          />
        </Reveal>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 26, marginTop: 4 }}>
        {RAILS.map(([title, body], i) => (
          <Rail key={title} title={title} body={body} delay={16 + i * 18} />
        ))}
      </div>
      <Reveal delay={170}>
        <Body size={28} style={{ marginTop: 30 }}>
          Each guardrail is a recorded decision with its alternatives, not a limitation that
          crept in. Together they keep Pinata a two-minute tool for a two-minute comment.
        </Body>
      </Reveal>
    </SlideShell>
  );
}
