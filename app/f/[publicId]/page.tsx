import type { Metadata } from "next";
import { FounderView } from "../../../src/components/founder-view";

// The founder capability page (REQUIREMENTS 7, ARCHITECTURE "Founder" and
// "Security boundaries"). The route is keyed by the non-secret public id;
// the capability token rides only in the URL fragment, which never reaches
// this server component — the client view exchanges it once through the
// same-origin session route. The page sends no referrer and permits no
// indexing; next.config.ts adds the matching response headers.

export const metadata: Metadata = {
  title: "pinata — founder review",
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function FounderPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <FounderView publicId={publicId} />;
}
