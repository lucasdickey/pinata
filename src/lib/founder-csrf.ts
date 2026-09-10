// Client-side reader for the founder double-submit CSRF proof: a non-secret
// per-session nonce the server issued in a browser-readable cookie at token
// exchange time. Founder reply mutations echo it in EDITOR_CSRF_HEADER.

import { FOUNDER_CSRF_COOKIE } from "./auth-constants";

export function readFounderCsrfProof(): string {
  if (typeof document === "undefined") return "";
  const prefix = `${FOUNDER_CSRF_COOKIE}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return "";
}
