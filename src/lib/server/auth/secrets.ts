// Server-only access to editor authentication secrets. Never import this
// module from client-reachable code; never log or return these values.
// Missing configuration fails closed (undefined) rather than falling back to
// any default credential.

/** The configured editor password, or undefined when not configured. */
export function getEditorPassword(): string | undefined {
  const value = process.env.EDITOR_PASSWORD;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Below this many characters a signing secret is worth a warning. It is
 * advice, not a gate (D098): refusing a short secret would sign the owner
 * out of a production deployment whose existing secret predates the check.
 */
const SESSION_SECRET_ADVISED_MIN_CHARS = 32;

let warnedShortSecret = false;

/** The configured session signing secret, or undefined when not configured. */
export function getSessionSecret(): string | undefined {
  const value = process.env.SESSION_SECRET;
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (value.length < SESSION_SECRET_ADVISED_MIN_CHARS && !warnedShortSecret) {
    // Once per process, and only the advised length: never the value or
    // its actual length, which would narrow a brute-force search.
    warnedShortSecret = true;
    console.warn(
      `[auth] SESSION_SECRET is shorter than ${SESSION_SECRET_ADVISED_MIN_CHARS} characters; rotate it to a longer random value (D098).`,
    );
  }
  return value;
}

/** Test-only helper: allow the short-secret warning to be emitted again. */
export function __resetSessionSecretWarningForTests(): void {
  warnedShortSecret = false;
}
