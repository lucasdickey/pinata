// Focused tests for the committed Drizzle/libSQL schema and migrations
// (feature: turso-schema-and-provider-boundaries). These run against a
// deterministic in-memory libSQL database with the committed migrations
// applied — the injected-database boundary. The real configured Turso
// database is verified separately in test/integration/turso.integration.test.ts.

import { createClient, type Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { asc } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { databaseFromClient, schema, type Database } from "../../src/lib/server/db/client";

const MIGRATIONS_FOLDER = "drizzle";

interface TestDb {
  client: Client;
  db: Database;
}

async function createTestDb(): Promise<TestDb> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = databaseFromClient(client);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { client, db };
}

const NOW = 1_800_000_000_000;

let sequence = 0;
function id(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence.toString().padStart(4, "0")}`;
}

async function seedProject(db: Database) {
  const project = {
    id: id("proj"),
    publicId: id("pub"),
    title: "Review",
    rootUrl: "https://example.com/",
    shareTokenVersion: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
  await db.insert(schema.projects).values(project);
  return project;
}

async function seedPage(db: Database, projectId: string, sortIndex = 0) {
  const page = {
    id: id("page"),
    projectId,
    requestedUrl: `https://example.com/p${sortIndex}#frag`,
    normalizedUrl: `https://example.com/p${sortIndex}`,
    sortIndex,
    createdAt: NOW,
  };
  await db.insert(schema.pages).values(page);
  return page;
}

async function seedCapture(db: Database, pageId: string, attempt = 1) {
  const capture = {
    id: id("cap"),
    pageId,
    variant: "desktop" as const,
    attempt,
    status: "pending" as const,
    idempotencyKey: id("idem"),
    requestedUrl: "https://example.com/p0",
    viewportWidth: 1440,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  await db.insert(schema.captures).values(capture);
  return capture;
}

async function seedAnnotation(db: Database, captureId: string, number = 1) {
  const annotation = {
    id: id("ann"),
    captureId,
    kind: "pin" as const,
    number,
    geometryJson: JSON.stringify({ x: 10, y: 20 }),
    originalBody: "Move this heading up.",
    createdAt: NOW,
    updatedAt: NOW,
  };
  await db.insert(schema.annotations).values(annotation);
  return annotation;
}

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

function seedThreadEntry(annotationId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: id("thr"),
    annotationId,
    actorRole: "founder" as const,
    authorLabel: "founder" as const,
    body: "Thanks, will look.",
    idempotencyKey: id("reply"),
    createdAt: NOW,
    ...overrides,
  };
}

describe("migrations", () => {
  test("apply idempotently to a fresh database", async () => {
    const { client, db } = await createTestDb();
    // Second application must be a no-op.
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const applied = await client.execute(
      "SELECT COUNT(*) AS n FROM __drizzle_migrations",
    );
    expect(Number(applied.rows[0]?.n)).toBe(5);
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = tables.rows.map((row) => String(row.name));
    for (const table of [
      "projects",
      "pages",
      "captures",
      "capture_cleanups",
      "capture_leases",
      "annotations",
      "thread_entries",
      "idempotency_keys",
      "rate_limit_buckets",
      "schema_meta",
    ]) {
      expect(names).toContain(table);
    }
    client.close();
  });

  test("install the append-only triggers on thread_entries", async () => {
    const { client } = await createTestDb();
    const triggers = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    );
    const names = triggers.rows.map((row) => String(row.name));
    expect(names).toContain("thread_entries_reject_update");
    expect(names).toContain("thread_entries_reject_delete");
    client.close();
  });
});

describe("relationships and ordering", () => {
  test("persists the project/page/capture/annotation/thread chain and reads it back in order", async () => {
    const { client, db } = await createTestDb();
    const project = await seedProject(db);
    const laterPage = await seedPage(db, project.id, 1);
    const firstPage = await seedPage(db, project.id, 0);
    const capture = await seedCapture(db, firstPage.id);
    const annotation = await seedAnnotation(db, capture.id);
    await db
      .insert(schema.threadEntries)
      .values(seedThreadEntry(annotation.id, { createdAt: NOW + 2, id: "thr-b" }));
    await db
      .insert(schema.threadEntries)
      .values(seedThreadEntry(annotation.id, { createdAt: NOW + 1, id: "thr-a" }));

    const pages = await db
      .select()
      .from(schema.pages)
      .orderBy(asc(schema.pages.sortIndex));
    expect(pages.map((page) => page.id)).toEqual([firstPage.id, laterPage.id]);
    // Fragments never reach the stored normalized identity.
    expect(pages[0]?.normalizedUrl).toBe("https://example.com/p0");

    const entries = await db
      .select()
      .from(schema.threadEntries)
      .orderBy(asc(schema.threadEntries.createdAt), asc(schema.threadEntries.id));
    expect(entries.map((entry) => entry.id)).toEqual(["thr-a", "thr-b"]);
    expect(entries[0]).toMatchObject({ actorRole: "founder", authorLabel: "founder" });
    client.close();
  });
});

describe("unique and foreign-key constraints", () => {
  test("reject duplicate normalized URLs within a project", async () => {
    const { client, db } = await createTestDb();
    const project = await seedProject(db);
    await seedPage(db, project.id, 0);
    await expectRejection(
      db.insert(schema.pages).values({
        id: id("page"),
        projectId: project.id,
        requestedUrl: "https://example.com/p0#other-fragment",
        normalizedUrl: "https://example.com/p0",
        sortIndex: 1,
        createdAt: NOW,
      }),
      /UNIQUE/i,
    );
    client.close();
  });

  test("allow the same normalized URL in a different project", async () => {
    const { client, db } = await createTestDb();
    const first = await seedProject(db);
    const second = await seedProject(db);
    await seedPage(db, first.id, 0);
    const page = await seedPage(db, second.id, 0);
    expect(page.projectId).toBe(second.id);
    client.close();
  });

  test("reject rows whose parent does not exist", async () => {
    const { client, db } = await createTestDb();
    await expectRejection(seedPage(db, "proj-missing"), /FOREIGN KEY/i);
    client.close();
  });

  test("reject duplicate capture attempts and reused idempotency keys", async () => {
    const { client, db } = await createTestDb();
    const project = await seedProject(db);
    const page = await seedPage(db, project.id);
    const capture = await seedCapture(db, page.id, 1);
    await expectRejection(seedCapture(db, page.id, 1), /UNIQUE/i);
    await expectRejection(
      db.insert(schema.captures).values({
        ...capture,
        id: id("cap"),
        attempt: 2,
      }),
      /UNIQUE/i,
    ); // same (page, variant, idempotency_key)
    client.close();
  });

  test("reject reused blob paths across attempts", async () => {
    const { client, db } = await createTestDb();
    const project = await seedProject(db);
    const page = await seedPage(db, project.id);
    await seedCapture(db, page.id, 1);
    const retry = await seedCapture(db, page.id, 2);
    await client.execute({
      sql: "UPDATE captures SET blob_path = ? WHERE id = ?",
      args: ["captures/test/one.webp", retry.id],
    });
    await expectRejection(
      client.execute({
        sql: "UPDATE captures SET blob_path = ? WHERE id = ?",
        args: ["captures/test/one.webp", (await seedCapture(db, page.id, 3)).id],
      }),
      /UNIQUE/i,
    );
    client.close();
  });

  test("reject duplicate annotation numbers per capture and duplicate thread idempotency keys", async () => {
    const { client, db } = await createTestDb();
    const project = await seedProject(db);
    const page = await seedPage(db, project.id);
    const capture = await seedCapture(db, page.id);
    const annotation = await seedAnnotation(db, capture.id, 1);
    await expectRejection(seedAnnotation(db, capture.id, 1), /UNIQUE/i);

    const entry = seedThreadEntry(annotation.id);
    await db.insert(schema.threadEntries).values(entry);
    await expectRejection(
      db
        .insert(schema.threadEntries)
        .values(seedThreadEntry(annotation.id, { idempotencyKey: entry.idempotencyKey })),
      /UNIQUE/i,
    );
    // The same key on a different annotation is an independent retry scope.
    const other = await seedAnnotation(db, capture.id, 2);
    await db
      .insert(schema.threadEntries)
      .values(seedThreadEntry(other.id, { idempotencyKey: entry.idempotencyKey }));
    client.close();
  });
});

describe("check constraints", () => {
  test("reject capture variants and statuses outside the architecture set", async () => {
    const { client, db } = await createTestDb();
    const project = await seedProject(db);
    const page = await seedPage(db, project.id);
    const base = {
      pageId: page.id,
      attempt: 1,
      idempotencyKey: id("idem"),
      requestedUrl: "https://example.com/p0",
      viewportWidth: 1440,
      viewportHeight: 900,
      deviceScaleFactor: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await expectRejection(
      db.insert(schema.captures).values({ ...base, id: id("cap"), variant: "tablet", status: "pending" }),
      /CHECK/i,
    );
    await expectRejection(
      db.insert(schema.captures).values({ ...base, id: id("cap"), variant: "desktop", status: "done" }),
      /CHECK/i,
    );
    client.close();
  });

  test("reject annotation kinds and thread identities outside the architecture set", async () => {
    const { client, db } = await createTestDb();
    const project = await seedProject(db);
    const page = await seedPage(db, project.id);
    const capture = await seedCapture(db, page.id);
    await expectRejection(
      db.insert(schema.annotations).values({
        id: id("ann"),
        captureId: capture.id,
        kind: "freehand",
        number: 1,
        geometryJson: "{}",
        originalBody: "x",
        createdAt: NOW,
        updatedAt: NOW,
      }),
      /CHECK/i,
    );

    const annotation = await seedAnnotation(db, capture.id);
    await expectRejection(
      db
        .insert(schema.threadEntries)
        .values(seedThreadEntry(annotation.id, { actorRole: "admin" })),
      /CHECK/i,
    );
    await expectRejection(
      db
        .insert(schema.threadEntries)
        .values(seedThreadEntry(annotation.id, { authorLabel: "Mallory" })),
      /CHECK/i,
    );
    client.close();
  });
});

describe("thread entry immutability (VAL-THREAD-002)", () => {
  test("database triggers reject UPDATE and DELETE on thread_entries", async () => {
    const { client, db } = await createTestDb();
    const project = await seedProject(db);
    const page = await seedPage(db, project.id);
    const capture = await seedCapture(db, page.id);
    const annotation = await seedAnnotation(db, capture.id);
    const entry = seedThreadEntry(annotation.id);
    await db.insert(schema.threadEntries).values(entry);

    await expectRejection(
      client.execute({
        sql: "UPDATE thread_entries SET body = ? WHERE id = ?",
        args: ["edited", entry.id],
      }),
      /append-only/i,
    );
    await expectRejection(
      client.execute({ sql: "DELETE FROM thread_entries WHERE id = ?", args: [entry.id] }),
      /append-only/i,
    );

    // The rejected attempts changed nothing.
    const rows = await db.select().from(schema.threadEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: entry.id, body: entry.body });
    client.close();
  });

  test("annotation rows cannot be hard-deleted while entries reference them", async () => {
    const { client, db } = await createTestDb();
    const project = await seedProject(db);
    const page = await seedPage(db, project.id);
    const capture = await seedCapture(db, page.id);
    const annotation = await seedAnnotation(db, capture.id);
    await db.insert(schema.threadEntries).values(seedThreadEntry(annotation.id));
    await expectRejection(
      client.execute({ sql: "DELETE FROM annotations WHERE id = ?", args: [annotation.id] }),
      /FOREIGN KEY/i,
    );
    client.close();
  });
});

describe("operational tables", () => {
  test("idempotency records key on (scope, key) and keep payload digests", async () => {
    const { client, db } = await createTestDb();
    await db.insert(schema.idempotencyKeys).values({
      scope: "editor:create-project",
      key: "key-1",
      payloadDigest: "a".repeat(64),
      resultJson: JSON.stringify({ projectId: "proj-1" }),
      createdAt: NOW,
    });
    await expectRejection(
      db.insert(schema.idempotencyKeys).values({
        scope: "editor:create-project",
        key: "key-1",
        payloadDigest: "b".repeat(64),
        createdAt: NOW,
      }),
      /UNIQUE|PRIMARY/i,
    );
    client.close();
  });

  test("capture leases grant one slot per capture and one capture per slot", async () => {
    const { client, db } = await createTestDb();
    await db.insert(schema.captureLeases).values({
      slot: 0,
      captureId: "cap-a",
      expiresAt: NOW + 1_000,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await expectRejection(
      db.insert(schema.captureLeases).values({
        slot: 0,
        captureId: "cap-b",
        expiresAt: NOW + 1_000,
        createdAt: NOW,
        updatedAt: NOW,
      }),
      /UNIQUE|PRIMARY/i,
    );
    await expectRejection(
      db.insert(schema.captureLeases).values({
        slot: 1,
        captureId: "cap-a",
        expiresAt: NOW + 1_000,
        createdAt: NOW,
        updatedAt: NOW,
      }),
      /UNIQUE/i,
    );
    client.close();
  });

  test("rate-limit buckets persist digested keys and counters durably", async () => {
    const { client, db } = await createTestDb();
    const bucketKey = "c".repeat(64); // SHA-256 hex of scope + identifier, never plaintext.
    await db.insert(schema.rateLimitBuckets).values({
      bucketKey,
      count: 1,
      windowStartedAt: NOW,
      updatedAt: NOW,
    });
    await client.execute({
      sql: "UPDATE rate_limit_buckets SET count = count + 1, updated_at = ? WHERE bucket_key = ?",
      args: [NOW + 1, bucketKey],
    });
    const rows = await db.select().from(schema.rateLimitBuckets);
    expect(rows).toEqual([
      { bucketKey, count: 2, windowStartedAt: NOW, updatedAt: NOW + 1 },
    ]);
    client.close();
  });
});
