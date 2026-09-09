// The process-wide admission dependencies, behind a test seam.
//
// Route handlers must never construct a live DNS resolver or a live redirect
// probe during a focused test, and focused tests must never reach the real
// network. This module is the one place both concerns meet.

import { createRedirectProbe, type AdmissionDeps } from "./admission";
import { createNodeDnsResolver } from "./dns";

let override: AdmissionDeps | null = null;

/** Live resolver plus redirect probe, or whatever a test injected. */
export function getAdmissionDeps(): AdmissionDeps {
  if (override) return override;
  return { resolver: createNodeDnsResolver(), probe: createRedirectProbe() };
}

export function __setAdmissionDepsForTests(deps: AdmissionDeps | null): void {
  override = deps;
}
