// Apply the committed Drizzle/libSQL migrations in drizzle/ to the configured
// Turso database. Idempotent: drizzle's migrator records applied migrations in
// the database and re-running applies only new ones. Never prints the database
// URL, token, or row contents. Run with: npm run db:migrate
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("db-migrate: database configuration is unavailable; set the Turso environment.");
  process.exit(1);
}

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const client = createClient({ url, authToken });
try {
  const db = drizzle(client);
  await migrate(db, { migrationsFolder });
  console.log("db-migrate: migrations applied (database is up to date).");
} catch (error) {
  // Bounded failure output: names and messages only, never connection details.
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`db-migrate: migration failed: ${message}`);
  process.exitCode = 1;
} finally {
  client.close();
}
