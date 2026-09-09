// Real private-Blob proof for authorized screenshot delivery
// (VAL-CAPTURE-014 delivery half).
//
// Focused tests prove the delivery boundary against an injected store;
// nothing about the real private store — access privacy, stored metadata,
// exact bytes — can be proven that way. This suite creates a uniquely named
// disposable private object with deterministic non-sensitive bytes, verifies
// the provider metadata and hash, proves unauthenticated provider access is
// denied, and proves the application delivery boundary returns exactly those
// bytes with the published headers against real Turso rows.
//
// It runs only when the real configuration is present and skips silently
// otherwise (CI carries no secrets). Every durable row and object carries a
// unique non-secret run id and is deleted — and verified absent — in
// teardown. No credential, provider URL, or object content is ever printed;
// evidence is hashes, sizes, and statuses only.

import { randomBytes } from "node:crypto";
import { get as rawBlobGet, head as rawBlobHead } from "@vercel/blob";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  ASSET_CACHE_CONTROL,
  ASSET_RANGE_UNIT,
  ASSET_VARY,
} from "../../src/lib/boundaries";
import {
  deliverCaptureAsset,
  resolveDeliverableCapture,
} from "../../src/lib/server/captures/asset";
import { sha256Hex } from "../../src/lib/server/captures/image";
import { createDatabase, schema, type Database } from "../../src/lib/server/db/client";
import { createVercelBlobStore, type ScreenshotStore } from "../../src/lib/server/providers/blob";
import { encodeSolidPng } from "../helpers/png";

const ready = Boolean(
  process.env.BLOB_READ_WRITE_TOKEN &&
    process.env.TURSO_DATABASE_URL &&
    process.env.TURSO_AUTH_TOKEN,
);

const RUN_ID = `asset-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

/** Deterministic, non-sensitive disposable image bytes. */
const PNG = encodeSolidPng({ width: 64, height: 40, rgb: [90, 140, 200] });
const PNG_SHA256 = sha256Hex(PNG);
const BLOB_PATH = `captures/${RUN_ID}-page/${RUN_ID}-ready-${PNG_SHA256.slice(0, 16)}.png`;

let db: Database;
let store: ScreenshotStore;

const CAPTURE_ID = `${RUN_ID}-ready`;
const FAILED_CAPTURE_ID = `${RUN_ID}-failed`;
const PAGE_ID = `${RUN_ID}-page`;
const PROJECT_ID = `${RUN_ID}-project`;

const getAsset = (
  captureId: string,
  headers: { range?: string; ifNoneMatch?: string; ifModifiedSince?: string } = {},
) =>
  deliverCaptureAsset(db, store, captureId, {
    method: "GET",
    range: headers.range ?? null,
    ifNoneMatch: headers.ifNoneMatch ?? null,
    ifModifiedSince: headers.ifModifiedSince ?? null,
  });

beforeAll(async () => {
  if (!ready) return;
  db = createDatabase(process.env)!;
  store = createVercelBlobStore(process.env)!;

  const now = Date.now();
  await db.insert(schema.projects).values({
    id: PROJECT_ID,
    publicId: PROJECT_ID,
    title: `${RUN_ID} asset delivery`,
    rootUrl: "https://fixture.example/",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.pages).values({
    id: PAGE_ID,
    projectId: PROJECT_ID,
    requestedUrl: "https://fixture.example/",
    normalizedUrl: "https://fixture.example/",
    sortIndex: 0,
    createdAt: now,
  });

  // The private object goes up first, exactly the way capture execution
  // orders it: bytes stored privately before the row can be ready.
  const put = await store.put(BLOB_PATH, PNG, "image/png");
  if (!put.ok) throw new Error("disposable private put failed");

  await db.insert(schema.captures).values({
    id: CAPTURE_ID,
    pageId: PAGE_ID,
    variant: "desktop",
    attempt: 1,
    status: "ready",
    idempotencyKey: `${CAPTURE_ID}-key`,
    requestedUrl: "https://fixture.example/",
    finalUrl: "https://fixture.example/",
    viewportWidth: 1440,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    documentWidth: 64,
    documentHeight: 40,
    blobPath: BLOB_PATH,
    blobContentType: "image/png",
    blobBytes: PNG.byteLength,
    imageHash: PNG_SHA256,
    capturedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.captures).values({
    id: FAILED_CAPTURE_ID,
    pageId: PAGE_ID,
    variant: "mobile",
    attempt: 1,
    status: "failed",
    idempotencyKey: `${FAILED_CAPTURE_ID}-key`,
    requestedUrl: "https://fixture.example/",
    viewportWidth: 390,
    viewportHeight: 844,
    deviceScaleFactor: 1,
    errorCode: "total-timeout",
    errorMessage: "The capture exceeded its total time budget.",
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(async () => {
  if (!ready) return;
  await store.del(BLOB_PATH);
  await db.delete(schema.captures).where(like(schema.captures.pageId, `${RUN_ID}-%`));
  await db.delete(schema.pages).where(like(schema.pages.id, `${RUN_ID}-%`));
  await db.delete(schema.projects).where(like(schema.projects.id, `${RUN_ID}-%`));

  // Verified cleanup: the object and every run-scoped row are gone.
  const head = await store.head(BLOB_PATH);
  expect(head.ok).toBe(false);
  if (!head.ok) expect(head.error).toBe("not-found");
  const rows = await db
    .select({ id: schema.captures.id })
    .from(schema.captures)
    .where(like(schema.captures.pageId, `${RUN_ID}-%`));
  expect(rows).toEqual([]);
  const projects = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, PROJECT_ID));
  expect(projects).toEqual([]);
});

describe.skipIf(!ready)("real private Blob storage (VAL-CAPTURE-014)", () => {
  test("provider metadata and bytes match the persisted record exactly", async () => {
    const head = await store.head(BLOB_PATH);
    expect(head.ok).toBe(true);
    if (head.ok) {
      expect(head.value.contentType).toBe("image/png");
      expect(head.value.bytes).toBe(PNG.byteLength);
    }
    const bytes = await store.get(BLOB_PATH);
    expect(bytes.ok).toBe(true);
    if (bytes.ok) {
      expect(bytes.value).toEqual(PNG);
      expect(sha256Hex(bytes.value)).toBe(PNG_SHA256);
    }
    console.log(
      `[${RUN_ID}] stored bytes=${PNG.byteLength} sha256=${PNG_SHA256} type=image/png`,
    );
  });

  test("the private object cannot be read without provider authorization", async () => {
    // The adapter never exposes a provider URL, so the proof goes through the
    // same pathname-addressed SDK surface with a credential that is not the
    // configured one: both metadata and bytes must be refused. Provider error
    // bodies are never printed.
    let headDenied = false;
    try {
      await rawBlobHead(BLOB_PATH, { token: "pinata-denial-proof-not-the-token" });
    } catch {
      headDenied = true;
    }
    expect(headDenied).toBe(true);

    let getDenied = false;
    try {
      const result = await rawBlobGet(BLOB_PATH, {
        access: "private",
        token: "pinata-denial-proof-not-the-token",
        useCache: false,
      });
      getDenied = result === null || result.stream === null;
    } catch {
      getDenied = true;
    }
    expect(getDenied).toBe(true);
  });

  test("authorized delivery returns the exact stored bytes, type, length, and hash", async () => {
    const response = await getAsset(CAPTURE_ID);
    expect(response.status).toBe(200);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(PNG);
    expect(sha256Hex(body)).toBe(PNG_SHA256);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(PNG.byteLength));
    expect(response.headers.get("etag")).toBe(`"${PNG_SHA256}"`);
    expect(response.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("vary")).toBe(ASSET_VARY);
    expect(response.headers.get("accept-ranges")).toBe(ASSET_RANGE_UNIT);
    // The internal pathname never leaves the server.
    const headerText = [...response.headers.entries()].map(([k, v]) => `${k}:${v}`).join(";");
    expect(headerText).not.toContain(BLOB_PATH);
    console.log(`[${RUN_ID}] delivered bytes=${body.byteLength} sha256=${sha256Hex(body)}`);
  });

  test("range and conditional requests behave against the real store", async () => {
    const ranged = await getAsset(CAPTURE_ID, { range: "bytes=0-15" });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe(`bytes 0-15/${PNG.byteLength}`);
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(PNG.subarray(0, 16));

    const conditional = await getAsset(CAPTURE_ID, { ifNoneMatch: `"${PNG_SHA256}"` });
    expect(conditional.status).toBe(304);
    expect(await conditional.arrayBuffer()).toEqual(new ArrayBuffer(0));

    const unsatisfiable = await getAsset(CAPTURE_ID, { range: `bytes=${PNG.byteLength}-` });
    expect(unsatisfiable.status).toBe(416);
  });

  test("nonexistent and non-ready captures receive the same generic denial", async () => {
    const missing = await getAsset(`${RUN_ID}-nope`);
    const failed = await getAsset(FAILED_CAPTURE_ID);
    expect(missing.status).toBe(404);
    expect(failed.status).toBe(404);
    expect(await missing.text()).toBe(await failed.text());
    expect(await resolveDeliverableCapture(db, `${RUN_ID}-nope`)).toBeNull();
  });

  test("HEAD delivers metadata and no body", async () => {
    const response = await deliverCaptureAsset(db, store, CAPTURE_ID, {
      method: "HEAD",
      range: null,
      ifNoneMatch: null,
      ifModifiedSince: null,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(PNG.byteLength));
    expect(await response.arrayBuffer()).toEqual(new ArrayBuffer(0));
  });
});
