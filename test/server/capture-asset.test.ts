// Authorized private screenshot delivery boundary (VAL-CAPTURE-014 delivery
// half; the founder/authority-loss extension lands with VAL-CAPTURE-010 in
// milestone 2).
//
// Every behavior is proven at the route with the real guard, an injected
// in-memory database, and a recording store: exact bytes and headers for
// GET/HEAD/range/conditional requests, generic byte-free denials for
// anonymous, logged-out, tampered, nonexistent, non-ready, cross-state, and
// integrity-failed requests, and no provider pathname anywhere in a response.

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DELETE as assetDELETE,
  GET as assetGET,
  HEAD as assetHEAD,
  PATCH as assetPATCH,
  POST as assetPOST,
  PUT as assetPUT,
} from "../../app/api/captures/[captureId]/asset/route";
import { EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import {
  ASSET_CACHE_CONTROL,
  ASSET_RANGE_UNIT,
  ASSET_VARY,
} from "../../src/lib/boundaries";
import { createEditorSession } from "../../src/lib/server/auth/session";
import { __setScreenshotStoreForTests } from "../../src/lib/server/captures/deps";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import type { ScreenshotStore } from "../../src/lib/server/providers/blob";
import { encodeSolidPng } from "../helpers/png";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "asset-route-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

const PNG = encodeSolidPng({ width: 64, height: 40, rgb: [24, 48, 96] });
const PNG_SHA256 = createHash("sha256").update(PNG).digest("hex");
const ETAG = `"${PNG_SHA256}"`;

let testDb: TestDb;
let session: { token: string; csrf: string };
let getCalls: string[];

interface SeedIds {
  projectId: string;
  pageId: string;
  captureId: string;
  blobPath: string;
}

function storeWith(bytes: Uint8Array | null): ScreenshotStore {
  getCalls = [];
  return {
    async put(pathname, body, contentType) {
      return { ok: true, value: { pathname, contentType, bytes: body.byteLength } };
    },
    async head(pathname) {
      return { ok: true, value: { pathname, contentType: "image/png", bytes: PNG.byteLength } };
    },
    async get(pathname) {
      getCalls.push(pathname);
      if (bytes === null) return { ok: false, error: "not-found" };
      return { ok: true, value: bytes };
    },
    async del() {
      return { ok: true, value: null };
    },
  };
}

async function seedReadyCapture(label: string, overrides: Record<string, unknown> = {}): Promise<SeedIds> {
  const projectId = `asset-${label}-project`;
  const pageId = `asset-${label}-page`;
  const captureId = `asset-${label}-capture`;
  const blobPath = `captures/${pageId}/${captureId}-internal.png`;
  await testDb.db.insert(schema.projects).values({
    id: projectId,
    publicId: projectId,
    title: `${label} project`,
    rootUrl: "https://fixture.example/",
    createdAt: T0,
    updatedAt: T0,
  });
  await testDb.db.insert(schema.pages).values({
    id: pageId,
    projectId,
    requestedUrl: "https://fixture.example/",
    normalizedUrl: "https://fixture.example/",
    sortIndex: 0,
    createdAt: T0,
  });
  await testDb.db.insert(schema.captures).values({
    id: captureId,
    pageId,
    variant: "desktop",
    attempt: 1,
    status: "ready",
    idempotencyKey: `${captureId}-key`,
    requestedUrl: "https://fixture.example/",
    finalUrl: "https://fixture.example/",
    viewportWidth: 1440,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    documentWidth: 64,
    documentHeight: 40,
    blobPath,
    blobContentType: "image/png",
    blobBytes: PNG.byteLength,
    imageHash: PNG_SHA256,
    capturedAt: T0 + 1_000,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  });
  return { projectId, pageId, captureId, blobPath };
}

interface RequestOptions {
  cookie?: string | null;
  headers?: Record<string, string>;
}

function build(url: string, method: string, options: RequestOptions = {}): Request {
  const headers = new Headers(options.headers);
  headers.set("host", "127.0.0.1:3100");
  const cookie =
    options.cookie === undefined ? `${EDITOR_SESSION_COOKIE}=${session.token}` : options.cookie;
  if (cookie) headers.set("cookie", cookie);
  return new Request(url, { method, headers });
}

const assetUrl = (captureId: string) => `${ORIGIN}/api/captures/${captureId}/asset`;
const get = (captureId: string, options?: RequestOptions) =>
  assetGET(build(assetUrl(captureId), "GET", options), {
    params: Promise.resolve({ captureId }),
  });
const head = (captureId: string, options?: RequestOptions) =>
  assetHEAD(build(assetUrl(captureId), "HEAD", options), {
    params: Promise.resolve({ captureId }),
  });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  __setScreenshotStoreForTests(storeWith(PNG));
  const created = createEditorSession(TEST_SECRET, T0);
  session = { token: created.token, csrf: created.payload.csrf };
});

afterEach(() => {
  __setScreenshotStoreForTests(undefined);
  __resetDatabaseCacheForTests();
  testDb.client.close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("authorized delivery", () => {
  test("GET returns the exact stored bytes with the published headers", async () => {
    const { captureId } = await seedReadyCapture("get");
    const response = await get(captureId);
    expect(response.status).toBe(200);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(PNG);
    expect(createHash("sha256").update(body).digest("hex")).toBe(PNG_SHA256);

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(PNG.byteLength));
    expect(response.headers.get("etag")).toBe(ETAG);
    expect(response.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
    expect(ASSET_CACHE_CONTROL).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("vary")).toBe(ASSET_VARY);
    expect(response.headers.get("accept-ranges")).toBe(ASSET_RANGE_UNIT);
    expect(response.headers.get("last-modified")).toBe(new Date(T0 + 1_000).toUTCString());
    // Delivery is one shot at the object: exactly one provider read.
    expect(getCalls).toHaveLength(1);
  });

  test("HEAD returns the same metadata and no body", async () => {
    const { captureId } = await seedReadyCapture("head");
    const response = await head(captureId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(PNG.byteLength));
    expect(response.headers.get("etag")).toBe(ETAG);
    expect(response.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.arrayBuffer()).toEqual(new ArrayBuffer(0));
  });

  test("a single explicit byte range returns 206 with the exact slice", async () => {
    const { captureId } = await seedReadyCapture("range");
    const response = await get(captureId, { headers: { range: "bytes=10-29" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 10-29/${PNG.byteLength}`);
    expect(response.headers.get("content-length")).toBe("20");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG.subarray(10, 30));
  });

  test("an open-ended range runs to the end of the object", async () => {
    const { captureId } = await seedReadyCapture("range-open");
    const response = await get(captureId, {
      headers: { range: `bytes=${PNG.byteLength - 8}-` },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes ${PNG.byteLength - 8}-${PNG.byteLength - 1}/${PNG.byteLength}`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG.subarray(PNG.byteLength - 8));
  });

  test("an unsatisfiable range returns 416 and no bytes", async () => {
    const { captureId } = await seedReadyCapture("range-unsat");
    const response = await get(captureId, {
      headers: { range: `bytes=${PNG.byteLength}-` },
    });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${PNG.byteLength}`);
    expect(response.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
    expect(await response.arrayBuffer()).toEqual(new ArrayBuffer(0));
  });

  test.each([
    ["non-numeric", "bytes=abc-def"],
    ["end before start", "bytes=29-10"],
    ["suffix range", "bytes=-10"],
    ["multiple ranges", "bytes=0-1,4-5"],
    ["wrong unit", "items=0-10"],
    ["bare word", "bytes"],
  ])("a malformed or unsupported range (%s) is rejected without bytes", async (_label, range) => {
    const { captureId } = await seedReadyCapture("range-bad");
    const response = await get(captureId, { headers: { range } });
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain("PNG");
    expect(Buffer.byteLength(text)).toBeLessThan(200);
  });

  test("If-None-Match with the stored hash answers 304 without fetching bytes", async () => {
    const { captureId } = await seedReadyCapture("conditional");
    for (const header of [ETAG, `W/${ETAG}`, `"other", ${ETAG}`, "*"]) {
      getCalls = [];
      const response = await get(captureId, { headers: { "if-none-match": header } });
      expect(response.status, header).toBe(304);
      expect(response.headers.get("etag")).toBe(ETAG);
      expect(response.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
      expect(await response.arrayBuffer()).toEqual(new ArrayBuffer(0));
      // The persisted hash alone answers the conditional; no provider read.
      expect(getCalls).toEqual([]);
    }
  });

  test("a stale validator receives the full current bytes", async () => {
    const { captureId } = await seedReadyCapture("conditional-stale");
    const response = await get(captureId, {
      headers: { "if-none-match": '"0000000000000000000000000000000000000000000000000000000000000000"' },
    });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  test("If-Modified-Since answers 304 only at or after the capture instant", async () => {
    const { captureId } = await seedReadyCapture("conditional-ims");
    const at = await get(captureId, {
      headers: { "if-modified-since": new Date(T0 + 1_000).toUTCString() },
    });
    expect(at.status).toBe(304);
    const before = await get(captureId, {
      headers: { "if-modified-since": new Date(T0).toUTCString() },
    });
    expect(before.status).toBe(200);
    // If-None-Match wins over If-Modified-Since when both are present.
    const both = await get(captureId, {
      headers: {
        "if-none-match": ETAG,
        "if-modified-since": new Date(T0).toUTCString(),
      },
    });
    expect(both.status).toBe(304);
  });

  test("no response body or header reveals the provider pathname", async () => {
    const { captureId, blobPath } = await seedReadyCapture("leak");
    for (const response of [
      await get(captureId),
      await head(captureId),
      await get(captureId, { headers: { range: "bytes=0-3" } }),
      await get(captureId, { headers: { "if-none-match": ETAG } }),
      await get("asset-nonexistent-capture"),
      await get(captureId, { cookie: null }),
    ]) {
      const serialized = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
      expect(serialized).not.toContain(blobPath);
      expect(serialized).not.toContain("vercel");
      const body = await response.text();
      if (response.headers.get("content-type")?.includes("json")) {
        expect(body).not.toContain(blobPath);
      }
    }
  });
});

describe("denials are generic and byte-free", () => {
  test("anonymous requests are denied before any provider read", async () => {
    const { captureId } = await seedReadyCapture("anon");
    const response = await get(captureId, { cookie: null });
    expect(response.status).toBe(401);
    expect(getCalls).toEqual([]);
    expect(response.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.text();
    expect(Buffer.byteLength(body)).toBeLessThan(200);
  });

  test("a tampered or expired session token is denied like an anonymous one", async () => {
    const { captureId } = await seedReadyCapture("tampered");
    const tampered = await get(captureId, {
      cookie: `${EDITOR_SESSION_COOKIE}=${session.token.slice(0, -2)}xx`,
    });
    expect(tampered.status).toBe(401);
    const expired = createEditorSession(TEST_SECRET, T0 - 100 * 3_600_000);
    const stale = await get(captureId, {
      cookie: `${EDITOR_SESSION_COOKIE}=${expired.token}`,
    });
    expect(stale.status).toBe(401);
    expect(getCalls).toEqual([]);
  });

  test("nonexistent, pending, capturing, and failed captures share one generic 404", async () => {
    const pending = await seedReadyCapture("pending", { status: "pending" });
    const capturing = await seedReadyCapture("capturing", { status: "capturing" });
    const failed = await seedReadyCapture("failed", { status: "failed" });
    const bodies: string[] = [];
    for (const id of [
      "asset-nonexistent-capture",
      pending.captureId,
      capturing.captureId,
      failed.captureId,
    ]) {
      const response = await get(id);
      expect(response.status, id).toBe(404);
      expect(response.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
      const body = await response.text();
      expect(Buffer.byteLength(body)).toBeLessThan(200);
      bodies.push(body);
    }
    // Existence is not distinguishable from the denial text.
    expect(new Set(bodies).size).toBe(1);
  });

  test("a ready capture under a deleted project is denied", async () => {
    const { projectId, captureId } = await seedReadyCapture("deleted-project");
    await testDb.db
      .update(schema.projects)
      .set({ deletedAt: T0 + 2_000 })
      .where(eq(schema.projects.id, projectId));
    const response = await get(captureId);
    expect(response.status).toBe(404);
  });

  test("a ready row with missing storage fields is denied before any read", async () => {
    const { captureId } = await seedReadyCapture("no-storage", { blobPath: null });
    const response = await get(captureId);
    expect(response.status).toBe(404);
    expect(getCalls).toEqual([]);
  });

  test("a stored object that fails integrity is never served", async () => {
    const { captureId } = await seedReadyCapture("integrity");
    // One byte different: the hash check must fail closed.
    const tamperedBytes = PNG.slice();
    tamperedBytes[tamperedBytes.length - 5]! ^= 0xff;
    __setScreenshotStoreForTests(storeWith(tamperedBytes));
    const tampered = await get(captureId);
    expect(tampered.status).toBe(404);

    // Wrong length alone also fails.
    __setScreenshotStoreForTests(storeWith(PNG.subarray(0, PNG.byteLength - 1)));
    const short = await get(captureId);
    expect(short.status).toBe(404);

    // The object going missing is the same generic denial.
    __setScreenshotStoreForTests(storeWith(null));
    const missing = await get(captureId);
    expect(missing.status).toBe(404);
  });

  test("a tampered persisted content type is denied at resolve time", async () => {
    const { captureId } = await seedReadyCapture("bad-type", {
      blobContentType: "text/html",
    });
    const response = await get(captureId);
    expect(response.status).toBe(404);
    expect(getCalls).toEqual([]);
  });

  test("a store failure is a bounded generic 503 with no bytes", async () => {
    const { captureId } = await seedReadyCapture("store-down");
    const failing = storeWith(PNG);
    failing.get = async () => ({ ok: false, error: "unavailable" });
    __setScreenshotStoreForTests(failing);
    const response = await get(captureId);
    expect(response.status).toBe(503);
    expect(Buffer.byteLength(await response.text())).toBeLessThan(200);
  });

  test.each(["POST", "PUT", "PATCH", "DELETE"] as const)(
    "%s is rejected as an unsupported method",
    async (method) => {
      const { captureId } = await seedReadyCapture("method");
      const handler = { POST: assetPOST, PUT: assetPUT, PATCH: assetPATCH, DELETE: assetDELETE }[
        method
      ];
      const response = handler();
      expect(response.status).toBe(405);
      expect(response.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
      expect(getCalls).toEqual([]);
    },
  );

  test("authorization is re-evaluated on every request", async () => {
    const { captureId } = await seedReadyCapture("reauth");
    expect((await get(captureId)).status).toBe(200);
    // Ending the session (cookie gone) ends delivery of the same URL.
    expect((await get(captureId, { cookie: null })).status).toBe(401);
    // A conditional replay with the old validator is still denied.
    const replay = await get(captureId, {
      cookie: null,
      headers: { "if-none-match": ETAG },
    });
    expect(replay.status).toBe(401);
    // And so is a range replay.
    expect(
      (await get(captureId, { cookie: null, headers: { range: "bytes=0-3" } })).status,
    ).toBe(401);
  });
});
