import { redirect } from "next/navigation";
import { AnonymousLanding } from "../src/components/landing";
import { hasEditorSession } from "../src/lib/server/auth/editor-page";

// The root route is the public front door (VAL-LANDING-*, D066/D069): the
// pinata mark above the URL capture entry, a brief value proposition, a
// fully static example of a marked-up capture, the sign-in prompt, and the
// hub links. It carries no editor data at all.
//
// It is still the authorization boundary, but the boundary now moves the
// visitor instead of swapping the page body: a verified editor session is
// sent straight to the workspace at /pins (D069), so the marketing surface
// and the working surface never compete for the same screen.
export default async function Page() {
  if (await hasEditorSession()) {
    redirect("/pins");
  }
  return <AnonymousLanding />;
}
