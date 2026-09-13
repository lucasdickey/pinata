// GET /api/projects/[publicId]/annotations (D077): every live pin in one
// project for the editor, in page, device, version, number order, each
// carrying its capture, page, and device. Authorization, ordering, the
// exclusions (tombstoned pins, non-ready captures), an empty project, and
// the generic denials for missing and tombstoned projects.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DELETE as annotationsDELETE,
  GET as annotationsGET,
  POST as annotationsPOST,
} from "../../app/api/projects/[publicId]/annotations/route";
import { EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { createEditorSession } from "../../src/lib/server/auth/session";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "project-annotations-route-session-secret";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let session: { token: string };

function request(publicId: string, cookie?: string | null): Request {
  const headers = new Headers();
  headers.set("host", "127.0.0.1:3100");
  const value = cookie === undefined ? `${EDITOR_SESSION_COOKIE}=${session.token}` : cookie;
  if (value) headers.set("cookie", value);
  return new Request(`${ORIGIN}/api/projects/${publicId}/annotations`, { method: "GET", headers });
}

const context = (publicId: string) => ({ params: Promise.resolve({ publicId }) });

function capture(
  id: string,
  pageId: string,
  variant: string,
  attempt: number,
  status: "ready" | "failed",
) {
  return {
    id,
    pageId,
    variant,
    attempt,
    status,
    idempotencyKey: `initial:${id}`,
    requestedUrl: "https://chickpea.co/",
    viewportWidth: variant === "desktop" ? 1440 : 390,
    viewportHeight: variant === "desktop" ? 900 : 844,
    deviceScaleFactor: 1,
    documentWidth: status === "ready" ? (variant === "desktop" ? 1440 : 390) : null,
    documentHeight: status === "ready" ? 8966 : null,
    imageHash: status === "ready" ? `hash-${id}` : null,
    errorCode: status === "failed" ? "total-timeout" : null,
    createdAt: T0,
    updatedAt: T0,
  };
}

function pin(id: string, captureId: string, number: number, status = "open") {
  return {
    id,
    captureId,
    kind: "pin",
    number,
    geometryJson: JSON.stringify({ x: number, y: number }),
    originalBody: `Note ${id}.`,
    status,
    createdAt: T0 + 2,
    updatedAt: T0 + 2,
  };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  session = { token: createEditorSession(TEST_SECRET, T0).token };

  await testDb.db.insert(schema.projects).values([
    {
      id: "proj-1",
      publicId: "pub-1",
      title: "Chickpea",
      rootUrl: "https://chickpea.co/",
      shareTokenVersion: 0,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: "proj-empty",
      publicId: "pub-empty",
      title: "Empty",
      rootUrl: "https://example.com/",
      shareTokenVersion: 0,
      createdAt: T0 + 1,
      updatedAt: T0 + 1,
    },
    {
      id: "proj-gone",
      publicId: "pub-gone",
      title: "Gone",
      rootUrl: "https://gone.example/",
      shareTokenVersion: 0,
      createdAt: T0 + 2,
      updatedAt: T0 + 2,
      deletedAt: T0 + 3,
    },
  ]);
  // Pages inserted out of submitted order on purpose: the read must follow
  // sortIndex, never insertion order.
  await testDb.db.insert(schema.pages).values([
    {
      id: "page-pricing",
      projectId: "proj-1",
      requestedUrl: "https://chickpea.co/pricing",
      normalizedUrl: "https://chickpea.co/pricing",
      sortIndex: 1,
      createdAt: T0,
    },
    {
      id: "page-root",
      projectId: "proj-1",
      requestedUrl: "https://chickpea.co/",
      normalizedUrl: "https://chickpea.co/",
      sortIndex: 0,
      createdAt: T0,
    },
    {
      id: "page-empty",
      projectId: "proj-empty",
      requestedUrl: "https://example.com/",
      normalizedUrl: "https://example.com/",
      sortIndex: 0,
      createdAt: T0,
    },
  ]);
  await testDb.db.insert(schema.captures).values([
    capture("root-d1", "page-root", "desktop", 1, "ready"),
    capture("root-m1", "page-root", "mobile", 1, "ready"),
    // Pricing Desktop was recaptured: two ready versions, older first.
    capture("pricing-d1", "page-pricing", "desktop", 1, "ready"),
    capture("pricing-d2", "page-pricing", "desktop", 2, "ready"),
    capture("pricing-m1", "page-pricing", "mobile", 1, "failed"),
    capture("empty-d1", "page-empty", "desktop", 1, "ready"),
  ]);
  await testDb.db.insert(schema.annotations).values([
    // Inserted in a scrambled order too.
    pin("pricing-d2-1", "pricing-d2", 1),
    pin("root-m1-1", "root-m1", 1, "replied"),
    pin("root-d1-2", "root-d1", 2),
    pin("root-d1-1", "root-d1", 1, "resolved"),
    { ...pin("root-d1-3", "root-d1", 3), deletedAt: T0 + 4 },
    pin("pricing-d1-1", "pricing-d1", 1),
    // A row on a failed capture (impossible through the API; the read must
    // still leave it out).
    pin("pricing-m1-1", "pricing-m1", 1),
  ]);
  await testDb.db.insert(schema.threadEntries).values([
    {
      id: "e1",
      annotationId: "root-m1-1",
      actorRole: "founder",
      authorLabel: "founder",
      kind: "message",
      body: "Reply.",
      idempotencyKey: "e1",
      createdAt: T0 + 5,
    },
    {
      id: "e2",
      annotationId: "root-m1-1",
      actorRole: "founder",
      authorLabel: "founder",
      kind: "message",
      body: "Second reply.",
      idempotencyKey: "e2",
      createdAt: T0 + 6,
    },
  ]);
});

afterEach(() => {
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GET /api/projects/[publicId]/annotations", () => {
  test("is editor-only: anonymous and founder-cookie-only callers get the generic denial", async () => {
    const anonymous = await annotationsGET(request("pub-1", null), context("pub-1"));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).not.toContain("chickpea");
    const founderOnly = await annotationsGET(
      request("pub-1", "pinata_founder_session=not-an-editor"),
      context("pub-1"),
    );
    expect(founderOnly.status).toBe(401);
  });

  test("a missing or tombstoned project is the same generic 404", async () => {
    const missing = await annotationsGET(request("no-such"), context("no-such"));
    expect(missing.status).toBe(404);
    const gone = await annotationsGET(request("pub-gone"), context("pub-gone"));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "Request rejected." });
  });

  test("returns every live pin in page, device, version, number order with its location", async () => {
    const response = await annotationsGET(request("pub-1"), context("pub-1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { annotations } = await response.json();
    expect(
      annotations.map((pin: { id: string; captureId: string; number: number }) => pin.id),
    ).toEqual(["root-d1-1", "root-d1-2", "root-m1-1", "pricing-d1-1", "pricing-d2-1"]);
    expect(annotations[0]).toMatchObject({
      id: "root-d1-1",
      captureId: "root-d1",
      pageId: "page-root",
      normalizedUrl: "https://chickpea.co/",
      variant: "desktop",
      attempt: 1,
      kind: "pin",
      number: 1,
      tip: { x: 1, y: 1 },
      body: "Note root-d1-1.",
      status: "resolved",
      unreadReplies: 0,
      revision: 1,
    });
    expect(annotations[2]).toMatchObject({
      captureId: "root-m1",
      variant: "mobile",
      status: "replied",
      // Two founder replies the editor has not seen (D075).
      unreadReplies: 2,
    });
    expect(annotations[3]).toMatchObject({ captureId: "pricing-d1", attempt: 1 });
    expect(annotations[4]).toMatchObject({
      captureId: "pricing-d2",
      normalizedUrl: "https://chickpea.co/pricing",
      attempt: 2,
    });
    // The tombstoned pin and the row on the failed capture are absent.
    const ids = annotations.map((pin: { id: string }) => pin.id);
    expect(ids).not.toContain("root-d1-3");
    expect(ids).not.toContain("pricing-m1-1");
  });

  test("an empty project answers an empty list, not an error", async () => {
    const response = await annotationsGET(request("pub-empty"), context("pub-empty"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ annotations: [] });
  });

  test("an unavailable database fails closed", async () => {
    __setDatabaseForTests(null);
    const response = await annotationsGET(request("pub-1"), context("pub-1"));
    expect(response.status).toBe(503);
    __setDatabaseForTests(testDb.db);
  });

  test("the route is read-only: other methods are 405", () => {
    expect(annotationsPOST().status).toBe(405);
    expect(annotationsDELETE().status).toBe(405);
  });
});

describe("rectangles in the project read (D079)", () => {
  test("a box is listed in the same page, device, version, number order with its kind and box", async () => {
    await testDb.db.insert(schema.annotations).values({
      id: "root-d1-box",
      captureId: "root-d1",
      kind: "rectangle",
      number: 4,
      geometryJson: JSON.stringify({ x: 100, y: 200, width: 300, height: 150 }),
      originalBody: "This whole card needs more air.",
      createdAt: T0 + 3,
      updatedAt: T0 + 3,
    });
    const response = await annotationsGET(request("pub-1"), context("pub-1"));
    expect(response.status).toBe(200);
    const { annotations } = await response.json();
    expect(annotations.map((mark: { id: string }) => mark.id)).toEqual([
      "root-d1-1",
      "root-d1-2",
      "root-d1-box",
      "root-m1-1",
      "pricing-d1-1",
      "pricing-d2-1",
    ]);
    expect(annotations[2]).toMatchObject({
      kind: "rectangle",
      number: 4,
      rect: { x: 100, y: 200, width: 300, height: 150 },
      captureId: "root-d1",
      pageId: "page-root",
      normalizedUrl: "https://chickpea.co/",
      variant: "desktop",
      attempt: 1,
      status: "open",
      unreadReplies: 0,
    });
    expect(annotations[2].tip).toBeUndefined();
  });
});
