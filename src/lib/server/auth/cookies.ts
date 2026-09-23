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

/**
 * A renewed session: the re-signed token plus the CSRF proof it still
 * carries (renewal keeps the proof, D024). The two travel together so a
 * renewal can only ever be written as the full double-submit pair.
 */
export interface SessionRenewal {
  token: string;
  csrf: string;
}

/**
 * Every Set-Cookie value a renewed editor session needs. Renewal extends the
 * session cookie's Max-Age, so the CSRF cookie has to be re-issued with it:
 * otherwise the browser drops the CSRF cookie at the original expiry while
 * the session lives on, and every write answers 403 while reads still work
 * (D098). Empty when there is nothing to renew.
 */
export function editorRenewalCookies(renewal: SessionRenewal | null, secure: boolean): string[] {
  if (!renewal) return [];
  return [sessionCookie(renewal.token, secure), csrfCookie(renewal.csrf, secure)];
}

/** Append Set-Cookie values in order; returns the same response. */
export function appendSetCookies(response: Response, values: readonly string[]): Response {
  for (const value of values) response.headers.append("set-cookie", value);
  return response;
}

/** Attach a renewed editor session's cookie pair when the guard issued one. */
export function appendEditorRenewal(
  response: Response,
  renewal: SessionRenewal | null,
  secure: boolean,
): Response {
  return appendSetCookies(response, editorRenewalCookies(renewal, secure));
}

/** Expire the session cookie with attributes matching its original scope. */
export function clearSessionCookie(secure: boolean): string {
  return `${EDITOR_SESSION_COOKIE}=; ${scopedAttributes(secure)}; Max-Age=0; HttpOnly`;
}

/** Expire the CSRF cookie with attributes matching its original scope. */
export function clearCsrfCookie(secure: boolean): string {
  return `${EDITOR_CSRF_COOKIE}=; ${scopedAttributes(secure)}; Max-Age=0`;
}
