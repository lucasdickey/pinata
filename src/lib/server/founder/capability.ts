// Server-only founder capability tokens (REQUIREMENTS 7, VAL-THREAD-005).
//
// A founder link is a bearer capability: 256 random bits, URL-safe, carried
// only in a URL fragment so it never reaches server logs, referrers, or
// history-synced query strings. The durable store holds nothing but the
// SHA-256 digest of the active token, a monotonic capability version that
// every founder session binds to, and the revocation instant. Rotation
// writes a fresh digest and increments the version, so every session issued
// under the old version stops verifying at once; revocation stamps
// share_revoked_at and clears the digest, so the exchange and every existing
// session fail closed while the project's history stays intact.
//
// Verification is timing-safe over fixed-length digests and never discloses
// which check failed: an unknown project, a tombstoned project, a revoked
// or never-issued capability, and a wrong token are all the same null.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type Database } from "../db/client";

/** Random bits per capability token: at least 256 (REQUIREMENTS 7). */
export const FOUNDER_TOKEN_BYTES = 32;

/** Base64url of FOUNDER_TOKEN_BYTES: exactly this many URL-safe characters. */
export const FOUNDER_TOKEN_LENGTH = 43;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A fresh capability token: 256 random bits, URL-safe, fragment-ready. */
export function generateFounderToken(): string {
  return randomBytes(FOUNDER_TOKEN_BYTES).toString("base64url");
}

/** True when the value has the exact shape a generated token has. */
export function isFounderTokenShaped(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** The only representation of a token the durable store ever holds. */
export function founderTokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type FounderShareState = "none" | "active" | "revoked";

/** The editor-facing status of a project's founder capability. */
export interface FounderShareStatus {
  state: FounderShareState;
  /** Monotonic capability version; 0 until the first link is issued. */
  version: number;
  revokedAt: number | null;
}

type ProjectRow = typeof schema.projects.$inferSelect;

/** Derive the share status from the persisted capability columns. */
export function shareStatusOf(project: {
  shareTokenDigest: string | null;
  shareTokenVersion: number;
  shareRevokedAt: number | null;
}): FounderShareStatus {
  if (project.shareRevokedAt !== null) {
    return {
      state: "revoked",
      version: project.shareTokenVersion,
      revokedAt: project.shareRevokedAt,
    };
  }
  if (project.shareTokenDigest === null) {
    return { state: "none", version: project.shareTokenVersion, revokedAt: null };
  }
  return { state: "active", version: project.shareTokenVersion, revokedAt: null };
}

async function loadLiveProjectByPublicId(
  db: Database,
  publicId: string,
): Promise<ProjectRow | null> {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.publicId, publicId))
    .limit(1);
  const project = rows[0];
  if (!project || project.deletedAt !== null) return null;
  return project;
}

/** A live project's share status by public id, or null when there is none. */
export async function readShareStatus(
  db: Database,
  publicId: string,
): Promise<FounderShareStatus | null> {
  const project = await loadLiveProjectByPublicId(db, publicId);
  return project ? shareStatusOf(project) : null;
}

export interface IssuedCapability {
  /** The raw token: returned exactly once, never persisted, never logged. */
  token: string;
  status: FounderShareStatus;
}

/**
 * Issue (create or rotate) the founder capability of one live project: a
 * fresh token whose digest replaces the old one, a version increment that
 * invalidates every existing founder session, and a cleared revocation so a
 * revoked project can be re-shared. Null when the project is missing or
 * tombstoned.
 */
export async function issueFounderCapability(
  db: Database,
  publicId: string,
  now: number,
  generate: () => string = generateFounderToken,
): Promise<IssuedCapability | null> {
  const project = await loadLiveProjectByPublicId(db, publicId);
  if (!project) return null;
  const token = generate();
  const version = project.shareTokenVersion + 1;
  const updated = await db
    .update(schema.projects)
    .set({
      shareTokenDigest: founderTokenDigest(token),
      shareTokenVersion: version,
      shareRevokedAt: null,
      updatedAt: now,
    })
    .where(eq(schema.projects.id, project.id))
    .returning({ id: schema.projects.id });
  if (updated.length !== 1) return null;
  return { token, status: { state: "active", version, revokedAt: null } };
}

export type RevokeResult =
  | { ok: true; status: FounderShareStatus }
  | { ok: false; error: "not-found" | "never-issued" };

/**
 * Revoke the founder capability: stamp the revocation instant and clear the
 * digest so neither the exchange nor any existing session verifies again.
 * Project history — pages, captures, pins, threads — is untouched. A repeat
 * revoke is idempotent; a project that never issued a link has nothing to
 * revoke.
 */
export async function revokeFounderCapability(
  db: Database,
  publicId: string,
  now: number,
): Promise<RevokeResult> {
  const project = await loadLiveProjectByPublicId(db, publicId);
  if (!project) return { ok: false, error: "not-found" };
  if (project.shareTokenVersion === 0) return { ok: false, error: "never-issued" };
  if (project.shareRevokedAt !== null) return { ok: true, status: shareStatusOf(project) };
  await db
    .update(schema.projects)
    .set({ shareTokenDigest: null, shareRevokedAt: now, updatedAt: now })
    .where(eq(schema.projects.id, project.id));
  return {
    ok: true,
    status: { state: "revoked", version: project.shareTokenVersion, revokedAt: now },
  };
}

/** The binding a successful exchange establishes. */
export interface FounderGrant {
  projectId: string;
  publicId: string;
  version: number;
}

/**
 * Exchange a presented token for the project capability it names. The
 * project must be live with an active (unrevoked) capability whose digest
 * matches the token's digest in constant time; every other case is the
 * same null. The raw token is never stored or echoed.
 */
export async function exchangeFounderToken(
  db: Database,
  publicId: string,
  token: string,
): Promise<FounderGrant | null> {
  if (!isFounderTokenShaped(token)) return null;
  const project = await loadLiveProjectByPublicId(db, publicId);
  if (!project) return null;
  if (project.shareRevokedAt !== null || project.shareTokenDigest === null) return null;
  const expected = Buffer.from(project.shareTokenDigest, "utf8");
  const provided = Buffer.from(founderTokenDigest(token), "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  return {
    projectId: project.id,
    publicId: project.publicId,
    version: project.shareTokenVersion,
  };
}

/**
 * Re-check a founder session's binding against the live project row: the
 * project is live, the capability is unrevoked, and the session's version
 * is the current one. This is what makes rotation and revocation end every
 * existing session at once, on the very next request.
 */
export async function founderBindingIsCurrent(
  db: Database,
  projectId: string,
  version: number,
): Promise<boolean> {
  const rows = await db
    .select({
      deletedAt: schema.projects.deletedAt,
      shareTokenDigest: schema.projects.shareTokenDigest,
      shareTokenVersion: schema.projects.shareTokenVersion,
      shareRevokedAt: schema.projects.shareRevokedAt,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const project = rows[0];
  if (!project || project.deletedAt !== null) return false;
  if (project.shareRevokedAt !== null || project.shareTokenDigest === null) return false;
  return project.shareTokenVersion === version;
}
