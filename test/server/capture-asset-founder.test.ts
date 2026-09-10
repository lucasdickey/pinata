// The founder half of private screenshot delivery (VAL-CAPTURE-010): a
// valid founder capability session for the capture's project receives the
// exact bytes with the same headers the editor does; a founder of another
// project, a rotated or revoked capability, an expired or forged founder
// cookie, and an anonymous caller all receive the identical byte-free 401.
// The editor-only matrix lives in capture-asset.test.ts and is unchanged.
//
// The same dual-authority applies to the pin list read, proven here too.

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET as assetGET, HEAD as assetHEAD } from "../../app/api/captures/[captureId]/asset/route";
import { GET as annotationsGET } from "../../app/api/captures/[captureId]/annotations/route";
import { EDITOR_SESSION_COOKIE, FOUNDER_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { ASSET_CACHE_CONTROL, ASSET_VARY } from "../../src/lib/boundaries";
import { createEditorSession } from "../../src/lib/server/auth/session";
import { __setScreenshotStoreForTests } from "../../src/lib/server/captures/deps";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import {
  issueFounderCapability,
  revokeFounderCapability,
} from "../../src/lib/server/founder/capability";
import { createFounderSession } from "../../src/lib/server/founder/session";
import type { ScreenshotStore } from "../../src/lib/server/providers/blob";
import { encodeSolidPng } from "../helpers/png";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "asset-founder-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

const PNG = encodeSolidPng({ width: 64, height: 40, rgb: [24, 48, 96] });
const PNG_SHA256 = createHash("sha256").update(PNG).digest("hex");

let testDb: TestDb;
let getCalls: string[];
let editorToken: string;

function store(): ScreenshotStore {
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
      return { ok: true, value: PNG };
    },
    async del() {
      return { ok: true, value: null };
    },
  };
}

async function seedProject(label: string) {
  const projectId = `${label}-project`;
  const pageId = `${label}-page`;
  const captureId = `${label}-capture`;
  await testDb.db.insert(schema.projects).values({
    id: projectId,
    publicId: `${label}-pub`,
    title: label,
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
    blobPath: `captures/${pageId}/${captureId}-internal.png`,
    blobContentType: "image/png",
    blobBytes: PNG.byteLength,
    imageHash: PNG_SHA256,
    capturedAt: T0 + 1_000,
    createdAt: T0,
    updatedAt: T0,
  });
  await testDb.db.insert(schema.annotations).values({
    id: `${label}-pin`,
    captureId,
    kind: "pin",
    number: 1,
    geometryJson: JSON.stringify({ x: 5, y: 6 }),
    originalBody: `${label} comment`,
    createdAt: T0,
    updatedAt: T0,
  });
  return { projectId, publicId: `${label}-pub`, captureId };
}

async function founderCookieFor(publicId: string, projectId: string, version?: number) {
  const issued = version === undefined ? await issueFounderCapability(testDb.db, publicId, T0) : null;
  const session = createFounderSession(
    TEST_SECRET,
    { projectId, version: version ?? issued!.status.version },
    T0,
  );
  return `${FOUNDER_SESSION_COOKIE}=${session.token}`;
}

function request(url: string, method: string, cookie: string | null, headers: Record<string, string> = {}) {
  const h = new Headers(headers);
  h.set("host", "127.0.0.1:3100");
  if (cookie) h.set("cookie", cookie);
  return new Request(url, { method, headers: h });
}

const asset = (captureId: string, cookie: string | null, headers?: Record<string, string>) =>
  assetGET(request(`${ORIGIN}/api/captures/${captureId}/asset`, "GET", cookie, headers), {
    params: Promise.resolve({ captureId }),
  });
const assetHead = (captureId: string, cookie: string | null) =>
  assetHEAD(request(`${ORIGIN}/api/captures/${captureId}/asset`, "HEAD", cookie), {
    params: Promise.resolve({ captureId }),
  });
const pins = (captureId: string, cookie: string | null) =>
  annotationsGET(request(`${ORIGIN}/api/captures/${captureId}/annotations`, "GET", cookie), {
    params: Promise.resolve({ captureId }),
  });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  __setScreenshotStoreForTests(store());
  editorToken = createEditorSession(TEST_SECRET, T0).token;
});

afterEach(() => {
  __setScreenshotStoreForTests(undefined);
  __resetDatabaseCacheForTests();
  testDb.client.close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("founder asset delivery (VAL-CAPTURE-010)", () => {
  test("a bound founder session receives the exact bytes with the published headers", async () => {
    const own = await seedProject("own");
    const cookie = await founderCookieFor(own.publicId, own.projectId);
    const response = await asset(own.captureId, cookie);
    expect(response.status).toBe(200);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(PNG);
    expect(createHash("sha256").update(body).digest("hex")).toBe(PNG_SHA256);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(ASSET_CACHE_CONTROL);
    expect(response.headers.get("vary")).toBe(ASSET_VARY);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(getCalls).toHaveLength(1);

    // The editor's answer is byte-identical.
    const editorResponse = await asset(own.captureId, `${EDITOR_SESSION_COOKIE}=${editorToken}`);
    expect(new Uint8Array(await editorResponse.arrayBuffer())).toEqual(body);

    // HEAD, range, and conditionals work for the founder exactly as for the editor.
    const head = await assetHead(own.captureId, cookie);
    expect(head.status).toBe(200);
    expect(await head.arrayBuffer()).toEqual(new ArrayBuffer(0));
    const range = await asset(own.captureId, cookie, { range: "bytes=0-3" });
    expect(range.status).toBe(206);
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(PNG.subarray(0, 4));
    const conditional = await asset(own.captureId, cookie, { "if-none-match": `"${PNG_SHA256}"` });
    expect(conditional.status).toBe(304);
  });

  test("anonymous, foreign-project, forged, expired, rotated, and revoked founders share one byte-free 401", async () => {
    const own = await seedProject("own");
    const other = await seedProject("other");
    const ownCookie = await founderCookieFor(own.publicId, own.projectId);
    const otherCookie = await founderCookieFor(other.publicId, other.projectId);
    const forged = `${FOUNDER_SESSION_COOKIE}=${ownCookie.split("=")[1]!.slice(0, -3)}xyz`;
    const expired = `${FOUNDER_SESSION_COOKIE}=${
      createFounderSession(TEST_SECRET, { projectId: own.projectId, version: 1 }, T0 - 100 * 3_600_000).token
    }`;
    const staleVersion = await founderCookieFor(own.publicId, own.projectId, 99);

    const bodies = new Set<string>();
    const cases: [string, string | null][] = [
      ["anonymous", null],
      ["foreign project", otherCookie],
      ["forged", forged],
      ["expired", expired],
      ["wrong version", staleVersion],
    ];
    for (const [label, cookie] of cases) {
      getCalls = [];
      const response = await asset(own.captureId, cookie);
      expect(response.status, label).toBe(401);
      expect(response.headers.get("cache-control"), label).toBe(ASSET_CACHE_CONTROL);
      expect(getCalls, label).toEqual([]);
      const text = await response.text();
      expect(Buffer.byteLength(text), label).toBeLessThan(200);
      expect(text, label).not.toContain("PNG");
      bodies.add(text);
    }

    // The founder's own capture works until the editor rotates ...
    expect((await asset(own.captureId, ownCookie)).status).toBe(200);
    await issueFounderCapability(testDb.db, own.publicId, T0 + 1);
    getCalls = [];
    const rotated = await asset(own.captureId, ownCookie);
    expect(rotated.status).toBe(401);
    expect(getCalls).toEqual([]);
    bodies.add(await rotated.text());
    // ... and a session for the new version works until the editor revokes.
    const current = await founderCookieFor(own.publicId, own.projectId, 2);
    expect((await asset(own.captureId, current)).status).toBe(200);
    await revokeFounderCapability(testDb.db, own.publicId, T0 + 2);
    const revoked = await asset(own.captureId, current);
    expect(revoked.status).toBe(401);
    bodies.add(await revoked.text());
    // One denial shape for every case.
    expect(bodies.size).toBe(1);
    // The editor is unaffected by founder rotation and revocation.
    expect((await asset(own.captureId, `${EDITOR_SESSION_COOKIE}=${editorToken}`)).status).toBe(200);
  });

  test("a founder session inside its renewal threshold is renewed on delivery", async () => {
    const own = await seedProject("own");
    await issueFounderCapability(testDb.db, own.publicId, T0);
    const nearExpiry = createFounderSession(
      TEST_SECRET,
      { projectId: own.projectId, version: 1 },
      T0 - 11 * 3_600_000,
    );
    const response = await asset(own.captureId, `${FOUNDER_SESSION_COOKIE}=${nearExpiry.token}`);
    expect(response.status).toBe(200);
    const renewed = response.headers.getSetCookie().find((c) => c.startsWith(`${FOUNDER_SESSION_COOKIE}=`));
    expect(renewed).toBeDefined();
    expect(renewed).toContain("HttpOnly");
  });
});

describe("founder pin list read", () => {
  test("a bound founder lists its own capture's pins and nobody else's", async () => {
    const own = await seedProject("own");
    const other = await seedProject("other");
    const cookie = await founderCookieFor(own.publicId, own.projectId);
    const ownList = await pins(own.captureId, cookie);
    expect(ownList.status).toBe(200);
    const payload = (await ownList.json()) as { annotations: { id: string; body: string }[] };
    expect(payload.annotations.map((pin) => pin.id)).toEqual(["own-pin"]);
    expect(payload.annotations[0]!.body).toBe("own comment");

    const foreign = await pins(other.captureId, cookie);
    expect(foreign.status).toBe(401);
    const anonymous = await pins(own.captureId, null);
    expect(anonymous.status).toBe(401);
    expect(await foreign.text()).toBe(await anonymous.text());

    await revokeFounderCapability(testDb.db, own.publicId, T0 + 1);
    expect((await pins(own.captureId, cookie)).status).toBe(401);
  });
});
