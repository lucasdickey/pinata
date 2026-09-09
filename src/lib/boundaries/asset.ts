// Private capture asset delivery policy (VAL-CAPTURE-010, VAL-CAPTURE-014).
//
// Screenshots live in a private Vercel Blob store; the only way bytes reach a
// browser is the authorized asset route, which applies exactly these values
// to every response it emits — success or denial. The delivery module imports
// these constants rather than declaring its own literals.

/**
 * Cache policy on every asset response. Screenshots are private per-project
 * material behind a revocable authority, so neither the browser nor any
 * intermediary may retain a copy: a warmed cache must never replay an image
 * after logout, rotation, or revocation.
 */
export const ASSET_CACHE_CONTROL = "private, no-store, max-age=0";

/**
 * Asset authorization rides on the Cookie header (the editor session today,
 * a founder capability session next), so any cache that ever saw the response
 * must key on it. `no-store` already forbids retention; Vary is the
 * authorization-appropriate belt-and-braces the contract names.
 */
export const ASSET_VARY = "Cookie";

/**
 * The only range unit the asset route serves, and the only shape: one
 * `bytes=<start>-<end?>` range with an explicit start. Suffix and multi-range
 * requests are rejected, never partially honored.
 */
export const ASSET_RANGE_UNIT = "bytes";
