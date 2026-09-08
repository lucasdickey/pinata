// Server-only cookie serialization for the editor session. Attributes follow
// the published policy: HttpOnly session cookie, SameSite=Strict, path /,
// Secure when the request arrived over HTTPS (i.e. deployed), and a Max-Age
// matching the absolute session lifetime. Clearing uses matching attributes
// so browsers actually honor the removal.

import { EDITOR_SESSION_ABSOLUTE_LIFETIME_MS } from "../../boundaries";
import { EDITOR_CSRF_COOKIE, EDITOR_SESSION_COOKIE } from "../../auth-constants";

const MAX_AGE_SECONDS = EDITOR_SESSION_ABSOLUTE_LIFETIME_MS / 1000;

function scopedAttributes(secure: boolean): string {
  return `Path=/; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/** Session cookie: HttpOnly, SameSite=Strict, path /, Secure when deployed. */
export function sessionCookie(token: string, secure: boolean): string {
  return `${EDITOR_SESSION_COOKIE}=${token}; ${scopedAttributes(secure)}; Max-Age=${MAX_AGE_SECONDS}; HttpOnly`;
}

/** CSRF double-submit cookie: browser-readable so client JS can echo it. */
export function csrfCookie(value: string, secure: boolean): string {
  return `${EDITOR_CSRF_COOKIE}=${value}; ${scopedAttributes(secure)}; Max-Age=${MAX_AGE_SECONDS}`;
}

/** Expire the session cookie with attributes matching its original scope. */
export function clearSessionCookie(secure: boolean): string {
  return `${EDITOR_SESSION_COOKIE}=; ${scopedAttributes(secure)}; Max-Age=0; HttpOnly`;
}

/** Expire the CSRF cookie with attributes matching its original scope. */
export function clearCsrfCookie(secure: boolean): string {
  return `${EDITOR_CSRF_COOKIE}=; ${scopedAttributes(secure)}; Max-Age=0`;
}
