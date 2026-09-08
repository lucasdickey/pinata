// Server-only editor password verifier (VAL-AUTH-010).
//
// Both the submitted value and the configured EDITOR_PASSWORD are reduced to
// fixed-length SHA-256 representations before comparison, so
// crypto.timingSafeEqual always compares equal-length buffers: empty,
// unequal-length, oversized, and arbitrary-Unicode inputs can neither throw
// nor leak length/timing information about the configured value.

import { createHash, timingSafeEqual } from "node:crypto";

function passwordRepresentation(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Constant-time password check over fixed-length cryptographic
 * representations. Fails closed for non-string input and for a missing or
 * empty configured password.
 */
export function verifyEditorPassword(submitted: unknown, configured: string | undefined): boolean {
  if (typeof configured !== "string" || configured.length === 0) return false;
  if (typeof submitted !== "string") return false;
  const a = passwordRepresentation(submitted);
  const b = passwordRepresentation(configured);
  return timingSafeEqual(a, b);
}
