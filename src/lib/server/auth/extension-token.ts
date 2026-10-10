// Server-only sign-in tokens for the Chrome extension (D132).
//
// The extension cannot use the editor's cookies: its requests come from its
// own origin, and the session cookie is SameSite=Strict with a same-origin
// check on every write. So signing in from the extension returns a bearer
// token instead, which the extension keeps in its own storage and sends in
// the Authorization header. A bearer header is never attached by a browser on
// its own, so a token request needs no CSRF proof and no Origin check.
//
// The token is the editor session's shape with its own version prefix and an
// audience: `x1.<payload>.<HMAC-SHA256>` over the same SESSION_SECRET. The
// prefix is part of what is signed, so a cookie token can never verify here
// and an extension token can never verify as a cookie. Lifetime and renewal
// follow the editor session policy (D130): 7 days, renewed once a day old.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
  EDITOR_SESSION_RENEWAL_THRESHOLD_MS,
} from "../../boundaries";

const TOKEN_VERSION = "x1";

/** The audience every extension token carries. */
export const EXTENSION_TOKEN_AUDIENCE = "extension";

/** Signed extension token payload. */
export interface ExtensionTokenPayload {
  v: 1;
  aud: typeof EXTENSION_TOKEN_AUDIENCE;
  /** Random token id; signing out of the extension revokes it. */
  sid: string;
  /** Issued-at, epoch milliseconds. */
  iat: number;
  /** Absolute expiry, epoch milliseconds. Never valid at or past this. */
  exp: number;
}

export type ExtensionTokenVerification =
  | { status: "valid"; payload: ExtensionTokenPayload; renew: boolean }
  | { status: "invalid" };

const INVALID: ExtensionTokenVerification = { status: "invalid" };

function sign(payloadPart: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payloadPart).digest();
}

function encode(payload: ExtensionTokenPayload, secret: string): string {
  const payloadPart = `${TOKEN_VERSION}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${payloadPart}.${sign(payloadPart, secret).toString("base64url")}`;
}

function isPayload(value: unknown): value is ExtensionTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === 1 &&
    p.aud === EXTENSION_TOKEN_AUDIENCE &&
    typeof p.sid === "string" &&
    p.sid.length > 0 &&
    typeof p.iat === "number" &&
    Number.isFinite(p.iat) &&
    typeof p.exp === "number" &&
    Number.isFinite(p.exp)
  );
}

/**
 * Signed-out token ids, remembered until their absolute expiry. Like editor
 * logout, this is authoritative within one application instance; the
 * extension also forgets the token itself, which is what actually ends it
 * for the one person who holds it.
 */
const revokedTokenIds = new Map<string, number>();

/** Mark a token id as signed out until its absolute expiry. */
export function revokeExtensionToken(sid: string, exp: number): void {
  revokedTokenIds.set(sid, exp);
  const now = Date.now();
  for (const [id, idExp] of revokedTokenIds) {
    if (now >= idExp) revokedTokenIds.delete(id);
  }
}

function isRevoked(sid: string, now: number): boolean {
  const exp = revokedTokenIds.get(sid);
  if (exp === undefined) return false;
  if (now >= exp) {
    revokedTokenIds.delete(sid);
    return false;
  }
  return true;
}

/** Test-only helper: forget all revocations. */
export function __clearRevokedExtensionTokensForTests(): void {
  revokedTokenIds.clear();
}

/** Create a fresh signed extension token at `now` (epoch ms). */
export function createExtensionToken(
  secret: string,
  now: number,
): { token: string; payload: ExtensionTokenPayload } {
  const payload: ExtensionTokenPayload = {
    v: 1,
    aud: EXTENSION_TOKEN_AUDIENCE,
    sid: randomBytes(16).toString("base64url"),
    iat: now,
    exp: now + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
  };
  return { token: encode(payload, secret), payload };
}

/**
 * Verify an extension token against `secret` at `now`. Forged, tampered,
 * malformed, expired, revoked, and cookie-session tokens are all "invalid";
 * nothing throws. A valid token carries `renew: true` inside the published
 * renewal threshold.
 */
export function verifyExtensionToken(
  token: string,
  secret: string,
  now: number,
): ExtensionTokenVerification {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return INVALID;
  const payloadPart = `${parts[0]}.${parts[1]}`;
  const expected = sign(payloadPart, secret);
  const provided = Buffer.from(parts[2]!, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return INVALID;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    return INVALID;
  }
  if (!isPayload(payload)) return INVALID;
  if (now >= payload.exp) return INVALID;
  if (isRevoked(payload.sid, now)) return INVALID;
  return {
    status: "valid",
    payload,
    renew: payload.exp - now <= EDITOR_SESSION_RENEWAL_THRESHOLD_MS,
  };
}

/** Renew a valid token: the same id with a fresh absolute expiry from `now`. */
export function renewExtensionToken(
  payload: ExtensionTokenPayload,
  secret: string,
  now: number,
): { token: string; payload: ExtensionTokenPayload } {
  const renewed: ExtensionTokenPayload = {
    ...payload,
    iat: now,
    exp: now + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
  };
  return { token: encode(renewed, secret), payload: renewed };
}

/** The bearer token in an Authorization header, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9._-]{1,2048})$/.exec(header.trim());
  return match ? match[1]! : null;
}
