import { cookies } from "next/headers";
import { EditorHome } from "../src/components/editor-home";
import { Home } from "../src/components/home";
import { LoginForm } from "../src/components/login-form";
import { EDITOR_SESSION_COOKIE } from "../src/lib/auth-constants";
import { getSessionSecret } from "../src/lib/server/auth/secrets";
import { verifyEditorSessionToken } from "../src/lib/server/auth/session";

// The landing route is the authorization boundary for the whole editor
// surface: a clean browser gets product framing plus one password prompt and
// no editor data; a verified session gets the editor shell. Verification is
// always server-side against SESSION_SECRET.
export default async function Page() {
  const jar = await cookies();
  const token = jar.get(EDITOR_SESSION_COOKIE)?.value;
  const secret = getSessionSecret();
  const result =
    token && secret ? verifyEditorSessionToken(token, secret, Date.now()) : null;

  if (result && result.status === "valid") {
    return <EditorHome />;
  }
  return (
    <>
      <Home />
      <LoginForm />
    </>
  );
}
