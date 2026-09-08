// Client-safe authentication constants: cookie names and the CSRF header
// name. These are identifiers, not secrets, so both client and server modules
// may import them. Secret values and verifiers live only in src/lib/server/.

/** HttpOnly cookie carrying the signed editor session token. */
export const EDITOR_SESSION_COOKIE = "pinata_editor_session";

/**
 * Browser-readable cookie carrying the double-submit CSRF proof bound to the
 * editor session. Client code echoes it in EDITOR_CSRF_HEADER on mutations.
 */
export const EDITOR_CSRF_COOKIE = "pinata_csrf";

/** Header carrying the CSRF proof on authenticated mutations. */
export const EDITOR_CSRF_HEADER = "x-pinata-csrf";
