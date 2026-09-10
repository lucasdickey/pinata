// Feedback and annotation bounds (VAL-THREAD-004, VAL-UI-004, VAL-PIN-004).

/**
 * Shared maximum length of an annotation's original comment or a thread
 * reply, in characters. Both surfaces enforce the same bound.
 */
export const FEEDBACK_BODY_MAX_CHARS = 2_000;

/** Maximum annotations persisted per capture. */
export const MAX_ANNOTATIONS_PER_CAPTURE = 200;

/** Maximum nearby DOM candidates offered when placing a mark. */
export const NEARBY_CANDIDATES_MAX = 8;

/**
 * Hard byte cap on one annotation mutation request body. Bounds the largest
 * legitimate payload: a maximum-length comment (2,000 chars, up to 4 UTF-8
 * bytes each) plus geometry and idempotency fields, with headroom.
 */
export const ANNOTATION_REQUEST_MAX_BYTES = 16_384;
