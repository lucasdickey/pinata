// Client-side completion of what people actually type into a URL field
// (D097). The admission boundary (normalize.ts) stays strict — it requires
// an explicit https:// and is the security check on the server — so the
// forms finish the obvious cases before submitting and show the result:
//
//   chickpea.co              → https://chickpea.co
//   www.chickpea.co/pricing  → https://www.chickpea.co/pricing
//   /pricing (extra row)     → https://chickpea.co/pricing, against the root
//
// It only ever adds https://. Input that already names a scheme, including
// http://, is left exactly as typed so the server can say why it is refused;
// quietly upgrading http to https would capture an address nobody entered.

import { normalizeProjectUrl, type UrlNormalizationResult } from "./normalize";

/** A scheme the way a person writes one: letters, then "://" or a bare colon with no dot before it. */
const EXPLICIT_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const BARE_SCHEME = /^[a-zA-Z][a-zA-Z0-9+-]*:/;
/** Something that reads as a host: a dotted name with no spaces before the path. */
const HOST_LIKE = /^[^\s/?#:]+\.[^\s/?#:]+(?::\d+)?(?:[/?#]|$)/;

/**
 * Complete one typed address. `root` is the project's root URL as typed;
 * a row that starts with "/" is resolved against it once it completes to an
 * https address. Anything this cannot improve is returned trimmed, as is.
 */
export function completeUrlInput(input: string, root?: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return trimmed;
  if (EXPLICIT_SCHEME.test(trimmed) || BARE_SCHEME.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) {
    if (root === undefined) return trimmed;
    const base = completeUrlInput(root);
    if (!base.toLowerCase().startsWith("https://")) return trimmed;
    try {
      return new URL(trimmed, base).href;
    } catch {
      return trimmed;
    }
  }
  if (HOST_LIKE.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/**
 * Complete, then run the same admission rules the server will: the landing
 * form uses this to report a bad address before sign-in instead of after.
 */
export function checkUrlInput(
  input: string,
  root?: string,
): { value: string; result: UrlNormalizationResult } {
  const value = completeUrlInput(input, root);
  return { value, result: normalizeProjectUrl(value) };
}
