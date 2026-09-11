import type { ReactNode } from "react";
import { THEME } from "../theme";
import { Arrow, Body, Card, Headline, Kicker, Mark, Reveal, SlideShell } from "../ui";
import type { SlideProps } from "../Walkthrough";

function Bullet({ children, delay }: { children: ReactNode; delay: number }) {
  return (
    <Reveal delay={delay} from="left" distance={18}>
      <li style={{ fontSize: 30, lineHeight: 1.4, marginBottom: 14 }}>{children}</li>
    </Reveal>
  );
}

export function PeopleSlide({ index }: SlideProps) {
  return (
    <SlideShell index={index}>
      <Kicker>Who it&rsquo;s for</Kicker>
      <Headline>Two people, one link</Headline>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 260px 1fr",
          gap: 24,
          alignItems: "center",
          marginTop: 12,
        }}
      >
        <Reveal delay={8}>
          <Card style={{ minHeight: 400 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 18 }}>
              <Mark size={64} />
              <div>
                <div style={{ fontSize: 22, color: THEME.inkSoft, fontWeight: 700 }}>THE EDITOR</div>
                <div style={{ fontSize: 40, fontWeight: 800 }}>Lucas</div>
              </div>
            </div>
            <ul style={{ margin: 0, paddingLeft: 34 }}>
              <Bullet delay={24}>captures pages from public URLs</Bullet>
              <Bullet delay={34}>places numbered pins on the exact spot</Bullet>
              <Bullet delay={44}>writes short, directional comments</Bullet>
              <Bullet delay={54}>signs in with one password prompt</Bullet>
            </ul>
          </Card>
        </Reveal>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <Arrow width={240} delay={70} label="one unguessable link" />
          <Reveal delay={100} from="down" distance={12}>
            <div style={{ fontSize: 20, color: THEME.inkSoft, textAlign: "center" }}>
              persistent, revocable
            </div>
          </Reveal>
        </div>
        <Reveal delay={40}>
          <Card style={{ minHeight: 400 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 18 }}>
              <div
                style={{
                  background: THEME.accentSoft,
                  color: THEME.ink,
                  borderRadius: 999,
                  padding: "8px 20px",
                  fontSize: 22,
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                }}
              >
                FOUNDER
              </div>
              <div>
                <div style={{ fontSize: 22, color: THEME.inkSoft, fontWeight: 700 }}>THE RECIPIENT</div>
                <div style={{ fontSize: 40, fontWeight: 800 }}>a friend</div>
              </div>
            </div>
            <ul style={{ margin: 0, paddingLeft: 34 }}>
              <Bullet delay={64}>opens the link, no account, no signup</Bullet>
              <Bullet delay={74}>reads every annotation in place</Bullet>
              <Bullet delay={84}>replies in the thread under each pin</Bullet>
              <Bullet delay={94}>cannot move, edit, or delete a pin</Bullet>
            </ul>
          </Card>
        </Reveal>
      </div>
      <Reveal delay={130}>
        <Body size={28} soft style={{ marginTop: 30 }}>
          First real recipient: the founder of <strong>chickpea.co</strong>, which is also the
          canonical test target (root, /pricing, /about, /privacy).
        </Body>
      </Reveal>
    </SlideShell>
  );
}
