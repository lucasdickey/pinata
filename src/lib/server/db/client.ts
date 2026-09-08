// Server-only database boundary. All Turso/libSQL construction and
// credentials live here; no client-reachable module may import this file.
// Focused tests inject their own libSQL client (e.g. an in-memory database
// with the committed migrations applied) instead of touching the real
// configured database — but mocks never satisfy real Turso assertions.

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

/** Drizzle database handle over the Pinata schema. */
export type Database = LibSQLDatabase<typeof schema>;

export { schema };

export interface DatabaseEnv {
  TURSO_DATABASE_URL?: string | undefined;
  TURSO_AUTH_TOKEN?: string | undefined;
  [key: string]: string | undefined;
}

/**
 * Wrap an existing libSQL client as a Pinata database. This is the injection
 * seam for deterministic focused tests (in-memory or disposable databases).
 */
export function databaseFromClient(client: Client): Database {
  return drizzle(client, { schema });
}

/**
 * Build a database from environment configuration. Fails closed: returns
 * null when the configuration is absent rather than throwing with internals
 * or defaulting to a local file. Never logs the URL or token.
 */
export function createDatabase(env: DatabaseEnv): Database | null {
  const url = env.TURSO_DATABASE_URL;
  const authToken = env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return null;
  return databaseFromClient(createClient({ url, authToken }));
}

let cached: Database | null | undefined;

/**
 * Process-wide database for server routes, constructed lazily from
 * `process.env` on first use. Returns null when unconfigured; callers map
 * that to a bounded 503, never an echoed environment detail.
 */
export function getDatabase(): Database | null {
  if (cached === undefined) cached = createDatabase(process.env);
  return cached;
}

/** Test-only helper: drop the cached process-wide handle. */
export function __resetDatabaseCacheForTests(): void {
  cached = undefined;
}
