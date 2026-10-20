// The branded landing page composition (VAL-LANDING-001/002, D066). The same
// hero — the pinata mark directly above the URL capture entry, with a brief
// value proposition — opens the page for everyone: anonymous visitors get the
// parking CaptureEntryForm, the static example render, and the sign-in path;
// a signed-in editor gets the always-active project form with the project
// list below (see editor-home.tsx). Kept free of server-only APIs so the
// same components render under React Testing Library in jsdom.

import Link from "next/link";
import type { ReactNode } from "react";
import { REQUIREMENTS_NAV } from "../lib/requirements";
import { CaptureEntryForm } from "./capture-entry-form";
import { ExampleCapture, ExampleShowcase } from "./example-capture";
import { LoginForm } from "./login-form";
import { PinataLogo } from "./pinata-logo";

/**
 * The hero: logo, wordmark, and value proposition above whichever capture
 * form the visitor's role gets. The logo is the last hero element before the
 * form region, so the mark sits directly above the capture entry.
 */
export function LandingHero({ children }: { children: ReactNode }) {
  return (
    <header className="landing-hero">
      <PinataLogo />
      <h1>pinata</h1>
      <p className="landing-tagline">
        <strong>pin</strong> + <strong>annotate</strong> + at <strong>ya</strong>
      </p>
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

/**
 * The anonymous landing (D149). A top bar carries the two audiences' routes
 * (the project docs for a reviewer, sign-in for the editor), so neither
 * waits at the bottom of the page. The hero is two columns: the pitch with
 * the mark directly above the capture entry on the left, the product itself
 * on the right. What a pin carries follows, then sign-in and the walkthrough
 * side by side.
 */
export function AnonymousLanding() {
  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <Link href="/" className="wordmark">
            pinata
          </Link>
          <LandingLinks />
          <p className="site-header-actions">
            <Link href="/walkthrough">Walkthrough</Link>
            <a href="#editor-login" className="button-link">
              Sign in
            </a>
          </p>
        </div>
      </header>
      <main className="home-main home-landing">
        <div className="landing-top">
          <LandingHero>
            <CaptureEntryForm />
          </LandingHero>
          <ExampleShowcase />
        </div>
        <ExampleCapture />
        <div className="landing-bottom">
          <LoginForm />
          <div className="landing-card home-walkthrough">
            <h2>New here?</h2>
            <p>
              <Link href="/walkthrough">Watch the ten-chapter walkthrough</Link> of what Pinata
              is and how it works.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
