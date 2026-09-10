// Boundary tests for GET /api/captures/[captureId]/manifest (VAL-CAPTURE-006,
// VAL-PIN-006): the authorized read of one ready capture's exact persisted
// manifest JSON. This is the HTTP surface the deferred
// curl(manifest-forbidden-value-sentinel-scan) evidence runs against: the
// route returns the persisted bytes verbatim — never recomputed, never
// recombined with anything else — so a sentinel scan of the response body is
// a scan of the persisted record. Anonymous calls, missing/non-ready
// captures, and manifest-less captures get bounded generic answers.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  GET as manifestGET,
  POST as manifestPOST,
} from "../../app/api/captures/[captureId]/manifest/route";
import { EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { createEditorSession } from "../../src/lib/server/auth/session";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "manifest-route-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let token: string;

// A manifest-shaped payload whose visible text is hostile: markup, controls,
// bidi overrides, and a genuinely visible URL as inert text. The route must
// serve these persisted bytes exactly — sanitization already happened at
// capture time; the read surface neither adds nor removes anything.
const HOSTILE_MANIFEST = {
  schemaVersion: 1,
  truncated: false,
  elements: [
    {
      id: "e1",
      kind: "text",
      tag: "p",
      role: "",
      text: 'MANIFEST-HOSTILE visible ‮desrever‬ <img src=x onerror="alert(1)">',
      accessibleName: "",
      hints: { id: "", classes: [], alt: "", title: "", testId: "" },
      path: ["body:0", "main:0", "p:4"],
      rect: { x: 24, y: 520, width: 700, height: 24 },
    },
    {
      id: "e2",
      kind: "link",
      tag: "a",
      role: "link",
      text: "MANIFEST-LINK visible docs text",
      accessibleName: "docs",
      hints: { id: "docs", classes: [], alt: "", title: "", testId: "" },
      path: ["body:0", "main:0", "a:0"],
      rect: { x: 24, y: 560, width: 220, height: 24 },
    },
  ],
};

function manifestRequest(captureId: string, cookie?: string | null) {
  const headers = new Headers();
  headers.set("host", "127.0.0.1:3100");
  const session = cookie === undefined ? token : cookie;
  if (session) headers.set("cookie", `${EDITOR_SESSION_COOKIE}=${session}`);
  return new Request(`${ORIGIN}/api/captures/${captureId}/manifest`, {
    method: "GET",
    headers,
  });
}

const routeContext = (captureId: string) => ({ params: Promise.resolve({ captureId }) });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  token = createEditorSession(TEST_SECRET, T0).token;

  await testDb.db.insert(schema.projects).values({
    id: "proj-1",
    publicId: "pub-1",
    title: "Fixture",
    rootUrl: "https://pinata-fixtures.vercel.app/manifest-v1.html",
    shareTokenVersion: 0,
    createdAt: T0,
    updatedAt: T0,
  });
  await testDb.db.insert(schema.pages).values({
    id: "page-1",
    projectId: "proj-1",
    requestedUrl: "https://pinata-fixtures.vercel.app/manifest-v1.html",
    normalizedUrl: "https://pinata-fixtures.vercel.app/manifest-v1.html",
    sortIndex: 0,
    createdAt: T0,
  });
  const base = {
    pageId: "page-1",
    variant: "desktop",
    requestedUrl: "https://pinata-fixtures.vercel.app/manifest-v1.html",
    viewportWidth: 1440,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    createdAt: T0,
    updatedAt: T0,
  };
  await testDb.db.insert(schema.captures).values([
    {
      ...base,
      id: "cap-manifest",
      attempt: 1,
      status: "ready",
      documentWidth: 1440,
      documentHeight: 2100,
      imageHash: "hash-cap-manifest",
      domManifestJson: JSON.stringify(HOSTILE_MANIFEST),
      domManifestVersion: 1,
      idempotencyKey: "initial:cap-manifest",
    },
    {
      ...base,
      id: "cap-nomanifest",
      attempt: 2,
      status: "ready",
      documentWidth: 1440,
      documentHeight: 2100,
      imageHash: "hash-cap-nomanifest",
      idempotencyKey: "initial:cap-nomanifest",
    },
    {
      ...base,
      id: "cap-pending",
      attempt: 3,
      status: "pending",
      idempotencyKey: "initial:cap-pending",
    },
  ]);
});

afterEach(() => {
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GET /api/captures/[captureId]/manifest", () => {
  test("returns the exact persisted manifest bytes for a ready capture", async () => {
    const response = await manifestGET(
      manifestRequest("cap-manifest"),
      routeContext("cap-manifest"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.text();
    // Byte-for-byte the persisted record: nothing recomputed or recombined.
    expect(body).toBe(JSON.stringify(HOSTILE_MANIFEST));
    // The hostile visible text stays inert data inside the JSON surface.
    expect(body).toContain("MANIFEST-HOSTILE");
    const parsed = JSON.parse(body) as { elements: { id: string }[] };
    expect(parsed.elements.map((element) => element.id)).toEqual(["e1", "e2"]);
  });

  test("anonymous reads are denied and missing/non-ready/manifest-less captures are generic 404s", async () => {
    const anonymous = await manifestGET(
      manifestRequest("cap-manifest", null),
      routeContext("cap-manifest"),
    );
    expect(anonymous.status).toBe(401);
    for (const captureId of ["cap-missing", "cap-pending", "cap-nomanifest"]) {
      const response = await manifestGET(
        manifestRequest(captureId),
        routeContext(captureId),
      );
      expect(response.status, captureId).toBe(404);
      expect(JSON.stringify(await response.json())).not.toMatch(new RegExp(captureId));
    }
  });

  test("unsafe methods are 405", () => {
    expect(manifestPOST().status).toBe(405);
  });
});
