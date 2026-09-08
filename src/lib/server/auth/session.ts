// Server-only editor session tokens: HMAC-SHA256-signed payloads with an
// explicit version, issued-at, absolute expiry, session id, and a bound CSRF
// proof. Lifetime and renewal policy come from the boundary catalog
// (VAL-AUTH-003); tests inject the clock.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
  EDITOR_SESSION_RENEWAL_THRESHOLD_MS,
} from "../../boundaries";

const TOKEN_VERSION = "v1";

/** Signed editor session payload. */
export interface EditorSessionPayload {
  v: 1;
  /** Random session id; revocation (logout) is keyed on it. */
  sid: string;
  /** Issued-at, epoch milliseconds. */
  iat: number;
  /** Absolute expiry, epoch milliseconds. Never valid at or past this. */
  exp: number;
  /** Random CSRF proof; clients echo it in the CSRF header on mutations. */
  csrf: string;
}

export type SessionVerification =
  | { status: "valid"; payload: EditorSessionPayload; renew: boolean }
  | { status: "invalid" };

const INVALID: SessionVerification = { status: "invalid" };

function sign(payloadPart: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payloadPart).digest();
}

function encode(payload: EditorSessionPayload, secret: string): string {
  const payloadPart = `${TOKEN_VERSION}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${payloadPart}.${sign(payloadPart, secret).toString("base64url")}`;
}

function isPayload(value: unknown): value is EditorSessionPayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.sid === "string" &&
    p.sid.length > 0 &&
    typeof p.csrf === "string" &&
    p.csrf.length > 0 &&
    typeof p.iat === "number" &&
    Number.isFinite(p.iat) &&
    typeof p.exp === "number" &&
    Number.isFinite(p.exp)
  );
}

/**
 * Logged-out session ids, remembered until their absolute expiry. Logout is
 * authoritative within this application instance: a revoked session id fails
 * verification even when its signature and expiry are otherwise valid.
 */
const revokedSessionIds = new Map<string, number>();

/** Mark a session id as logged out until its absolute expiry. */
export function revokeEditorSession(sid: string, exp: number): void {
  revokedSessionIds.set(sid, exp);
  // Opportunistically prune entries whose sessions can no longer be valid.
  const now = Date.now();
  for (const [id, idExp] of revokedSessionIds) {
    if (now >= idExp) revokedSessionIds.delete(id);
  }
}

function isRevoked(sid: string, now: number): boolean {
  const exp = revokedSessionIds.get(sid);
  if (exp === undefined) return false;
  if (now >= exp) {
    revokedSessionIds.delete(sid);
    return false;
  }
  return true;
}

/** Test-only helper: forget all revocations. */
export function __clearRevokedSessionsForTests(): void {
  revokedSessionIds.clear();
}

/** Create a fresh signed editor session at `now` (epoch ms). */
export function createEditorSession(
  secret: string,
  now: number,
): { token: string; payload: EditorSessionPayload } {
  const payload: EditorSessionPayload = {
    v: 1,
    sid: randomBytes(16).toString("base64url"),
    iat: now,
    exp: now + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
    csrf: randomBytes(16).toString("base64url"),
  };
  return { token: encode(payload, secret), payload };
}

/**
 * Verify a session token against `secret` at `now` (epoch ms). Forged,
 * tampered, malformed, expired, and revoked tokens are all "invalid"; nothing
 * throws. A valid token carries `renew: true` when its remaining lifetime is
 * inside the published renewal threshold.
 */
export function verifyEditorSessionToken(
  token: string,
  secret: string,
  now: number,
): SessionVerification {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return INVALID;
  const payloadPart = `${parts[0]}.${parts[1]}`;
  const expected = sign(payloadPart, secret);
  const provided = Buffer.from(parts[2], "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return INVALID;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
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

/**
 * Renew a valid session: fresh absolute expiry from `now`, same session id
 * and CSRF proof so the double-submit pair stays consistent.
 */
export function renewEditorSessionToken(
  payload: EditorSessionPayload,
  secret: string,
  now: number,
): string {
  return encode(
    { ...payload, iat: now, exp: now + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS },
    secret,
  );
}
