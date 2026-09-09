// The process-wide admission dependencies, behind a test seam.
//
// Route handlers must never construct a live DNS resolver or a live redirect
// probe during a focused test, and focused tests must never reach the real
// network. This module is the one place both concerns meet.

import { createVercelBlobStore } from "../providers/blob";
import { createBrowserlessClient } from "../providers/browserless";
import { createRedirectProbe, type AdmissionDeps } from "./admission";
import { createNodeDnsResolver } from "./dns";
import type { CaptureExecutionDeps } from "./execute";

let override: AdmissionDeps | null = null;
let executionOverride: CaptureExecutionDeps | null = null;

/** Live resolver plus redirect probe, or whatever a test injected. */
export function getAdmissionDeps(): AdmissionDeps {
  if (override) return override;
  return { resolver: createNodeDnsResolver(), probe: createRedirectProbe() };
}

export function __setAdmissionDepsForTests(deps: AdmissionDeps | null): void {
  override = deps;
}

/**
 * Live Browserless client and private Blob store, or whatever a test
 * injected. Both fail closed to null when their credential is absent, which
 * execution turns into a bounded failed attempt: a claim is never left open
 * because the environment is unconfigured.
 */
export function getCaptureExecutionDeps(): CaptureExecutionDeps {
  if (executionOverride) return executionOverride;
  return {
    client: createBrowserlessClient(process.env),
    store: createVercelBlobStore(process.env),
  };
}

export function __setCaptureExecutionDepsForTests(deps: CaptureExecutionDeps | null): void {
  executionOverride = deps;
}
