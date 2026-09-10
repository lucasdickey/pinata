// Run-scoped e2e cleanup registry (shared-store etiquette).
//
// Real-capture suites (manifest-scan, pin-planes) create run-scoped Turso
// rows and Blob objects against the SHARED local store while sibling specs
// observe it: every signed-in page auto-selects the newest project's first
// device, so a suite that deletes its rows in afterAll can 404 a sibling
// page that still has those rows open (observed 2026-09-10: projects.spec
// failed its console-error gate on a 404 from a deleted run capture, and a
// hijacked pins.spec run left a stray pin that FK-blocked a captures
// delete). The fix is coordination by timing: suites REGISTER their run id
// here in afterAll (a fast local file write, safe even when a test fails),
// and the Playwright global teardown — which runs after every worker's
// last page has closed — performs the actual deletion.
//
// The registry lives outside test-results/ because Playwright wipes that
// directory at the start of the NEXT run: a crashed run's entries must
// survive to the next teardown so leaked rows still get deleted (the
// deletes are idempotent by run id).

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REGISTRY_DIR = new URL("./.run-cleanup/", import.meta.url).pathname;

export interface RunCleanupEntry {
  /** The run id embedded in every row the suite created (URLs, keys). */
  runId: string;
  /** Annotation body prefixes the suite wrote, e.g. "e2e-planes <runId>:". */
  bodyPrefixes: string[];
  /** Suite name, for teardown log lines only. */
  suite: string;
}

/** Register one suite's run for deletion at global teardown. */
export function registerRunCleanup(entry: RunCleanupEntry): void {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(
    join(REGISTRY_DIR, `${entry.suite}-${entry.runId}.json`),
    JSON.stringify(entry),
  );
}

/** Every registered entry, oldest first; missing directory means none. */
export function readRunCleanupRegistry(): { entry: RunCleanupEntry; file: string }[] {
  let names: string[];
  try {
    names = readdirSync(REGISTRY_DIR).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const out: { entry: RunCleanupEntry; file: string }[] = [];
  for (const name of names) {
    try {
      const entry = JSON.parse(readFileSync(join(REGISTRY_DIR, name), "utf8")) as RunCleanupEntry;
      if (typeof entry.runId === "string" && entry.runId.length > 0) {
        out.push({ entry, file: join(REGISTRY_DIR, name) });
      }
    } catch {
      // A half-written file from a killed worker: nothing to delete with.
    }
  }
  return out;
}

/** Drop a registry file after its rows are verified gone. */
export function clearRunCleanupEntry(file: string): void {
  rmSync(file, { force: true });
}
