// Server-only cookie serialization for the founder capability session, with
// exactly the editor session's attribute policy: HttpOnly session cookie,
// SameSite=Strict, path /, Secure when the request arrived over HTTPS, and a
// Max-Age matching the absolute session lifetime. The CSRF cookie is
// browser-readable so the founder client can echo the double-submit proof.

import { EDITOR_SESSION_ABSOLUTE_LIFETIME_MS } from "../../boundaries";
import { FOUNDER_CSRF_COOKIE, FOUNDER_SESSION_COOKIE } from "../../auth-constants";
import { appendSetCookies, type SessionRenewal } from "../auth/cookies";

const MAX_AGE_SECONDS = EDITOR_SESSION_ABSOLUTE_LIFETIME_MS / 1000;

function scopedAttributes(secure: boolean): string {
  return `Path=/; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/** Founder session cookie: HttpOnly, SameSite=Strict, path /, Secure when deployed. */
export function founderSessionCookie(token: string, secure: boolean): string {
  return `${FOUNDER_SESSION_COOKIE}=${token}; ${scopedAttributes(secure)}; Max-Age=${MAX_AGE_SECONDS}; HttpOnly`;
}

/** Founder CSRF double-submit cookie: browser-readable so client JS can echo it. */
export function founderCsrfCookie(value: string, secure: boolean): string {
  return `${FOUNDER_CSRF_COOKIE}=${value}; ${scopedAttributes(secure)}; Max-Age=${MAX_AGE_SECONDS}`;
}

/**
 * Both founder cookies for a renewed session, each with a fresh Max-Age, for
 * the same reason as the editor pair (D098): a renewed session whose CSRF
 * cookie still expires on the original schedule loses every reply.
 */
export function founderRenewalCookies(renewal: SessionRenewal | null, secure: boolean): string[] {
  if (!renewal) return [];
  return [founderSessionCookie(renewal.token, secure), founderCsrfCookie(renewal.csrf, secure)];
}

/** Attach a renewed founder session's cookie pair when the guard issued one. */
export function appendFounderRenewal(
  response: Response,
  renewal: SessionRenewal | null,
  secure: boolean,
): Response {
  return appendSetCookies(response, founderRenewalCookies(renewal, secure));
}

/** Expire the founder session cookie with matching attributes. */
export function clearFounderSessionCookie(secure: boolean): string {
  return `${FOUNDER_SESSION_COOKIE}=; ${scopedAttributes(secure)}; Max-Age=0; HttpOnly`;
}

/** Expire the founder CSRF cookie with matching attributes. */
export function clearFounderCsrfCookie(secure: boolean): string {
  return `${FOUNDER_CSRF_COOKIE}=; ${scopedAttributes(secure)}; Max-Age=0`;
}
