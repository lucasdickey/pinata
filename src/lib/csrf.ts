// Client-side reader for the double-submit CSRF proof. The value is a
// non-secret per-session nonce the server issued in a browser-readable
// cookie; mutations echo it in EDITOR_CSRF_HEADER.

import { EDITOR_CSRF_COOKIE } from "./auth-constants";

export function readCsrfProof(): string {
  if (typeof document === "undefined") return "";
  const prefix = `${EDITOR_CSRF_COOKIE}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return "";
}
