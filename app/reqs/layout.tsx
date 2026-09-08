import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ReqsNav } from "../../src/components/reqs-nav";

export const metadata: Metadata = {
  title: { default: "pinata — requirements", template: "pinata — %s" },
  description: "Pinata's requirements, architecture, milestones, decisions, and evals.",
};

export default function ReqsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="reqs-shell">
      <header className="reqs-header">
        <Link href="/" className="wordmark">
          pinata
        </Link>
        <ReqsNav />
      </header>
      <main>{children}</main>
    </div>
  );
}
