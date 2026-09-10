// Client-safe wire types for pin annotations (VAL-PIN-001). This module is
// importable from browser code: it carries types only, never server
// machinery, credentials, or store handles.

/** A pin tip in screenshot-natural CSS pixels. */
export interface PinTipView {
  x: number;
  y: number;
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
  elementSnapshot: unknown | null;
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
