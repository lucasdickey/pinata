// Server-only editor authorization for page routes (D069). The root landing,
// the /pins workspace, and the /pins/new project form are three routes that
// must agree exactly on who counts as a signed-in editor; splitting them
// apart (D069) made a single shared predicate the only safe way to keep the
// boundary from drifting between them.
//
// Verification is always server-side against SESSION_SECRET. The local-only
// bypass (PINATA_AUTH_DISABLED=1, D052) short-circuits to "editor" exactly as
// it did when the landing page carried this check inline.

import { cookies } from "next/headers";
import { EDITOR_SESSION_COOKIE } from "../../auth-constants";
import { isAuthDisabled } from "./bypass";
import { getSessionSecret } from "./secrets";
import { verifyEditorSessionToken } from "./session";

/** True when the request carries a verified editor session. */
export async function hasEditorSession(): Promise<boolean> {
  if (isAuthDisabled()) return true;
  const jar = await cookies();
  const token = jar.get(EDITOR_SESSION_COOKIE)?.value;
  const secret = getSessionSecret();
  if (!token || !secret) return false;
  const result = verifyEditorSessionToken(token, secret, Date.now());
  return result.status === "valid";
}
