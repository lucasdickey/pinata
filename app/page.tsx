import { cookies } from "next/headers";
import { EditorHome } from "../src/components/editor-home";
import { AnonymousLanding } from "../src/components/landing";
import { EDITOR_SESSION_COOKIE } from "../src/lib/auth-constants";
import { isAuthDisabled } from "../src/lib/server/auth/bypass";
import { getSessionSecret } from "../src/lib/server/auth/secrets";
import { verifyEditorSessionToken } from "../src/lib/server/auth/session";

// The root route is the branded landing page for everyone (VAL-LANDING-*,
// D066): the pinata mark directly above the URL capture entry, a brief value
// proposition, and a fully static example of a marked-up capture. It is also
// the authorization boundary for the editor surface: a clean browser gets the
// parking entry form plus the sign-in prompt and no editor data; a verified
// session gets the same landing with the project form active and the project
// list below. Verification is always server-side against SESSION_SECRET. The
// local-only bypass (PINATA_AUTH_DISABLED=1, D052) renders the editor shell
// directly.
export default async function Page() {
  if (isAuthDisabled()) {
    return <EditorHome />;
  }
  const jar = await cookies();
  const token = jar.get(EDITOR_SESSION_COOKIE)?.value;
  const secret = getSessionSecret();
  const result =
    token && secret ? verifyEditorSessionToken(token, secret, Date.now()) : null;

  if (result && result.status === "valid") {
    return <EditorHome />;
  }
  return <AnonymousLanding />;
}
