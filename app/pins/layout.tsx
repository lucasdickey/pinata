// The editor's pages (/pins and /pins/new) share one addition: when the
// session expires mid-edit, a sign-in dialog opens in place and the refused
// request is retried once Lucas is back (D124).

import type { ReactNode } from "react";
import { SessionGuard } from "../../src/components/session-guard";

export default function PinsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SessionGuard />
    </>
  );
}
