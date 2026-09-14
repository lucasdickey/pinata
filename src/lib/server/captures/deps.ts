// The process-wide admission dependencies, behind a test seam.
//
// Route handlers must never construct a live DNS resolver or a live redirect
// probe during a focused test, and focused tests must never reach the real
// network. This module is the one place both concerns meet.

import { createVercelBlobStore, type ScreenshotStore } from "../providers/blob";
import { createBrowserlessClient } from "../providers/browserless";
import { createRedirectProbe, type AdmissionDeps } from "./admission";
import { getContinuationScheduler } from "./continuation";
import { createNodeDnsResolver } from "./dns";
import type { CaptureDriveDeps } from "./drive";
import type { CaptureExecutionDeps } from "./execute";

let override: AdmissionDeps | null = null;
let executionOverride: CaptureExecutionDeps | null = null;
let storeOverride: ScreenshotStore | null | undefined;

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

/**
 * Everything the server-driven capture path needs: admission, execution, and
 * the scheduler that continues work after a response. Each piece honours its
 * own test seam, so a route test can inject fakes for all three.
 */
export function getCaptureDriveDeps(): CaptureDriveDeps {
  return {
    admission: getAdmissionDeps(),
    execution: getCaptureExecutionDeps(),
    after: getContinuationScheduler(),
  };
}

/**
 * The private screenshot store for asset delivery, or whatever a test
 * injected. Fails closed to null when the credential is absent; delivery maps
 * that to a bounded generic unavailability, never an echoed detail.
 */
export function getScreenshotStore(): ScreenshotStore | null {
  if (storeOverride !== undefined) return storeOverride;
  return createVercelBlobStore(process.env);
}

export function __setScreenshotStoreForTests(store: ScreenshotStore | null | undefined): void {
  storeOverride = store;
}
