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
  createdAt: number;
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

/**
 * GET /api/captures/[captureId]/context?x=&y= response: the deterministically
 * ranked, capped nearby candidates from the capture's own persisted manifest.
 * The client submits only a chosen candidate's capture-local id (or null for
 * "No element"); the server re-derives the snapshot from the manifest.
 */
export interface PinContextResponse {
  candidates: PinElementSnapshot[];
}
