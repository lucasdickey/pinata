// The single URL admission and normalization boundary for project input
// (VAL-PROJECT-002). It parses once with WHATWG `URL`, canonicalizes before
// any address check, and returns either one normalized page identity or one
// bounded rejection reason. Every rule here is pinned by
// URL_NORMALIZATION_FIXTURES in the boundary catalog.
//
// This module is synchronous and network-free by design: DNS resolution and
// redirect-hop revalidation belong to the capture admission boundary
// (VAL-CAPTURE-001/002), which runs after a page row already exists.

import { MAX_URL_BYTES, type UrlRejectReason } from "../boundaries";

export type UrlNormalizationResult =
  | { ok: true; url: string }
  | { ok: false; reason: UrlRejectReason };

/** Hosts that can never be a public capture target, by exact name or suffix. */
const RESERVED_HOST_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "intranet",
  "home.arpa",
  "invalid",
  "test",
  "onion",
];

const IPV4_CANONICAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const SCHEME_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function isIpLiteral(hostname: string): boolean {
  // WHATWG brackets every IPv6 host and canonicalizes every accepted IPv4
  // spelling (decimal, octal, hex, short forms) to dotted-quad, so these two
  // shapes cover the whole literal space.
  return hostname.startsWith("[") || IPV4_CANONICAL.test(hostname);
}

function isReservedHost(hostname: string): boolean {
  if (!hostname.includes(".")) return true;
  return RESERVED_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

/**
 * Normalize one submitted URL row into its canonical page identity, or
 * explain why it is inadmissible. Never throws, never resolves names, and
 * never echoes the input in the result.
 */
export function normalizeProjectUrl(input: string): UrlNormalizationResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, reason: "blank" };
  // UTF-8 byte length via TextEncoder rather than Buffer, so the same rules
  // can pre-check input in the browser (D097); the count is identical.
  if (new TextEncoder().encode(trimmed).length > MAX_URL_BYTES) {
    return { ok: false, reason: "too-long" };
  }
  // Distinguish "you left the scheme off" from "this is not parseable at all"
  // before parsing, because WHATWG reports both as the same failure.
  if (!SCHEME_PREFIX.test(trimmed)) return { ok: false, reason: "relative" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (parsed.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "credentials" };
  }
  // WHATWG already removed an explicit :443, so any remaining port is non-default.
  if (parsed.port !== "") return { ok: false, reason: "port" };

  // A single trailing dot is a valid DNS root marker WHATWG preserves;
  // stripping it here keeps `example.com.` and `example.com` one page.
  const hostname = parsed.hostname.endsWith(".")
    ? parsed.hostname.slice(0, -1)
    : parsed.hostname;
  if (hostname === "") return { ok: false, reason: "malformed" };
  if (isIpLiteral(hostname)) return { ok: false, reason: "ip-literal" };
  // WHATWG accepts hosts with empty labels (".com", "a..b"); DNS does not.
  if (!hostname.startsWith("[") && hostname.split(".").some((label) => label === "")) {
    return { ok: false, reason: "malformed" };
  }
  if (isReservedHost(hostname)) return { ok: false, reason: "not-public" };

  const path = parsed.pathname === "" ? "/" : parsed.pathname;
  // The fragment is dropped for page identity and an empty query is not kept
  // as a bare "?"; everything else is preserved byte for byte.
  const query = parsed.search === "?" ? "" : parsed.search;
  return { ok: true, url: `https://${hostname}${path}${query}` };
}

/**
 * The page identity of an uploaded capture's address (D134). An upload is
 * never fetched — the editor's own browser already rendered it — so its
 * address is a label that files the capture under a page, not a capture
 * target. Wherever the project rule admits the address, the result is
 * exactly that rule's, so an upload of a page the project already has lands
 * on that page. Beyond it, an upload may also name what only the editor's
 * browser can reach: plain http, a port, a reserved name like localhost, or
 * an IP literal. Credentials, other schemes, and oversized input are still
 * refused, and the fragment is still dropped. A page filed this way is
 * captured by the provider only if its address also passes the project rule
 * and the capture admission that runs before every provider call.
 */
export function normalizeUploadUrl(input: string): UrlNormalizationResult {
  const strict = normalizeProjectUrl(input);
  if (strict.ok) return strict;
  if (
    strict.reason === "blank" ||
    strict.reason === "too-long" ||
    strict.reason === "relative" ||
    strict.reason === "malformed" ||
    strict.reason === "credentials"
  ) {
    return strict;
  }

  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "scheme" };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "credentials" };
  }
  const hostname = parsed.hostname.endsWith(".")
    ? parsed.hostname.slice(0, -1)
    : parsed.hostname;
  if (hostname === "") return { ok: false, reason: "malformed" };
  if (!hostname.startsWith("[") && hostname.split(".").some((label) => label === "")) {
    return { ok: false, reason: "malformed" };
  }
  const port = parsed.port === "" ? "" : `:${parsed.port}`;
  const path = parsed.pathname === "" ? "/" : parsed.pathname;
  const query = parsed.search === "?" ? "" : parsed.search;
  return { ok: true, url: `${parsed.protocol}//${hostname}${port}${path}${query}` };
}
