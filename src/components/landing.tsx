import Link from "next/link";
import Image from "next/image";
import { REQUIREMENTS_NAV } from "../lib/requirements";
import { DemoVideo } from "./demo-video";
import { ExampleCapture } from "./example-capture";
import { PinataLogo } from "./pinata-logo";
import { SignInButton, SignInProvider } from "./sign-in-dialog";
import { ThemeToggle } from "./theme-toggle";

function LandingHero() {
  return (
    <header className="landing-hero">
      <p className="landing-eyebrow">
        <strong>Pin</strong> + <strong>annotate</strong> + at{" "}
        <strong>ya</strong>
      </p>
      <h1>Pinata</h1>
      <p className="landing-statement">
        Mark up a page. Hand it off.
      </p>
      <p className="landing-prop">
        Capture a public page, pin feedback to the spot, then send it to a
        coding agent or a friend. An agent reads a structured brief; a friend
        can reply on the page. Pinata does not make the edits.
      </p>
      <LandingCta />
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
      <Link href="/" className="site-mark" aria-label="Pinata home">
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
            <SignInButton className="link-button">Sign in</SignInButton>
          </li>
          <li>
            <ThemeToggle />
          </li>
        </ul>
      </nav>
    </div>
  );
}

/**
 * The demo video, first thing under the hero (D140): the whole loop, filmed
 * in the product, which shows Pinata better than any illustration can.
 */
function DemoSection() {
  return (
    <section className="landing-section landing-demo" aria-labelledby="demo-heading">
      <p className="section-eyebrow">Watch a review</p>
      <h2 id="demo-heading">One page, start to finish</h2>
      <DemoVideo />
    </section>
  );
}

/** The three steps, in the landing's point format: a short title, one line. */
function HowItWorks() {
  return (
    <section className="landing-section" aria-labelledby="how-heading">
      <p className="section-eyebrow">How it works</p>
      <h2 id="how-heading">A two-minute comment should take two minutes</h2>
      <ul className="landing-points">
        <li>
          <div className="process-art" aria-hidden="true">
            <Image
              src="/illustrations/process-capture.png"
              alt=""
              width={1254}
              height={1254}
              sizes="(max-width: 48rem) 280px, 340px"
            />
          </div>
          <p className="process-number" aria-hidden="true">
            01 / Capture
          </p>
          <h3>Capture the page</h3>
          <p>
            Every address you list is captured on desktop and mobile as a full
            static page, with a small map of what is where.
          </p>
        </li>
        <li>
          <div className="process-art" aria-hidden="true">
            <Image
              src="/illustrations/process-annotate.png"
              alt=""
              width={1254}
              height={1254}
              sizes="(max-width: 48rem) 280px, 340px"
            />
          </div>
          <p className="process-number" aria-hidden="true">
            02 / Annotate
          </p>
          <h3>Pin it where it happens</h3>
          <p>
            Drop a pin, draw a box or a circle, or point an arrow, and say what
            you mean in a line. Each mark stays on its pixel at any zoom.
          </p>
        </li>
        <li>
          <div className="process-art" aria-hidden="true">
            <Image
              src="/illustrations/process-share.png"
              alt=""
              width={1254}
              height={1254}
              sizes="(max-width: 48rem) 280px, 340px"
            />
          </div>
          <p className="process-number" aria-hidden="true">
            03 / Share
          </p>
          <h3>Hand it to an agent or friend</h3>
          <p>
            Choose a coding-agent brief, a person review link, or project
            Markdown. Links appear only when you create them.
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
          <Image
            src="/illustrations/mascot-resting.png"
            alt=""
            width={1254}
            height={1254}
            sizes="112px"
          />
        </div>
        <p>
          Pinata<span>A little feedback goes a long way.</span>
        </p>
      </div>
      <div>
        <h2>Product</h2>
        <ul>
          <li>
            <Link href="/walkthrough" className="quiet-link">
              The ten-chapter walkthrough
            </Link>
          </li>
          <li>
            <SignInButton className="link-button quiet-link">
              Editor sign in
            </SignInButton>
          </li>
        </ul>
      </div>
      <div>
        <h2>How it's built</h2>
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
      <SignInButton className="button-link button-primary">
        Sign in to start a review
      </SignInButton>
      <a className="quiet-link" href="#example-heading">
        See an example →
      </a>
    </p>
  );
}

/** The anonymous landing: bar, hero + sign-in call, the demo video, how it
 * works, the static example, sign-in, and the footer. */
export function AnonymousLanding() {
  return (
    <SignInProvider>
      <main className="home-main home-main--landing">
        {/* Decorative halftone washes in the piñata orange (D119): pure CSS,
          no image, behind the hero and the sign-in. */}
        <div
          className="landing-halftone landing-halftone--hero"
          aria-hidden="true"
        >
          <span className="landing-halftone-glow" />
        </div>
        <SiteBar />
        <div className="illustrated-hero">
          <LandingHero />
          <div className="hero-art" aria-hidden="true">
            <Image
              src="/illustrations/hero.png"
              alt=""
              width={1536}
              height={1024}
              sizes="(max-width: 60rem) 92vw, 560px"
              preload
            />
            <span className="hero-art-caption">
              A little note. Right where it matters.
            </span>
          </div>
        </div>
        <DemoSection />
        <HowItWorks />
        <ExampleCapture />
        <div className="landing-invitation">
          <div
            className="landing-halftone landing-halftone--card"
            aria-hidden="true"
          >
            <span className="landing-halftone-glow" />
          </div>
          <div className="invitation-copy">
            <p className="section-eyebrow">Your next good idea starts here</p>
            <h2>
              Got notes?
              <br />
              Let’s pin them.
            </h2>
            <p>Give your feedback a place to land.</p>
          </div>
          <div className="invitation-mascot" aria-hidden="true">
            <Image
              src="/illustrations/mascot-pencil.png"
              alt=""
              width={1254}
              height={1254}
              sizes="(max-width: 48rem) 120px, 140px"
            />
          </div>
          <div className="invitation-sign-in">
            <SignInButton className="button-link button-primary">
              Sign in
            </SignInButton>
            <p>
              Editors sign in with the one password. Founders open the private
              link they were sent.
            </p>
          </div>
        </div>
        <SiteFooter />
      </main>
    </SignInProvider>
  );
}
