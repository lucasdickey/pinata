// The branded landing page composition (VAL-LANDING-001/002, D066). The same
// hero — the pinata mark directly above the URL capture entry, with a brief
// value proposition — opens the page for everyone: anonymous visitors get the
// parking CaptureEntryForm, the static example render, and the sign-in path;
// a signed-in editor gets the always-active project form with the project
// list below (see editor-home.tsx). Kept free of server-only APIs so the
// same components render under React Testing Library in jsdom.

import Link from "next/link";
import type { ReactNode } from "react";
import { CaptureEntryForm } from "./capture-entry-form";
import { ExampleCapture } from "./example-capture";
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

export function LandingLinks() {
  return (
    <p className="home-nav">
      <Link href="/reqs">Requirements, architecture, milestones, decisions, and evals</Link>
    </p>
  );
}

/** The anonymous landing: hero + parked-entry form, static example, sign-in. */
export function AnonymousLanding() {
  return (
    <main className="home-main">
      <LandingHero>
        <CaptureEntryForm />
      </LandingHero>
      <ExampleCapture />
      <LoginForm />
      <LandingLinks />
    </main>
  );
}
