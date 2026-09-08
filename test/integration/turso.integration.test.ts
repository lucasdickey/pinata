// Real-provider integration checks for the configured Turso database and
// private Vercel Blob store (feature: turso-schema-and-provider-boundaries).
// These tests are the real-integration counterpart of the injected-database
// and fake-SDK focused tests; mocks never satisfy them.
//
// They run only when the Turso/Blob environment is present (locally via
// `node --env-file=.env.local node_modules/vitest/vitest.mjs run
// test/integration`), and skip silently otherwise so the CI gate stays green
// without credentials. All durable rows use a unique non-secret run id and
// are deleted (or rolled back) with verified cleanup. No credential, provider
// URL, or object content is ever printed.

import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { asc, eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { createDatabase, schema } from "../../src/lib/server/db/client";
import { createVercelBlobStore } from "../../src/lib/server/providers/blob";

const hasDatabaseEnv = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
const hasBlobEnv = Boolean(process.env.BLOB_READ_WRITE_TOKEN);


/** Concatenate an error's message and full cause chain for pattern checks. */
function errorText(error: unknown): string {
  let text = "";
  let current: unknown = error;
  while (current instanceof Error) {
    text += `\n${current.name}: ${current.message}`;
    current = current.cause;
  }
  return text;
}

/** Await a rejection whose message or cause chain matches `pattern`. */
async function expectRejection(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(errorText(error)).toMatch(pattern);
    return;
  }
  throw new Error(`expected rejection matching ${pattern}`);
}

const RUN_ID = `valrun-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const NOW = 1_800_000_000_000;

describe.skipIf(!hasDatabaseEnv)("real Turso migrations and constraints", () => {
  test("migrations apply idempotently and constraints, triggers, and cleanup hold", async () => {
    const db = createDatabase(process.env);
    expect(db).not.toBeNull();

    // Idempotent reapplication against the real database.
    await migrate(db!, { migrationsFolder: "drizzle" });
    await migrate(db!, { migrationsFolder: "drizzle" });

    const projectId = `${RUN_ID}-proj`;
    const pageId = `${RUN_ID}-page`;
    const captureId = `${RUN_ID}-cap`;
    const annotationId = `${RUN_ID}-ann`;

    // Real write/read round trip.
    await db!.insert(schema.projects).values({
      id: projectId,
      publicId: projectId,
      title: "validation run",
      rootUrl: "https://example.com/",
      shareTokenVersion: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db!.insert(schema.pages).values({
      id: pageId,
      projectId,
      requestedUrl: "https://example.com/#frag",
      normalizedUrl: "https://example.com/",
      sortIndex: 0,
      createdAt: NOW,
    });
    await db!.insert(schema.captures).values({
      id: captureId,
      pageId,
      variant: "desktop",
      attempt: 1,
      status: "pending",
      idempotencyKey: `${RUN_ID}-idem`,
      requestedUrl: "https://example.com/",
      viewportWidth: 1440,
      viewportHeight: 900,
      deviceScaleFactor: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db!.insert(schema.annotations).values({
      id: annotationId,
      captureId,
      kind: "pin",
      number: 1,
      geometryJson: JSON.stringify({ x: 1, y: 2 }),
      originalBody: "validation",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const readBack = await db!
      .select()
      .from(schema.pages)
      .orderBy(asc(schema.pages.sortIndex));
    expect(readBack.some((page) => page.id === pageId)).toBe(true);

    // Real unique-constraint rejection.
    await expectRejection(
      db!.insert(schema.pages).values({
        id: `${RUN_ID}-page-dup`,
        projectId,
        requestedUrl: "https://example.com/",
        normalizedUrl: "https://example.com/",
        sortIndex: 1,
        createdAt: NOW,
      }),
      /UNIQUE/i,
    );

    // Real trigger rejection, inside a transaction that is rolled back so no
    // immutable thread row is left behind.
    class Rollback extends Error {}
    const rollback = new Rollback();
    await expect(
      db!.transaction(async (tx) => {
        await tx.insert(schema.threadEntries).values({
          id: `${RUN_ID}-thr`,
          annotationId,
          actorRole: "founder",
          authorLabel: "founder",
          body: "trigger check",
          idempotencyKey: `${RUN_ID}-reply`,
          createdAt: NOW,
        });
        await expectRejection(
          tx
            .update(schema.threadEntries)
            .set({ body: "must not persist" })
            .where(eq(schema.threadEntries.id, `${RUN_ID}-thr`)),
          /append-only/i,
        );
        await expectRejection(
          tx.delete(schema.threadEntries).where(eq(schema.threadEntries.id, `${RUN_ID}-thr`)),
          /append-only/i,
        );
        throw rollback;
      }),
    ).rejects.toThrow(rollback);
    const leftoverEntries = await db!.select().from(schema.threadEntries);
    expect(leftoverEntries.some((entry) => entry.id === `${RUN_ID}-thr`)).toBe(false);

    // Verified cleanup of every disposable row (reverse dependency order;
    // thread entries never left the rolled-back transaction).
    await db!.delete(schema.annotations).where(eq(schema.annotations.id, annotationId));
    await db!.delete(schema.captures).where(eq(schema.captures.id, captureId));
    await db!.delete(schema.pages).where(eq(schema.pages.id, pageId));
    await db!.delete(schema.projects).where(eq(schema.projects.id, projectId));

    const remainingProjects = await db!.select().from(schema.projects);
    const remainingPages = await db!.select().from(schema.pages);
    const remainingCaptures = await db!.select().from(schema.captures);
    const remainingAnnotations = await db!.select().from(schema.annotations);
    for (const rows of [
      remainingProjects,
      remainingPages,
      remainingCaptures,
      remainingAnnotations,
    ]) {
      expect(rows.some((row) => String(row.id).startsWith(RUN_ID))).toBe(false);
    }
  }, 60_000);
});

describe.skipIf(!hasBlobEnv)("real private Vercel Blob lifecycle", () => {
  test("puts, reads, and deletes a disposable private object with exact bytes", async () => {
    const store = createVercelBlobStore(process.env);
    expect(store).not.toBeNull();

    const bytes = new Uint8Array(randomBytes(64));
    const digest = createHash("sha256").update(bytes).digest("hex");
    const pathname = `validation/${RUN_ID}.bin`;

    const put = await store!.put(pathname, bytes, "application/octet-stream");
    expect(put).toEqual({
      ok: true,
      value: { pathname, contentType: "application/octet-stream", bytes: bytes.length },
    });

    const metadata = await store!.head(pathname);
    expect(metadata.ok).toBe(true);
    if (metadata.ok) {
      expect(metadata.value.pathname).toBe(pathname);
      expect(metadata.value.bytes).toBe(bytes.length);
    }

    const fetched = await store!.get(pathname);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) {
      expect(createHash("sha256").update(fetched.value).digest("hex")).toBe(digest);
    }

    // The private object must not be readable without provider authorization.
    // The client carries no token; any response must be a denial, not bytes.
    const unauthenticated = await store!.head(`${pathname}.does-not-exist`);
    expect(unauthenticated).toEqual({ ok: false, error: "not-found" });

    const deleted = await store!.del(pathname);
    expect(deleted.ok).toBe(true);
    await expect(store!.head(pathname)).resolves.toEqual({ ok: false, error: "not-found" });
  }, 60_000);
});

// Direct client smoke: the configured database answers a trivial query
// without exposing any connection detail.
describe.skipIf(!hasDatabaseEnv)("real Turso connectivity", () => {
  test("answers a trivial query", async () => {
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
    const result = await client.execute("SELECT 1 AS one");
    expect(Number(result.rows[0]?.one)).toBe(1);
    client.close();
  }, 30_000);
});
