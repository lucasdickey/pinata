// Environment gate for Playwright specs that need real local configuration.
//
// The end-to-end suite runs in two places with different configuration: a
// developer machine (or a deployed check) where `.env.local` supplies the
// editor secrets and the Turso credentials, and GitHub Actions, which holds no
// repository secrets at all. Specs that need those values ask this module for
// a gate and call `test.skip` with its reason, so CI reports them as skipped
// instead of failing — the same env-gating the Vitest integration suites use.
//
// Only variable *names* ever leave this module. Values are returned to the
// spec that asked for them and are never formatted into a skip reason, an
// error message, or a log line.

import { readFileSync } from "node:fs";

const DEFAULT_ENV_FILE = ".env.local";

/** `NAME=value`, tolerating a leading `export` and surrounding whitespace. */
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/**
 * Parse a dotenv-style file into a name/value map. A missing or unreadable
 * file yields an empty map rather than throwing: absence is the CI case, not
 * an error.
 */
export function readLocalEnvFile(envFilePath: string = DEFAULT_ENV_FILE): Record<string, string> {
  let contents: string;
  try {
    contents = readFileSync(envFilePath, "utf8");
  } catch {
    return {};
  }

  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(ASSIGNMENT);
    if (!match) continue;
    const raw = match[2].trim();
    const unquoted =
      (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) ||
      (raw.startsWith("'") && raw.endsWith("'") && raw.length > 1)
        ? raw.slice(1, -1)
        : raw;
    values[match[1]] = unquoted;
  }
  return values;
}

/**
 * Resolve a variable the way the server under test resolves it: a real
 * environment variable wins over the `.env.local` entry, and an empty value
 * counts as absent. Returns `undefined` when it is not configured.
 */
export function localEnvValue(
  name: string,
  envFilePath: string = DEFAULT_ENV_FILE,
): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  const fromFile = readLocalEnvFile(envFilePath)[name];
  return fromFile ? fromFile : undefined;
}

export interface LocalEnvGate {
  /** True when every requested variable is configured. */
  ready: boolean;
  /** The names — never the values — that are not configured. */
  missing: string[];
  /** A `test.skip` reason, or `""` when the gate is ready. */
  reason: string;
}

/**
 * Report whether the requested variables are configured, with a skip reason
 * that names the gaps.
 */
export function localEnvGate(
  names: readonly string[],
  envFilePath: string = DEFAULT_ENV_FILE,
): LocalEnvGate {
  const missing = names.filter((name) => localEnvValue(name, envFilePath) === undefined);
  return {
    ready: missing.length === 0,
    missing,
    reason: missing.length
      ? `requires local configuration absent from this environment (${envFilePath}): ${missing.join(", ")}`
      : "",
  };
}

/**
 * Read a required variable after its gate has passed. Throws naming only the
 * variable, so a mis-ordered spec fails loudly without leaking anything.
 */
export function requireLocalEnvValue(
  name: string,
  envFilePath: string = DEFAULT_ENV_FILE,
): string {
  const value = localEnvValue(name, envFilePath);
  if (value === undefined) throw new Error(`${name} is not configured in this environment`);
  return value;
}
