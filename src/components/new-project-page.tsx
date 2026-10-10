"use client";

// The /pins/new surface (D069): the branded hero with the project form
// active. It is the only place a project is created: the public landing no
// longer takes an address before sign-in (D103).
//
// Creating a project routes to /pins. The workspace's dispatch driver picks
// the freshly committed pending attempts up on that load, so no capture is
// orphaned by leaving this page.
//
// Below the form, a project can also start from a capture file (D131): a
// screen behind a sign-in, captured by the Pinata Chrome extension, which
// Pinata could not have visited itself. That project has no pending
// attempts; the upload is already its first ready capture.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LandingHero } from "./landing";
import { ProjectCreateForm } from "./project-create-form";
import { UploadPanel } from "./upload-capture";

export function NewProjectPage() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
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
        <section className="new-project-upload" aria-label="Start from a capture file">
          {uploading ? (
            <UploadPanel
              mode={{ kind: "new-project" }}
              onCancel={() => setUploading(false)}
              onPartial={(result) =>
                router.push(`/pins?project=${encodeURIComponent(result.project.publicId)}`)
              }
              onUploaded={(result) =>
                router.push(`/pins?project=${encodeURIComponent(result.project.publicId)}`)
              }
            />
          ) : (
            <p>
              Behind a sign-in?{" "}
              <button
                type="button"
                className="link-button"
                data-testid="start-from-capture"
                onClick={() => setUploading(true)}
              >
                Start from a capture file
              </button>{" "}
              made with the Pinata Chrome extension, or from a screenshot.
            </p>
          )}
        </section>
      </LandingHero>
      <p className="home-nav">
        <Link href="/pins">Back to pins</Link>
      </p>
    </main>
  );
}
