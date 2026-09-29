"use client";

// The /pins/new surface (D069): the branded hero with the project form
// active, and nothing else. It is the only place a project is created: the
// public landing no longer takes an address before sign-in (D103).
//
// Creating a project routes to /pins. The workspace's dispatch driver picks
// the freshly committed pending attempts up on that load, so no capture is
// orphaned by leaving this page.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LandingHero } from "./landing";
import { ProjectCreateForm } from "./project-create-form";

export function NewProjectPage() {
  const router = useRouter();
  return (
    <main className="home-main">
      <LandingHero>
        <ProjectCreateForm
          onCreated={() => {
            // The transaction already committed; /pins re-reads the
            // hierarchy from the server rather than trusting this response.
            router.push("/pins");
          }}
          // Clear form empties the fields in place; nothing else to undo.
          onCancel={() => undefined}
        />
      </LandingHero>
      <p className="home-nav">
        <Link href="/pins">Back to pins</Link>
      </p>
    </main>
  );
}
