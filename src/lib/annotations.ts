// Client-safe wire types for pin annotations (VAL-PIN-001). This module is
// importable from browser code: it carries types only, never server
// machinery, credentials, or store handles.

/** A pin tip in screenshot-natural CSS pixels. */
export interface PinTipView {
  x: number;
  y: number;
}

/**
 * The inert, bounded capture-time DOM context attached to a pin: exactly one
 * element of the capture's own persisted manifest, copied at save time. It
 * is descriptive only — never an executable selector, never live DOM, and
 * never re-derived after creation (VAL-PIN-003, VAL-PIN-008).
 */
export interface PinElementSnapshot {
  id: string;
  kind: string;
  tag: string;
  role: string;
  text: string;
  accessibleName: string;
  hints: {
    id: string;
    classes: string[];
    alt: string;
    title: string;
    testId: string;
  };
  path: string[];
  rect: { x: number; y: number; width: number; height: number };
}

/**
 * The pin lifecycle (D075): `open` on create, `replied` once the founder has
 * answered in the thread, `resolved` when either role marks it done. Resolve
 * and reopen are reversible; each writes a `status` thread entry.
 */
export type PinStatus = "open" | "replied" | "resolved";

/**
 * The API view of one persisted pin. Geometry is the canonical natural-pixel
 * tip (never a badge center or a React Flow position); `number` is the
 * server-assigned, monotonically increasing per-capture label.
 */
export interface PinAnnotationView {
  id: string;
  captureId: string;
  kind: "pin";
  number: number;
  tip: PinTipView;
  body: string;
  /** Inert capture-time DOM context snapshot, or the explicit null. */
  elementSnapshot: PinElementSnapshot | null;
  revision: number;
  status: PinStatus;
  /**
   * Replies by the other role that the requesting role has not seen yet
   * (D075). Computed per request for whoever is asking: the editor's count
   * on the editor's read, the founder's on the founder's.
   */
  unreadReplies: number;
  createdAt: number;
}

/**
 * Feedback counts for one capture or one project, for the requesting role
 * (D075). `open` counts pins not yet resolved (status open or replied);
 * `unreadReplies` is the sum of the pins' unread replies.
 */
export interface FeedbackCounts {
  pins: number;
  open: number;
  resolved: number;
  unreadReplies: number;
}

/** GET /api/captures/[captureId]/annotations response. */
export interface PinListResponse {
  annotations: PinAnnotationView[];
}

/** POST/PATCH annotation responses. */
export interface PinMutationResponse {
  annotation: PinAnnotationView;
}

/** DELETE annotation response: the pin is tombstoned, never row-deleted. */
export interface PinDeleteResponse {
  deleted: true;
}

/** The status entry a resolve or reopen writes, as it appears in the thread. */
export interface PinStatusEntryView {
  id: string;
  annotationId: string;
  actorRole: "editor" | "founder";
  authorLabel: "Lucas" | "founder";
  kind: "status";
  body: string;
  createdAt: number;
}

/**
 * POST .../annotations/[annotationId]/resolve and .../reopen response: the
 * pin with its new status plus the `status` thread entry the change wrote,
 * or `entry: null` when the pin was already in the requested state and
 * nothing changed.
 */
export interface PinStatusResponse {
  annotation: PinAnnotationView;
  entry: PinStatusEntryView | null;
}

/** POST .../annotations/[annotationId]/seen response. */
export interface PinSeenResponse {
  seen: true;
}

/**
 * GET /api/captures/[captureId]/context?x=&y= response: the deterministically
 * ranked, capped nearby candidates from the capture's own persisted manifest.
 * The client submits only a chosen candidate's capture-local id (or null for
 * "No element"); the server re-derives the snapshot from the manifest.
 */
export interface PinContextResponse {
  candidates: PinElementSnapshot[];
}
