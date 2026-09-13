// Boundary tests for GET /api/captures/[captureId]/context (VAL-PIN-003):
// the authorized read that ranks the capture's own persisted manifest into
// the bounded candidate list the draft panel offers. Anonymous and
// unauthenticated calls, missing/non-ready captures, and malformed query
// points all receive bounded generic answers; a ready capture without a
// manifest yields an empty list (only "No element" remains).

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  GET as contextGET,
  POST as contextPOST,
} from "../../app/api/captures/[captureId]/context/route";
import { EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { NEARBY_CANDIDATES_MAX, MANIFEST_ELEMENT_KEYS } from "../../src/lib/boundaries";
import { createEditorSession } from "../../src/lib/server/auth/session";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "context-route-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let token: string;

function manifestElement(id: string, rect: { x: number; y: number; width: number; height: number }, kind = "text") {
  return {
    id,
    kind,
    tag: "p",
    role: "",
    text: `copy for ${id}`,
    accessibleName: "",
    hints: { id: "", classes: [], alt: "", title: "", testId: "" },
    path: ["body:0", "main:0", "p:0"],
    rect,
  };
}

const MANIFEST = {
  schemaVersion: 1,
  truncated: false,
  elements: [
    manifestElement("outer", { x: 0, y: 0, width: 1440, height: 8966 }, "landmark"),
    manifestElement("inner-cell", { x: 800, y: 4200, width: 120, height: 48 }, "table-cell"),
    manifestElement("distant", { x: 100, y: 8000, width: 200, height: 60 }, "heading"),
  ],
};

function contextRequest(captureId: string, query = "x=810&y=4210", cookie?: string | null) {
  const headers = new Headers();
  headers.set("host", "127.0.0.1:3100");
  const session = cookie === undefined ? token : cookie;
  if (session) headers.set("cookie", `${EDITOR_SESSION_COOKIE}=${session}`);
  return new Request(`${ORIGIN}/api/captures/${captureId}/context?${query}`, {
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
    title: "Chickpea",
    rootUrl: "https://chickpea.co/",
    shareTokenVersion: 0,
    createdAt: T0,
    updatedAt: T0,
  });
  await testDb.db.insert(schema.pages).values({
    id: "page-1",
    projectId: "proj-1",
    requestedUrl: "https://chickpea.co/",
    normalizedUrl: "https://chickpea.co/",
    sortIndex: 0,
    createdAt: T0,
  });
  const base = {
    pageId: "page-1",
    variant: "desktop",
    idempotencyKey: "initial",
    requestedUrl: "https://chickpea.co/",
    viewportWidth: 1440,
    viewportHeight: 900,
    deviceScaleFactor: 1,
    createdAt: T0,
    updatedAt: T0,
  };
  await testDb.db.insert(schema.captures).values([
    {
      ...base,
      id: "cap-ready",
      attempt: 1,
      status: "ready",
      documentWidth: 1440,
      documentHeight: 8966,
      imageHash: "hash-cap-ready",
      domManifestJson: JSON.stringify(MANIFEST),
      domManifestVersion: 1,
    },
    {
      ...base,
      id: "cap-nomanifest",
      attempt: 2,
      status: "ready",
      documentWidth: 1440,
      documentHeight: 8966,
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

describe("GET /api/captures/[captureId]/context", () => {
  test("ranks the capture's own manifest deterministically for the anchor point", async () => {
    const response = await contextGET(
      contextRequest("cap-ready"),
      routeContext("cap-ready"),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    // The containing small cell beats the containing huge landmark; the
    // distant heading still appears, last, inside the cap.
    expect(payload.candidates.map((c: { id: string }) => c.id)).toEqual([
      "inner-cell",
      "outer",
      "distant",
    ]);
    // Candidates are the bounded manifest element records — exact keys only.
    for (const candidate of payload.candidates) {
      expect(Object.keys(candidate).sort()).toEqual([...MANIFEST_ELEMENT_KEYS].sort());
    }
  });

  test("a ready capture without a manifest offers no candidates", async () => {
    const response = await contextGET(
      contextRequest("cap-nomanifest"),
      routeContext("cap-nomanifest"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).candidates).toEqual([]);
  });

  test("anonymous reads, missing captures, and non-ready captures are denied generically", async () => {
    const anonymous = await contextGET(
      contextRequest("cap-ready", "x=1&y=1", null),
      routeContext("cap-ready"),
    );
    expect(anonymous.status).toBe(401);
    for (const captureId of ["cap-missing", "cap-pending"]) {
      const response = await contextGET(
        contextRequest(captureId),
        routeContext(captureId),
      );
      expect(response.status).toBe(404);
      expect(JSON.stringify(await response.json())).not.toMatch(new RegExp(captureId));
    }
  });

  test("a box query (x, y, width, height) ranks by overlap: the enclosed cell first (D079)", async () => {
    // A box drawn around the pricing cell: the cell is entirely inside it,
    // the landmark only partly, and the distant heading not at all.
    const response = await contextGET(
      contextRequest("cap-ready", "x=790&y=4190&width=140&height=70"),
      routeContext("cap-ready"),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.candidates.map((c: { id: string }) => c.id)).toEqual([
      "inner-cell",
      "outer",
      "distant",
    ]);
    // A box that encloses nothing but sits on the landmark still ranks the
    // landmark first, then the others by distance.
    const empty = await contextGET(
      contextRequest("cap-ready", "x=100&y=100&width=50&height=50"),
      routeContext("cap-ready"),
    );
    const emptyPayload = await empty.json();
    expect(emptyPayload.candidates[0].id).toBe("outer");
  });

  test("a box with one size parameter, or a non-positive or non-finite size, is a bounded 400", async () => {
    for (const query of [
      "x=1&y=1&width=10",
      "x=1&y=1&height=10",
      "x=1&y=1&width=0&height=10",
      "x=1&y=1&width=10&height=-5",
      "x=1&y=1&width=abc&height=10",
      "x=1&y=1&width=10&height=Infinity",
    ]) {
      const response = await contextGET(
        contextRequest("cap-ready", query),
        routeContext("cap-ready"),
      );
      expect(response.status, query).toBe(400);
    }
  });

  test("missing or non-finite query points are a bounded 400", async () => {
    for (const query of ["", "x=1", "y=2", "x=abc&y=1", "x=1&y=Infinity"]) {
      const response = await contextGET(
        contextRequest("cap-ready", query),
        routeContext("cap-ready"),
      );
      expect(response.status, query).toBe(400);
    }
  });

  test("the candidate list never exceeds the shared cap", async () => {
    const many = {
      schemaVersion: 1,
      truncated: false,
      elements: Array.from({ length: NEARBY_CANDIDATES_MAX + 20 }, (_, index) =>
        manifestElement(`e${index + 1}`, { x: 0, y: 0, width: 100 + index, height: 100 }),
      ),
    };
    await testDb.db
      .update(schema.captures)
      .set({ domManifestJson: JSON.stringify(many) })
      .where(eqCapture("cap-ready"));
    const response = await contextGET(
      contextRequest("cap-ready", "x=10&y=10"),
      routeContext("cap-ready"),
    );
    expect((await response.json()).candidates).toHaveLength(NEARBY_CANDIDATES_MAX);
  });

  test("unsafe methods are 405", () => {
    expect(contextPOST().status).toBe(405);
  });
});

function eqCapture(id: string) {
  // Local helper so the update reads as plain SQL intent.
  return eq(schema.captures.id, id);
}
