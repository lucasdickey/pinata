// Shared helper for focused server tests: a deterministic in-memory libSQL
// database with the committed migrations applied, injected through the
// databaseFromClient seam. Real Turso proof lives in test/integration/.

import { createClient, type Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { databaseFromClient, type Database } from "../../src/lib/server/db/client";

export interface TestDb {
  client: Client;
  db: Database;
}

export async function createTestDb(): Promise<TestDb> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = databaseFromClient(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  return { client, db };
}
