// Client-safe wire types for annotation threads and founder sharing
// (REQUIREMENTS 6 and 7). Types only: no server machinery, credentials, or
// store handles are importable from here.

/**
 * One immutable thread entry; the label is server-assigned by role. A
 * `message` was typed by a person; a `status` entry was written by the
 * server when the pin was resolved or reopened (D075), with a body such as
 * "Resolved by founder". Both kinds are append-only.
 */
export interface ThreadEntryView {
  id: string;
  annotationId: string;
  actorRole: "editor" | "founder";
  authorLabel: "Lucas" | "founder";
  kind: "message" | "status";
  body: string;
  createdAt: number;
}

/** GET .../annotations/[annotationId]/thread response. */
export interface ThreadListResponse {
  entries: ThreadEntryView[];
}

/** POST .../annotations/[annotationId]/thread response. */
export interface ThreadAppendResponse {
  entry: ThreadEntryView;
}

/** The editor-facing founder link status of one project. */
export interface FounderShareView {
  state: "none" | "active" | "revoked";
  version: number;
  revokedAt: number | null;
}

/** GET /api/projects/[publicId]/share response. */
export interface FounderShareStatusResponse {
  share: FounderShareView;
}

/**
 * POST /api/projects/[publicId]/share response: the raw token exactly once.
 * The client composes `${origin}${path}#${token}`; the server can never
 * show the token again because it persists only the digest.
 */
export interface FounderShareIssueResponse {
  share: FounderShareView;
  path: string;
  token: string;
}

/** POST /api/founder/[publicId]/session response. */
export interface FounderExchangeResponse {
  ok: true;
  expiresAt: string;
}
