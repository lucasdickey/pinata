// Server-only agent link (D121): a secret URL that hands a coding agent a
// read-only brief of one project's open marks, with no account and no key.
//
// It is a second bearer secret beside the founder link, built the same way
// (256 random bits; only the SHA-256 digest is stored; rotation increments a
// version; revocation stamps an instant and clears the digest) and kept in
// its own columns so the two links never affect each other. The difference
// is where the token travels: an agent fetches a plain URL and cannot read a
// fragment, so the token is in the path. That is what lets the link be
// pasted into any agent, and it is also why the link only ever reads — the
// brief and its screenshots — and can be rotated or revoked at any time.
//
// Lookup is by digest: the token is hashed and the unique digest column is
// matched, so the raw token is never compared or stored. Every failure — a
// malformed token, an unknown or revoked one, a deleted project — is the
// same null.

import { and, eq, isNull } from "drizzle-orm";
import { schema, type Database } from "../db/client";
import {
  founderTokenDigest,
  generateFounderToken,
  isFounderTokenShaped,
} from "../founder/capability";

export type AgentLinkState = "none" | "active" | "revoked";

/** The editor-facing status of a project's agent link. */
export interface AgentLinkStatus {
  state: AgentLinkState;
  /** Increments on every create or rotate; 0 until the first link. */
  version: number;
  revokedAt: number | null;
}

type ProjectRow = typeof schema.projects.$inferSelect;

/** Derive the agent link status from the persisted columns. */
export function agentLinkStatusOf(project: {
  agentTokenDigest: string | null;
  agentTokenVersion: number;
  agentRevokedAt: number | null;
}): AgentLinkStatus {
  if (project.agentRevokedAt !== null) {
    return { state: "revoked", version: project.agentTokenVersion, revokedAt: project.agentRevokedAt };
  }
  if (project.agentTokenDigest === null) {
    return { state: "none", version: project.agentTokenVersion, revokedAt: null };
  }
  return { state: "active", version: project.agentTokenVersion, revokedAt: null };
}

async function loadLiveProject(db: Database, publicId: string): Promise<ProjectRow | null> {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.publicId, publicId))
    .limit(1);
  const project = rows[0];
  if (!project || project.deletedAt !== null) return null;
  return project;
}

/** A live project's agent link status, or null when there is no such project. */
export async function readAgentLinkStatus(
  db: Database,
  publicId: string,
): Promise<AgentLinkStatus | null> {
  const project = await loadLiveProject(db, publicId);
  return project ? agentLinkStatusOf(project) : null;
}

export interface IssuedAgentLink {
  /** The raw token: returned exactly once, never stored, never logged. */
  token: string;
  status: AgentLinkStatus;
}

/**
 * Create or rotate a project's agent link. The new token's digest replaces
 * the old one, so the previous link stops working at once. Null when the
 * project is missing or deleted.
 */
export async function issueAgentLink(
  db: Database,
  publicId: string,
  now: number,
  generate: () => string = generateFounderToken,
): Promise<IssuedAgentLink | null> {
  const project = await loadLiveProject(db, publicId);
  if (!project) return null;
  const token = generate();
  const version = project.agentTokenVersion + 1;
  const updated = await db
    .update(schema.projects)
    .set({
      agentTokenDigest: founderTokenDigest(token),
      agentTokenVersion: version,
      agentRevokedAt: null,
      updatedAt: now,
    })
    .where(eq(schema.projects.id, project.id))
    .returning({ id: schema.projects.id });
  if (updated.length !== 1) return null;
  return { token, status: { state: "active", version, revokedAt: null } };
}

export type RevokeAgentLinkResult =
  | { ok: true; status: AgentLinkStatus }
  | { ok: false; error: "not-found" | "never-issued" };

/** Revoke the agent link. A repeat revoke is a no-op; nothing else changes. */
export async function revokeAgentLink(
  db: Database,
  publicId: string,
  now: number,
): Promise<RevokeAgentLinkResult> {
  const project = await loadLiveProject(db, publicId);
  if (!project) return { ok: false, error: "not-found" };
  if (project.agentTokenVersion === 0) return { ok: false, error: "never-issued" };
  if (project.agentRevokedAt !== null) return { ok: true, status: agentLinkStatusOf(project) };
  await db
    .update(schema.projects)
    .set({ agentTokenDigest: null, agentRevokedAt: now, updatedAt: now })
    .where(eq(schema.projects.id, project.id));
  return {
    ok: true,
    status: { state: "revoked", version: project.agentTokenVersion, revokedAt: now },
  };
}

/** The project an agent token opens. */
export interface AgentGrant {
  projectId: string;
  publicId: string;
  title: string;
  rootUrl: string;
}

/**
 * The live project whose active agent link is this token, or null. Archived
 * projects still answer: archiving only tidies the editor's list (D108).
 */
export async function resolveAgentToken(db: Database, token: string): Promise<AgentGrant | null> {
  if (!isFounderTokenShaped(token)) return null;
  const rows = await db
    .select({
      id: schema.projects.id,
      publicId: schema.projects.publicId,
      title: schema.projects.title,
      rootUrl: schema.projects.rootUrl,
    })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.agentTokenDigest, founderTokenDigest(token)),
        isNull(schema.projects.agentRevokedAt),
        isNull(schema.projects.deletedAt),
      ),
    )
    .limit(1);
  const project = rows[0];
  if (!project) return null;
  return {
    projectId: project.id,
    publicId: project.publicId,
    title: project.title,
    rootUrl: project.rootUrl,
  };
}

/** True when the capture belongs to the project (through its page). */
export async function projectOwnsCapture(
  db: Database,
  projectId: string,
  captureId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.captures.id })
    .from(schema.captures)
    .innerJoin(schema.pages, eq(schema.captures.pageId, schema.pages.id))
    .where(and(eq(schema.captures.id, captureId), eq(schema.pages.projectId, projectId)))
    .limit(1);
  return rows.length === 1;
}
