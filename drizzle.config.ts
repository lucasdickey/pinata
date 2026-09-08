// drizzle-kit configuration: generates the committed SQL migrations in
// drizzle/ from the canonical Drizzle schema. Applying migrations to the
// configured Turso database is done by `npm run db:migrate`
// (scripts/db-migrate.mjs), which never prints credentials.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "turso",
  schema: "./src/lib/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN ?? "",
  },
});
