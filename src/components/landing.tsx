// The branded landing page composition (VAL-LANDING-001/002, D066). The same
// hero — the pinata mark, the name, and a brief value proposition — opens
// the public landing and /pins/new. Only /pins/new, behind sign-in, carries
// the project form: the public landing asks a visitor to sign in instead of
// taking an address first (D103), then shows the static example and the
// sign-in form itself. Kept free of server-only APIs so the same components
// render under React Testing Library in jsdom.

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { REQUIREMENTS_NAV } from "../lib/requirements";
import { ExampleCapture } from "./example-capture";
import { LoginForm } from "./login-form";
import { PinataLogo } from "./pinata-logo";
import { ThemeToggle } from "./theme-toggle";

/**
 * The hero: the name and the statement above whichever capture form the
 * visitor's role gets. The name and the statement share one size in two
 * tones, the name in ink and the promise in gray (D102). Where the page has
 * no top bar (/pins/new) the mark opens the hero; on the anonymous landing
 * it rides in the top bar instead (VAL-LANDING-001).
 */
export function LandingHero({
  children,
  showMark = true,
}: {
  children: ReactNode;
  showMark?: boolean;
}) {
  return (
    <header className="landing-hero">
      {showMark ? <PinataLogo /> : null}
      <p className="landing-eyebrow">
        <strong>pin</strong> + <strong>annotate</strong> + at <strong>ya</strong>
      </p>
      <h1>pinata</h1>
      <p className="landing-statement">feedback pinned to the exact pixel, sent in one link</p>
      <p className="landing-prop">
        Drop in a public page address and Pinata captures it — then pin plain,
        directional notes to the exact pixel and share one link with the
        founder. No source edits, no crawling, no runtime AI.
      </p>
      {children}
    </header>
  );
}

/**
 * The hub links, one per destination. Rendering the five titles as a single
 * anchor sent every one of them to `/reqs`; each title is its own link to
 * its own route, and the list is generated from REQUIREMENTS_NAV so a route
 * added there can never be missing here.
 */
export function LandingLinks() {
  return (
    <nav className="home-nav" aria-label="Project documentation">
      <ul>
        {REQUIREMENTS_NAV.map(({ route, title, summary }) => (
          <li key={route}>
            <Link href={route} title={summary}>
              {title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The quiet top bar: the mark and name at left, three plain links at right. */
function SiteBar() {
  return (
    <div className="site-bar">
      <Link href="/" className="site-mark" aria-label="pinata home">
        <PinataLogo size={30} />
        <span aria-hidden="true">pinata</span>
      </Link>
      <nav aria-label="Site">
        <ul className="site-links">
          <li>
            <Link href="/walkthrough">Walkthrough</Link>
          </li>
          <li className="site-link-docs">
            <Link href="/reqs">How it's built</Link>
          </li>
          <li>
            <a href="#editor-login">Sign in</a>
          </li>
          <li>
            <ThemeToggle />
          </li>
        </ul>
      </nav>
    </div>
  );
}

/** The three steps, in the landing's point format: a short title, one line. */
function HowItWorks() {
  return (
    <section className="landing-section" aria-labelledby="how-heading">
      <p className="section-eyebrow">how it works</p>
      <h2 id="how-heading">a two-minute comment should take two minutes</h2>
      <ul className="landing-points">
        <li>
          <div className="process-art" aria-hidden="true">
            <Image src="/illustrations/process-capture.png" alt="" width={1254} height={1254} sizes="(max-width: 48rem) 280px, 340px" />
          </div>
          <p className="process-number" aria-hidden="true">01 / capture</p>
          <h3>capture the page</h3>
          <p>
            Every address you list is captured on desktop and mobile as a full
            static page, with a small map of what is where.
          </p>
        </li>
        <li>
          <div className="process-art" aria-hidden="true">
            <Image src="/illustrations/process-annotate.png" alt="" width={1254} height={1254} sizes="(max-width: 48rem) 280px, 340px" />
          </div>
          <p className="process-number" aria-hidden="true">02 / annotate</p>
          <h3>pin it where it happens</h3>
          <p>
            Drop a pin, draw a box or a circle, or point an arrow, and say what
            you mean in a line. Each mark stays on its pixel at any zoom.
          </p>
        </li>
        <li>
          <div className="process-art" aria-hidden="true">
            <Image src="/illustrations/process-share.png" alt="" width={1254} height={1254} sizes="(max-width: 48rem) 280px, 340px" />
          </div>
          <p className="process-number" aria-hidden="true">03 / share</p>
          <h3>send one link</h3>
          <p>
            The founder opens it without an account, reads each note in place,
            and replies. You see the reply without reloading.
          </p>
        </li>
      </ul>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <div className="footer-mascot" aria-hidden="true">
          <Image src="/illustrations/mascot-resting.png" alt="" width={1254} height={1254} sizes="112px" />
        </div>
        <p>pinata<span>a little feedback goes a long way.</span></p>
      </div>
      <div>
        <h2>product</h2>
        <ul>
          <li>
            <Link href="/walkthrough" className="quiet-link">
              the ten-chapter walkthrough
            </Link>
          </li>
          <li>
            <a href="#editor-login" className="quiet-link">
              editor sign in
            </a>
          </li>
        </ul>
      </div>
      <div>
        <h2>how it's built</h2>
        <LandingLinks />
      </div>
      <p className="footer-note">
        Public pages only, static captures only, directional feedback only.
      </p>
    </footer>
  );
}

/**
 * The hero's way in for a visitor: sign in to start a review. There is no
 * address field before sign-in (D103); the form lives on /pins/new.
 */
function LandingCta() {
  return (
    <p className="landing-cta">
      <a className="button-link button-primary" href="#editor-login">
        Sign in to start a review
      </a>
      <a className="quiet-link" href="#example-heading">
        see an example →
      </a>
    </p>
  );
}

/** The anonymous landing: bar, hero + sign-in call, the static example,
 * how it works, sign-in, and the footer. */
export function AnonymousLanding() {
  return (
    <main className="home-main home-main--landing">
      {/* Decorative halftone washes in the piñata orange (D119): pure CSS,
          no image, behind the hero and the sign-in. */}
      <div className="landing-halftone landing-halftone--hero" aria-hidden="true">
        <span className="landing-halftone-glow" />
      </div>
      <SiteBar />
      <div className="illustrated-hero">
        <LandingHero showMark={false}>
          <LandingCta />
        </LandingHero>
        <div className="hero-art" aria-hidden="true">
          <Image src="/illustrations/hero.png" alt="" width={1536} height={1024} sizes="(max-width: 60rem) 92vw, 560px" preload />
          <span className="hero-art-caption">a little note. right where it matters.</span>
        </div>
      </div>
      <HowItWorks />
      <ExampleCapture />
      <div className="landing-invitation">
        <div className="landing-halftone landing-halftone--card" aria-hidden="true">
          <span className="landing-halftone-glow" />
        </div>
        <div className="invitation-copy">
          <p className="section-eyebrow">your next good idea starts here</p>
          <h2>got notes?<br />let’s pin them.</h2>
          <p>Give your feedback a place to land.</p>
          <Image src="/illustrations/mascot-pencil.png" alt="" width={1254} height={1254} sizes="(max-width: 48rem) 140px, 200px" />
        </div>
        <LoginForm />
      </div>
      <SiteFooter />
    </main>
  );
}
