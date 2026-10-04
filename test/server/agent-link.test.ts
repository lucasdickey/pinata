// The agent link (D121): the editor's create / rotate / revoke route, the
// public brief at /a/[token], and the screenshots it links to. Handlers are
// invoked directly with Request objects; all secrets are test sentinels.

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DELETE as linkDELETE,
  GET as linkGET,
  POST as linkPOST,
} from "../../app/api/projects/[publicId]/agent-link/route";
import { GET as briefGET, POST as briefPOST } from "../../app/a/[token]/route";
import {
  GET as shotGET,
  HEAD as shotHEAD,
} from "../../app/a/[token]/captures/[captureId]/route";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import {
  issueAgentLink,
  resolveAgentToken,
  revokeAgentLink,
} from "../../src/lib/server/agent/link";
import { createEditorSession } from "../../src/lib/server/auth/session";
import { __setScreenshotStoreForTests } from "../../src/lib/server/captures/deps";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import {
  issueFounderCapability,
  readShareStatus,
} from "../../src/lib/server/founder/capability";
import type { ScreenshotStore } from "../../src/lib/server/providers/blob";
import { encodeSolidPng } from "../helpers/png";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "agent-link-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

const PNG = encodeSolidPng({ width: 64, height: 40, rgb: [200, 40, 90] });
const PNG_SHA256 = createHash("sha256").update(PNG).digest("hex");

let testDb: TestDb;
let editor: { token: string; csrf: string };

function store(): ScreenshotStore {
  return {
    async put(pathname, body, contentType) {
      return { ok: true, value: { pathname, contentType, bytes: body.byteLength } };
    },
    async head(pathname) {
      return { ok: true, value: { pathname, contentType: "image/png", bytes: PNG.byteLength } };
    },
    async get() {
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
    title: `${label} site`,
    rootUrl: `https://${label}.example/`,
    createdAt: T0,
    updatedAt: T0,
  });
  await testDb.db.insert(schema.pages).values({
    id: pageId,
    projectId,
    requestedUrl: `https://${label}.example/`,
    normalizedUrl: `https://${label}.example/`,
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
    requestedUrl: `https://${label}.example/`,
    finalUrl: `https://${label}.example/`,
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
  await testDb.db.insert(schema.annotations).values([
    {
      id: `${label}-pin-1`,
      captureId,
      kind: "pin",
      number: 1,
      geometryJson: JSON.stringify({ x: 5, y: 6 }),
      originalBody: `${label}: make the headline bigger`,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: `${label}-pin-2`,
      captureId,
      kind: "pin",
      number: 2,
      geometryJson: JSON.stringify({ x: 20, y: 30 }),
      originalBody: `${label}: already handled`,
      status: "resolved",
      createdAt: T0,
      updatedAt: T0,
    },
  ]);
  return { projectId, publicId: `${label}-pub`, captureId };
}

function editorRequest(publicId: string, method: string, withCsrf = true): Request {
  const headers = new Headers({ origin: ORIGIN, host: "127.0.0.1:3100" });
  headers.set("cookie", `${EDITOR_SESSION_COOKIE}=${editor.token}`);
  if (withCsrf) headers.set(EDITOR_CSRF_HEADER, editor.csrf);
  return new Request(`${ORIGIN}/api/projects/${publicId}/agent-link`, { method, headers });
}
const linkCtx = (publicId: string) => ({ params: Promise.resolve({ publicId }) });

const brief = (token: string) =>
  briefGET(new Request(`${ORIGIN}/a/${token}`), { params: Promise.resolve({ token }) });
const shot = (token: string, captureId: string, method: "GET" | "HEAD" = "GET") =>
  (method === "GET" ? shotGET : shotHEAD)(
    new Request(`${ORIGIN}/a/${token}/captures/${captureId}`, { method }),
    { params: Promise.resolve({ token, captureId }) },
  );

function expectAgentSafety(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
}

async function createLink(publicId: string): Promise<string> {
  const response = await linkPOST(editorRequest(publicId, "POST"), linkCtx(publicId));
  expect(response.status).toBe(201);
  const payload = (await response.json()) as { link: { state: string }; path: string };
  expect(payload.link.state).toBe("active");
  const match = /^\/a\/([A-Za-z0-9_-]{43})$/.exec(payload.path);
  expect(match).not.toBeNull();
  return match![1]!;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  __setScreenshotStoreForTests(store());
  const created = createEditorSession(TEST_SECRET, T0);
  editor = { token: created.token, csrf: created.payload.csrf };
});

afterEach(() => {
  __setScreenshotStoreForTests(undefined);
  __resetDatabaseCacheForTests();
  testDb.client.close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("agent link lifecycle", () => {
  test("stores only a digest, and rotation ends the previous link", async () => {
    const { publicId } = await seedProject("own");
    const first = await issueAgentLink(testDb.db, publicId, T0);
    expect(first?.status).toEqual({ state: "active", version: 1, revokedAt: null });
    const rows = await testDb.db.select().from(schema.projects);
    expect(JSON.stringify(rows)).not.toContain(first!.token);

    expect((await resolveAgentToken(testDb.db, first!.token))?.publicId).toBe(publicId);
    const second = await issueAgentLink(testDb.db, publicId, T0 + 1);
    expect(second?.status.version).toBe(2);
    expect(await resolveAgentToken(testDb.db, first!.token)).toBeNull();
    expect((await resolveAgentToken(testDb.db, second!.token))?.publicId).toBe(publicId);
  });

  test("revoking ends the link, and never-issued has nothing to revoke", async () => {
    const { publicId } = await seedProject("own");
    expect(await revokeAgentLink(testDb.db, publicId, T0)).toEqual({
      ok: false,
      error: "never-issued",
    });
    const issued = await issueAgentLink(testDb.db, publicId, T0);
    const revoked = await revokeAgentLink(testDb.db, publicId, T0 + 5);
    expect(revoked).toEqual({
      ok: true,
      status: { state: "revoked", version: 1, revokedAt: T0 + 5 },
    });
    expect(await resolveAgentToken(testDb.db, issued!.token)).toBeNull();
  });

  test("the agent link and the founder link never affect each other", async () => {
    const { publicId } = await seedProject("own");
    const founder = await issueFounderCapability(testDb.db, publicId, T0);
    const agent = await issueAgentLink(testDb.db, publicId, T0);
    // Neither token opens the other link.
    expect(await resolveAgentToken(testDb.db, founder!.token)).toBeNull();
    await revokeAgentLink(testDb.db, publicId, T0 + 1);
    expect((await readShareStatus(testDb.db, publicId))?.state).toBe("active");
    expect(agent!.token).not.toBe(founder!.token);
  });

  test("malformed tokens and deleted projects resolve to nothing", async () => {
    const { publicId, projectId } = await seedProject("own");
    const issued = await issueAgentLink(testDb.db, publicId, T0);
    expect(await resolveAgentToken(testDb.db, "short")).toBeNull();
    expect(await resolveAgentToken(testDb.db, `${issued!.token}x`)).toBeNull();
    const { eq } = await import("drizzle-orm");
    await testDb.db
      .update(schema.projects)
      .set({ deletedAt: T0 + 1 })
      .where(eq(schema.projects.id, projectId));
    expect(await resolveAgentToken(testDb.db, issued!.token)).toBeNull();
  });
});

describe("editor route /api/projects/[publicId]/agent-link", () => {
  test("reads, creates, and revokes for a signed-in editor", async () => {
    const { publicId } = await seedProject("own");
    const before = await linkGET(editorRequest(publicId, "GET", false), linkCtx(publicId));
    expect(await before.json()).toEqual({ link: { state: "none", version: 0, revokedAt: null } });
    expect(before.headers.get("cache-control")).toBe("no-store");

    await createLink(publicId);
    const revoked = await linkDELETE(editorRequest(publicId, "DELETE"), linkCtx(publicId));
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as { link: { state: string } }).link.state).toBe("revoked");
  });

  test("refuses anyone who is not the signed-in editor", async () => {
    const { publicId } = await seedProject("own");
    const anonymous = await linkGET(
      new Request(`${ORIGIN}/api/projects/${publicId}/agent-link`),
      linkCtx(publicId),
    );
    expect(anonymous.status).toBe(401);
    const noCsrf = await linkPOST(editorRequest(publicId, "POST", false), linkCtx(publicId));
    expect(noCsrf.status).toBe(403);
    const crossSite = new Request(`${ORIGIN}/api/projects/${publicId}/agent-link`, {
      method: "POST",
      headers: {
        origin: "https://elsewhere.example",
        cookie: `${EDITOR_SESSION_COOKIE}=${editor.token}`,
        [EDITOR_CSRF_HEADER]: editor.csrf,
      },
    });
    expect((await linkPOST(crossSite, linkCtx(publicId))).status).toBe(403);
  });

  test("a missing project is a 404, and revoking a never-issued link is a 409", async () => {
    const { publicId } = await seedProject("own");
    expect((await linkPOST(editorRequest("nope", "POST"), linkCtx("nope"))).status).toBe(404);
    expect((await linkDELETE(editorRequest(publicId, "DELETE"), linkCtx(publicId))).status).toBe(
      409,
    );
  });
});

describe("public brief /a/[token]", () => {
  test("serves the open marks as Markdown with screenshot links under the same token", async () => {
    const own = await seedProject("own");
    const token = await createLink(own.publicId);
    const response = await brief(token);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expectAgentSafety(response);
    const text = await response.text();
    expect(text).toContain("# Pinata brief — own site");
    expect(text).toContain("## What to do");
    expect(text).toContain("own: make the headline bigger");
    // Resolved marks are left out, and the header says so.
    expect(text).not.toContain("already handled");
    expect(text).toContain("(1 resolved left out)");
    expect(text).toContain(`Screenshot: ${ORIGIN}/a/${token}/captures/${own.captureId}`);
  });

  test("an unknown, rotated, or revoked token is the same plain 404", async () => {
    const own = await seedProject("own");
    const first = await createLink(own.publicId);
    const second = await createLink(own.publicId);
    for (const token of [first, "x".repeat(43), "not-a-token"]) {
      const response = await brief(token);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found.\n");
      expectAgentSafety(response);
    }
    expect((await brief(second)).status).toBe(200);
    await linkDELETE(editorRequest(own.publicId, "DELETE"), linkCtx(own.publicId));
    expect((await brief(second)).status).toBe(404);
  });

  test("only reads", async () => {
    const response = await briefPOST();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("public screenshots /a/[token]/captures/[captureId]", () => {
  test("serves this project's screenshot bytes", async () => {
    const own = await seedProject("own");
    const token = await createLink(own.publicId);
    const response = await shot(token, own.captureId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expectAgentSafety(response);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect((await shot(token, own.captureId, "HEAD")).status).toBe(200);
  });

  test("never serves another project's screenshot, or any screenshot after revoke", async () => {
    const own = await seedProject("own");
    const other = await seedProject("other");
    const token = await createLink(own.publicId);
    const foreign = await shot(token, other.captureId);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe("Not found.\n");
    expect((await shot(token, "missing-capture")).status).toBe(404);
    await linkDELETE(editorRequest(own.publicId, "DELETE"), linkCtx(own.publicId));
    expect((await shot(token, own.captureId)).status).toBe(404);
  });
});
