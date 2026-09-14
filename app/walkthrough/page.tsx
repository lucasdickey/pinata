import type { Metadata } from "next";
import Link from "next/link";
import { WalkthroughPlayer } from "../../src/components/walkthrough-player";

export const metadata: Metadata = {
  title: "pinata — walkthrough",
  description: "A ten-chapter walkthrough of what Pinata is and how it works.",
};

// The interactive walkthrough (D072): a Remotion composition played in the
// browser, with a chapter list that jumps the player between slides and the
// transcript for the chapter on screen. Public and anonymous, like /reqs.
export default function WalkthroughPage() {
  return (
    <div className="walkthrough-shell">
      <header className="reqs-header">
        <Link href="/" className="wordmark">
          pinata
        </Link>
        <nav className="reqs-nav" aria-label="Walkthrough">
          <ul>
            <li>
              <Link href="/walkthrough" aria-current="page">
                Walkthrough
              </Link>
            </li>
            <li>
              <Link href="/reqs">Requirements</Link>
            </li>
          </ul>
        </nav>
      </header>
      <main>
        <WalkthroughPlayer />
      </main>
    </div>
  );
}
