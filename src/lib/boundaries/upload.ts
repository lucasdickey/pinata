// Uploaded capture policy (D131, D133): a screenshot and its element list
// made somewhere other than the capture provider — the Chrome extension, or
// a plain image — and sent to Pinata to comment on.

/**
 * Largest uploaded screenshot: 4,000,000 bytes. One upload request carries
 * one image, and a Vercel Function accepts at most 4.5 MB of request body,
 * so the image cap leaves room for the element list and the form framing.
 * The extension and the upload form lower the WebP quality until an image
 * fits; MAX_IMAGE_BYTES still applies to everything stored.
 */
export const UPLOAD_IMAGE_MAX_BYTES = 4_000_000;

/** Hard cap on one upload request body: the image, its element list, and framing. */
export const UPLOAD_REQUEST_MAX_BYTES = 4_450_000;

/** The `format` field of a capture file the extension saves. */
export const CAPTURE_PACKAGE_FORMAT = "pinata-capture";

/** The capture file version this build reads and writes. */
export const CAPTURE_PACKAGE_VERSION = 1;
