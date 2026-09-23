// Client-safe wire types for annotations (VAL-PIN-001, D079). This module is
// importable from browser code: it carries types only, never server
// machinery, credentials, or store handles.
//
// Four kinds exist. A pin carries one natural-pixel tip; a rectangle (D079)
// carries a natural-pixel box; a circle (D082) carries a natural-pixel
// bounding square; an arrow (D083) carries two natural-pixel endpoints, the
// head at `end`. They share one numbering sequence per capture, one comment,
// one context snapshot, one revision, one lifecycle status, and one thread.

import type { ThreadEntryView } from "./threads";

/** A pin tip in screenshot-natural CSS pixels. */
export interface PinTipView {
  x: number;
  y: number;
}

/**
 * A rectangle's box in screenshot-natural CSS pixels: its top-left corner
 * and its size. Always inside the capture's document, and at least
 * MIN_SHAPE_SIZE_PX in each dimension (the server rejects anything else).
 */
export interface RectangleGeometryView {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A circle's bounding square in screenshot-natural CSS pixels (D082): its
 * top-left corner and the one `size` that is both its width and its height.
 * Always inside the capture's document, and at least MIN_SHAPE_SIZE_PX (the
 * server rejects anything else). The drawn ellipse is inscribed in it.
 */
export interface CircleGeometryView {
  x: number;
  y: number;
  size: number;
}

/**
 * An arrow's two endpoints in screenshot-natural CSS pixels (D083): the tail
 * it is drawn from, and the head it points at. The head is what the mark is
 * about. Both are inside the capture's document and at least
 * MIN_ARROW_LENGTH_PX apart (the server rejects anything else).
 */
export interface ArrowGeometryView {
  start: { x: number; y: number };
  end: { x: number; y: number };
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
 * The API view of one persisted rectangle (D079). Everything but the
 * geometry is the pin's: same numbering sequence, comment, snapshot,
 * revision, status, unread count, and thread.
 */
export interface RectangleAnnotationView {
  id: string;
  captureId: string;
  kind: "rectangle";
  number: number;
  rect: RectangleGeometryView;
  body: string;
  elementSnapshot: PinElementSnapshot | null;
  revision: number;
  status: PinStatus;
  unreadReplies: number;
  createdAt: number;
}

/**
 * The API view of one persisted circle (D082). Everything but the geometry
 * is the pin's: same numbering sequence, comment, snapshot, revision,
 * status, unread count, and thread.
 */
export interface CircleAnnotationView {
  id: string;
  captureId: string;
  kind: "circle";
  number: number;
  circle: CircleGeometryView;
  body: string;
  elementSnapshot: PinElementSnapshot | null;
  revision: number;
  status: PinStatus;
  unreadReplies: number;
  createdAt: number;
}

/**
 * The API view of one persisted arrow (D083). Everything but the geometry is
 * the pin's, and the element snapshot is the one under the head.
 */
export interface ArrowAnnotationView {
  id: string;
  captureId: string;
  kind: "arrow";
  number: number;
  arrow: ArrowGeometryView;
  body: string;
  elementSnapshot: PinElementSnapshot | null;
  revision: number;
  status: PinStatus;
  unreadReplies: number;
  createdAt: number;
}

/** Any persisted annotation the routes list or return. */
export type AnnotationView =
  | PinAnnotationView
  | RectangleAnnotationView
  | CircleAnnotationView
  | ArrowAnnotationView;

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
  annotations: AnnotationView[];
}

/** POST/PATCH annotation responses. */
export interface PinMutationResponse {
  annotation: AnnotationView;
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
  annotation: AnnotationView;
  entry: PinStatusEntryView | null;
}

/** POST .../annotations/[annotationId]/seen response. */
export interface PinSeenResponse {
  seen: true;
}

/**
 * GET /api/captures/[captureId]/context response. The caller picks the
 * ranking by mark kind: `?x=&y=` is the point ranking, used for a pin tip
 * and for an arrow's head (D083), and `?x=&y=&width=&height=` is the overlap
 * ranking, used for a rectangle's box and a circle's bounding square
 * (D079/D082). Either way it returns the deterministically
 * ranked, capped nearby candidates
 * from the capture's own persisted manifest. The client submits only a
 * chosen candidate's capture-local id (or null for "No element"); the server
 * re-derives the snapshot from the manifest.
 */
export interface PinContextResponse {
  candidates: PinElementSnapshot[];
}

// ---- project-scoped read (D077) --------------------------------------------

/** Where an annotation's capture sits in its project. */
export interface ProjectAnnotationLocation {
  pageId: string;
  normalizedUrl: string;
  /** The capture variant: "desktop" or "mobile". */
  variant: string;
  /** The capture attempt (version) the pin lives on. */
  attempt: number;
  /**
   * The annotation's thread, oldest first (D097), so the project export can
   * carry the conversation. Optional so an older server's answer still reads.
   */
  thread?: ThreadEntryView[];
}

/**
 * One live annotation as the project-scoped read returns it: the per-capture
 * view (a pin, a rectangle, a circle, or an arrow) plus where the capture sits in the
 * project, so the workspace can order marks across planes (page, then
 * device, then number) and the table can name the page and device beside a
 * number that is only unique per capture.
 */
export type ProjectPinAnnotationView =
  | (PinAnnotationView & ProjectAnnotationLocation)
  | (RectangleAnnotationView & ProjectAnnotationLocation)
  | (CircleAnnotationView & ProjectAnnotationLocation)
  | (ArrowAnnotationView & ProjectAnnotationLocation);

/** GET /api/projects/[publicId]/annotations response. */
export interface ProjectPinListResponse {
  annotations: ProjectPinAnnotationView[];
}
