// Server-only founder capability sessions: HMAC-SHA256-signed payloads that
// bind a session to one project and one capability version, mirroring the
// editor session code (src/lib/server/auth/session.ts) with the same
// lifetime and renewal policy from the boundary catalog.
//
// The token prefix differs from the editor's ("f1" versus "v1") and the
// signature covers that prefix, so an editor session can never verify as a
// founder session or the reverse. Rotation and revocation need no denylist:
// the guard re-checks the project row's version and revocation on every
// request (capability.ts), so a signed session for a superseded version is
// simply invalid.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
  EDITOR_SESSION_RENEWAL_THRESHOLD_MS,
} from "../../boundaries";

const TOKEN_VERSION = "f1";

/** Signed founder session payload. */
export interface FounderSessionPayload {
  v: 1;
  role: "founder";
  /** The project this capability session is bound to. */
  pid: string;
  /** The capability version the session was issued under. */
  ver: number;
  /** Random session id. */
  sid: string;
  /** Issued-at, epoch milliseconds. */
  iat: number;
  /** Absolute expiry, epoch milliseconds. Never valid at or past this. */
  exp: number;
  /** Random CSRF proof; the founder client echoes it on reply mutations. */
  csrf: string;
}

export type FounderSessionVerification =
  | { status: "valid"; payload: FounderSessionPayload; renew: boolean }
  | { status: "invalid" };

const INVALID: FounderSessionVerification = { status: "invalid" };

function sign(payloadPart: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payloadPart).digest();
}

function encode(payload: FounderSessionPayload, secret: string): string {
  const payloadPart = `${TOKEN_VERSION}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${payloadPart}.${sign(payloadPart, secret).toString("base64url")}`;
}

function isPayload(value: unknown): value is FounderSessionPayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === 1 &&
    p.role === "founder" &&
    typeof p.pid === "string" &&
    p.pid.length > 0 &&
    typeof p.ver === "number" &&
    Number.isInteger(p.ver) &&
    p.ver > 0 &&
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

/** Create a fresh signed founder session bound to a project and version. */
export function createFounderSession(
  secret: string,
  binding: { projectId: string; version: number },
  now: number,
): { token: string; payload: FounderSessionPayload } {
  const payload: FounderSessionPayload = {
    v: 1,
    role: "founder",
    pid: binding.projectId,
    ver: binding.version,
    sid: randomBytes(16).toString("base64url"),
    iat: now,
    exp: now + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
    csrf: randomBytes(16).toString("base64url"),
  };
  return { token: encode(payload, secret), payload };
}

/**
 * Verify a founder session token against `secret` at `now`. Forged,
 * tampered, malformed, editor-shaped, and expired tokens are all "invalid";
 * nothing throws. The project/version binding is checked separately against
 * the durable row (capability.ts), because that is what rotation changes.
 */
export function verifyFounderSessionToken(
  token: string,
  secret: string,
  now: number,
): FounderSessionVerification {
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
  return {
    status: "valid",
    payload,
    renew: payload.exp - now <= EDITOR_SESSION_RENEWAL_THRESHOLD_MS,
  };
}

/** Renew a valid founder session: fresh expiry, same binding and proofs. */
export function renewFounderSessionToken(
  payload: FounderSessionPayload,
  secret: string,
  now: number,
): string {
  return encode(
    { ...payload, iat: now, exp: now + EDITOR_SESSION_ABSOLUTE_LIFETIME_MS },
    secret,
  );
}
