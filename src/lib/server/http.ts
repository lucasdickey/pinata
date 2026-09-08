// Server-only HTTP request boundaries shared by every state-changing route:
// exact same-origin enforcement, bounded body reads, cookie parsing, and
// bounded generic error responses. No message here may echo request input,
// name an environment variable, or disclose internals.

/** Bounded, generic, secret-free error messages (the only ones we emit). */
export const ERRORS = {
  invalidRequest: "Invalid request.",
  rejected: "Request rejected.",
  authRequired: "Authentication required.",
  wrongPassword: "The password did not match.",
  throttled: "Too many attempts. Please try again later.",
  unavailable: "Service unavailable.",
} as const;

/** Bounded JSON error response. */
export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** True when the request arrived over HTTPS (deployed environments). */
export function isSecureRequest(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Exact same-origin check for unsafe methods: the Origin header must exist,
 * parse, and match the addressed host exactly. The Host header is the source
 * of truth for the addressed host (Next.js may normalize request.url's
 * hostname, e.g. 127.0.0.1 to localhost); the request URL's host is only a
 * fallback when Host is absent. Protocol must match the request URL, and
 * plain HTTP is only acceptable on local development hosts.
 */
export function hasSameOrigin(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return false;
  let origin: URL;
  let target: URL;
  try {
    origin = new URL(originHeader);
    target = new URL(request.url);
  } catch {
    return false;
  }
  const host = request.headers.get("host") ?? target.host;
  if (origin.host !== host || origin.protocol !== target.protocol) return false;
  if (origin.protocol !== "https:" && !isLocalHostname(origin.hostname)) return false;
  return true;
}

/** Parse a Cookie request header into a name/value map. */
export function parseCookieHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: "content-type" | "too-large" | "invalid-json" };

/**
 * Read a JSON request body with a hard byte cap enforced before parsing:
 * the Content-Type must be application/json, a declared Content-Length beyond
 * the cap is rejected unread, and the actual body is re-measured as UTF-8.
 */
export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) return { ok: false, error: "content-type" };
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isFinite(size) || size > maxBytes) return { ok: false, error: "too-large" };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, error: "invalid-json" };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) return { ok: false, error: "too-large" };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "invalid-json" };
  }
}
