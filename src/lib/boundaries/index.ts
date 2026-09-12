// Pinata's versioned validation boundary catalog: the single source of every
// runtime policy value the validation contract names (VAL-REQS-007).
//
// Auth, capture, canvas, thread, UI, and performance modules import these
// constants rather than declaring their own literals; docs/EVALS.md and
// docs/ARCHITECTURE.md publish the same values; test/boundaries.test.ts fails
// on any drift between code, docs, and routes. Bump POLICY_VERSION whenever
// any value in this catalog changes.

/** Dated catalog version. Bump on any boundary change. */
export const POLICY_VERSION = "2026-09-12.1";

export * from "./session";
export * from "./asset";
export * from "./url";
export * from "./capture";
export * from "./network";
export * from "./manifest";
export * from "./motion";
export * from "./outcomes";
export * from "./geometry";
export * from "./quotas";
export * from "./feedback";
export * from "./interaction";
export * from "./performance";
