import type { ReactNode } from "react";
import { MONO, THEME } from "../theme";
import { Body, Card, Headline, Kicker, Reveal, SlideShell, ThreadEntry, Typed } from "../ui";
import type { SlideProps } from "../Walkthrough";

const LINK_BASE = "https://pinata-tau.vercel.app/f/8f3kq2v7";
const FRAGMENT = "#c9a4d1f0e7b26a9c…e71b";

function Callout({ children, delay, width }: { children: ReactNode; delay: number; width: number }) {
  return (
    <Reveal delay={delay} from="down" distance={14}>
      <div
        style={{
          width,
          fontSize: 23,
          lineHeight: 1.35,
          color: THEME.inkSoft,
          borderTop: `3px solid ${THEME.accent}`,
          paddingTop: 10,
        }}
      >
        {children}
      </div>
    </Reveal>
  );
}

export function ShareSlide({ index }: SlideProps) {
  return (
    <SlideShell index={index}>
      <Kicker>Step 4 of 4 · Share and reply</Kicker>
      <Headline size={64}>Share one link. Get the reply in place.</Headline>
      <Reveal delay={6}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            background: THEME.surface,
            border: `2px solid ${THEME.line}`,
            borderRadius: 16,
            padding: "16px 24px",
            fontSize: 30,
          }}
        >
          <span style={{ color: THEME.inkSoft, fontSize: 22, fontWeight: 700 }}>SHARE LINK</span>
          <span style={{ fontFamily: MONO }}>
            <Typed text={LINK_BASE} startFrame={14} endFrame={54} />
            <Typed
              text={FRAGMENT}
              startFrame={56}
              endFrame={86}
              style={{ color: THEME.accent, fontWeight: 800 }}
            />
          </span>
        </div>
      </Reveal>
      <div style={{ display: "flex", gap: 40, marginTop: 18 }}>
        <Callout delay={96} width={560}>
          The capability rides only in the <strong>URL fragment</strong>: no header, no server
          log, no referrer ever sees it.
        </Callout>
        <Callout delay={116} width={560}>
          The database stores only its <strong>SHA-256 digest</strong>. Rotate or revoke any
          time; the old link dies.
        </Callout>
        <Callout delay={136} width={480}>
          The founder view is <strong>read and reply only</strong>.
        </Callout>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, marginTop: 26 }}>
        <Reveal delay={150}>
          <Card>
            <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 14 }}>Pin 1 · thread</div>
            <ThreadEntry author="Lucas" delay={160}>
              This billing toggle reads the same in both states. Which one is active?
            </ThreadEntry>
            <ThreadEntry author="founder" founder delay={200}>
              Good catch. Monthly is the default. We&rsquo;ll add a pressed state this sprint.
            </ThreadEntry>
            <ThreadEntry author="Lucas" delay={240}>
              Perfect, that&rsquo;s all it needs.
            </ThreadEntry>
          </Card>
        </Reveal>
        <div>
          <Reveal delay={260}>
            <Card style={{ display: "flex", gap: 22, alignItems: "center" }}>
              <svg width={72} height={84} viewBox="0 0 72 84" aria-hidden="true">
                <rect x={8} y={36} width={56} height={44} rx={10} fill={THEME.accent} />
                <path d="M20 36 V24 a16 16 0 0 1 32 0 V36" fill="none" stroke={THEME.accent} strokeWidth={8} />
                <circle cx={36} cy={58} r={6} fill={THEME.surface} />
              </svg>
              <div>
                <div style={{ fontSize: 30, fontWeight: 800 }}>Append-only, chronological</div>
                <Body size={24}>
                  Nobody, the founder included, can edit or delete a founder reply. Database
                  triggers reject the update.
                </Body>
              </div>
            </Card>
          </Reveal>
          <Reveal delay={290}>
            <Body size={24} soft style={{ marginTop: 22 }}>
              The founder&rsquo;s label is always the literal <strong>founder</strong>. No name,
              no account, nothing to leak.
            </Body>
          </Reveal>
        </div>
      </div>
    </SlideShell>
  );
}
