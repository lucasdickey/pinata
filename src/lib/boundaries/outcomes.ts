// Capture outcome catalog (VAL-CAPTURE-012): every capture failure or
// warning maps to exactly one entry here, with its persisted status,
// retryability, HTTP class, quota treatment, warning policy, bounded public
// message, and remediation. UI and API must not invent outcomes outside it.

/** Maximum size of any public-facing capture message, in UTF-8 bytes. */
export const MAX_PUBLIC_MESSAGE_BYTES = 256;

export interface CaptureOutcome {
  code: string;
  /** Persisted capture status after this outcome. */
  captureStatus: "ready" | "failed";
  /** Whether a scoped retry is offered for this outcome. */
  retryable: boolean;
  /** HTTP status of the API response, or null for computed/persisted states. */
  httpStatus: number | null;
  /** Whether this outcome consumes a persisted capture attempt. */
  consumesAttempt: boolean;
  /** Whether the outcome surfaces as a warning on a ready capture. */
  warn: boolean;
  /** Bounded, secret-free message shown to users. */
  publicMessage: string;
  /** What the actor can do about it. */
  remediation: string;
}

export const CAPTURE_OUTCOMES: readonly CaptureOutcome[] = Object.freeze([
  {
    code: "invalid-url",
    captureStatus: "failed",
    retryable: false,
    httpStatus: 422,
    consumesAttempt: false,
    warn: false,
    publicMessage: "That URL is not a public HTTPS address Pinata can capture.",
    remediation: "Fix the URL and resubmit.",
  },
  {
    code: "dns-failed",
    captureStatus: "failed",
    retryable: true,
    httpStatus: 502,
    consumesAttempt: true,
    warn: false,
    publicMessage: "The address could not be resolved to a public host.",
    remediation: "Check the domain resolves publicly, then retry.",
  },
  {
    code: "unsafe-redirect",
    captureStatus: "failed",
    retryable: false,
    httpStatus: 422,
    consumesAttempt: true,
    warn: false,
    publicMessage: "A redirect pointed at an address Pinata will not capture.",
    remediation: "Remove or replace the unsafe redirect target.",
  },
  {
    code: "browserless-auth",
    captureStatus: "failed",
    retryable: false,
    httpStatus: 502,
    consumesAttempt: true,
    warn: false,
    publicMessage: "The capture provider rejected the configured credential.",
    remediation: "The operator must restore the capture credential; retrying will not help.",
  },
  {
    code: "browserless-provider",
    captureStatus: "failed",
    retryable: true,
    httpStatus: 502,
    consumesAttempt: true,
    warn: false,
    publicMessage: "The capture provider could not complete this capture.",
    remediation: "Retry; if it persists, the provider may be degraded.",
  },
  {
    code: "navigation-timeout",
    captureStatus: "failed",
    retryable: true,
    httpStatus: 504,
    consumesAttempt: true,
    warn: false,
    publicMessage: "The page did not finish navigating in time.",
    remediation: "Retry, or capture a lighter page.",
  },
  {
    code: "total-timeout",
    captureStatus: "failed",
    retryable: true,
    httpStatus: 504,
    consumesAttempt: true,
    warn: false,
    publicMessage: "The capture exceeded its total time budget.",
    remediation: "Retry; very slow pages may never fit the budget.",
  },
  {
    code: "document-too-tall",
    captureStatus: "failed",
    retryable: false,
    httpStatus: 422,
    consumesAttempt: true,
    warn: false,
    publicMessage: "The page is taller than the maximum capturable height.",
    remediation: "Capture a shorter page or a specific section instead.",
  },
  {
    code: "too-many-pixels",
    captureStatus: "failed",
    retryable: false,
    httpStatus: 422,
    consumesAttempt: true,
    warn: false,
    publicMessage: "The page exceeds the maximum capturable pixel count.",
    remediation: "Capture a narrower or shorter page.",
  },
  {
    code: "provider-bytes-exceeded",
    captureStatus: "failed",
    retryable: true,
    httpStatus: 502,
    consumesAttempt: true,
    warn: false,
    publicMessage: "The capture provider response exceeded the size budget.",
    remediation: "Retry once; persistent failures mean the page is too large to capture.",
  },
  {
    code: "image-bytes-exceeded",
    captureStatus: "failed",
    retryable: false,
    httpStatus: 422,
    consumesAttempt: true,
    warn: false,
    publicMessage: "The screenshot exceeded the maximum image size.",
    remediation: "Capture a smaller page.",
  },
  {
    code: "invalid-image",
    captureStatus: "failed",
    retryable: true,
    httpStatus: 502,
    consumesAttempt: true,
    warn: false,
    publicMessage: "The provider returned bytes that are not a valid image.",
    remediation: "Retry; persistent failures indicate a provider problem.",
  },
  {
    code: "quota-exceeded",
    captureStatus: "failed",
    retryable: true,
    httpStatus: 429,
    consumesAttempt: false,
    warn: false,
    publicMessage: "Too many captures are active or scheduled right now.",
    remediation: "Wait for a running capture to finish, then retry.",
  },
  {
    code: "blob-failure",
    captureStatus: "failed",
    retryable: true,
    httpStatus: 502,
    consumesAttempt: true,
    warn: false,
    publicMessage: "The screenshot could not be stored.",
    remediation: "Retry; storage failures are usually transient.",
  },
  {
    code: "finalization-failure",
    captureStatus: "failed",
    retryable: true,
    httpStatus: 502,
    consumesAttempt: true,
    warn: false,
    publicMessage: "The capture finished but could not be finalized.",
    remediation: "Retry; a fresh attempt is created and old annotations are untouched.",
  },
  {
    code: "stale-lease",
    captureStatus: "failed",
    retryable: true,
    httpStatus: null,
    consumesAttempt: true,
    warn: false,
    publicMessage: "This capture attempt stopped responding and was marked stale.",
    remediation: "Retry to schedule a fresh attempt.",
  },
  {
    code: "cleanup-pending",
    captureStatus: "ready",
    retryable: false,
    httpStatus: null,
    consumesAttempt: true,
    warn: true,
    publicMessage: "The capture is ready; leftover storage cleanup is still pending.",
    remediation: "Nothing to do; cleanup completes in the background.",
  },
  {
    code: "manifest-truncated",
    captureStatus: "ready",
    retryable: false,
    httpStatus: null,
    consumesAttempt: true,
    warn: true,
    publicMessage:
      "The page had more elements than the manifest budget, so element context was truncated.",
    remediation: "Pins still work; some areas may offer no element context.",
  },
]);
