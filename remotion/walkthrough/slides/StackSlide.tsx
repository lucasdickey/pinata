import { MONO, THEME } from "../theme";
import { Arrow, Body, Card, Headline, Kicker, Reveal, SlideShell, usePop } from "../ui";
import type { SlideProps } from "../Walkthrough";

const GATE = ["lint", "typecheck", "test", "docs:check", "build", "e2e"];

function Box({ title, sub, delay, accent = false }: { title: string; sub?: string; delay: number; accent?: boolean }) {
  return (
    <Reveal delay={delay} from="up" distance={20}>
      <Card
        style={{
          padding: "16px 22px",
          background: accent ? THEME.accent : THEME.surface,
          color: accent ? THEME.surface : THEME.ink,
          borderColor: accent ? THEME.accent : THEME.line,
        }}
      >
        <div style={{ fontSize: 27, fontWeight: 800 }}>{title}</div>
        {sub ? (
          <div style={{ fontSize: 21, opacity: 0.85, marginTop: 2 }}>{sub}</div>
        ) : null}
      </Card>
    </Reveal>
  );
}

function GateStep({ name, delay, last }: { name: string; delay: number; last: boolean }) {
  const p = usePop(delay, 18);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: MONO,
          fontSize: 26,
          padding: "10px 18px",
          borderRadius: 999,
          border: `2px solid ${p > 0.5 ? "#1a7f37" : THEME.line}`,
          background: p > 0.5 ? "#e6f4ea" : THEME.surface,
          color: p > 0.5 ? "#1a7f37" : THEME.inkSoft,
        }}
      >
        <span style={{ display: "inline-block", transform: `scale(${p})` }}>✓</span>
        {name}
      </div>
      {!last ? <span style={{ fontSize: 28, color: THEME.inkSoft, padding: "0 10px" }}>→</span> : null}
    </div>
  );
}

export function StackSlide({ index }: SlideProps) {
  return (
    <SlideShell index={index}>
      <Kicker>How it&rsquo;s built</Kicker>
      <Headline>The stack, and the one gate</Headline>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "300px 120px 420px 120px 1fr",
          alignItems: "center",
          gap: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Box title="Editor browser" sub="one password prompt" delay={6} />
          <Box title="Founder browser" sub="capability link" delay={16} />
        </div>
        <Arrow width={110} delay={30} />
        <Box title="Next.js on Vercel" sub="React · TypeScript · React Flow canvas · Zod at every boundary" delay={26} accent />
        <Arrow width={110} delay={50} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Box title="Turso (libSQL) + Drizzle" sub="projects, pages, captures, annotations, append-only threads" delay={56} />
          <Box title="Private Vercel Blob" sub="the screenshots, served only through an authorizing route" delay={68} />
          <Box title="Browserless" sub="one fresh headless session per URL and viewport → the public page" delay={80} />
        </div>
      </div>
      <Reveal delay={110}>
        <Body size={24} soft style={{ marginTop: 22 }}>
          The browser never holds a credential. Every database, storage, and capture call goes
          through a server route that authorizes it.
        </Body>
      </Reveal>
      <Reveal delay={130}>
        <div style={{ marginTop: 30 }}>
          <div style={{ fontSize: 26, marginBottom: 12 }}>
            One command is the whole quality gate, locally and in CI, on Node 24:{" "}
            <span style={{ fontFamily: MONO, fontWeight: 800 }}>npm run validate</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center" }}>
            {GATE.map((name, i) => (
              <GateStep key={name} name={name} delay={150 + i * 18} last={i === GATE.length - 1} />
            ))}
          </div>
        </div>
      </Reveal>
    </SlideShell>
  );
}
