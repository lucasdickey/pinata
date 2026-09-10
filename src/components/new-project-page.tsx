"use client";

// The /pins/new surface (D069): the branded hero with the project form
// active, and nothing else. A parked anonymous capture draft (D067) is
// consumed here exactly once, so the anonymous entry → sign-in → create
// handoff still works with the sign-in redirect landing on /pins first.
//
// Creating a project routes to /pins. The workspace's dispatch driver picks
// the freshly committed pending attempts up on that load, so no capture is
// orphaned by leaving this page.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { takeCaptureDraft, type CaptureDraft } from "../lib/capture-draft";
import { LandingHero } from "./landing";
import { ProjectCreateForm } from "./project-create-form";

export function NewProjectPage() {
  const router = useRouter();
  // Read after mount only — sessionStorage does not exist during SSR. The
  // `current ?? take` shape survives a StrictMode double-effect: the first
  // read wins and the consumed key stays empty.
  const [draftChecked, setDraftChecked] = useState(false);
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  useEffect(() => {
    setDraft((current) => current ?? takeCaptureDraft());
    setDraftChecked(true);
  }, []);

  return (
    <main className="home-main">
      <LandingHero>
        {draftChecked ? (
          <ProjectCreateForm
            initial={draft ?? undefined}
            onCreated={() => {
              // The transaction already committed; /pins re-reads the
              // hierarchy from the server rather than trusting this response.
              router.push("/pins");
            }}
            onCancel={() => setDraft(null)}
          />
        ) : null}
      </LandingHero>
      <p className="home-nav">
        <Link href="/pins">Back to pins</Link>
      </p>
    </main>
  );
}
