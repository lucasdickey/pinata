// Server-only access to editor authentication secrets. Never import this
// module from client-reachable code; never log or return these values.
// Missing configuration fails closed (undefined) rather than falling back to
// any default credential.

/** The configured editor password, or undefined when not configured. */
export function getEditorPassword(): string | undefined {
  const value = process.env.EDITOR_PASSWORD;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The configured session signing secret, or undefined when not configured. */
export function getSessionSecret(): string | undefined {
  const value = process.env.SESSION_SECRET;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
