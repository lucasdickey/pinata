// Importing captures (D131): POST /api/imports from the editor's page and
// from the Chrome extension's bearer token (D132), against the committed
// migrations in an in-memory libSQL database and a recording store. The
// image is a real PNG whose pixel size has to match the document it claims.

import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET as contextGET } from "../../app/api/captures/[captureId]/context/route";
import { POST as importPOST } from "../../app/api/imports/route";
import { POST as projectsPOST } from "../../app/api/projects/route";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import {
  MAX_CAPTURE_ATTEMPTS_PER_PROJECT,
  UPLOAD_REQUEST_MAX_BYTES,
} from "../../src/lib/boundaries";
import { createExtensionToken } from "../../src/lib/server/auth/extension-token";
import { createEditorSession } from "../../src/lib/server/auth/session";
import { __setScreenshotStoreForTests } from "../../src/lib/server/captures/deps";
import { __setContinuationSchedulerForTests } from "../../src/lib/server/captures/continuation";
import { retryCapture } from "../../src/lib/server/captures/retry";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import { archiveProject } from "../../src/lib/server/projects/archive";
import { listProjectHierarchies } from "../../src/lib/server/projects/hierarchy";
import { encodeSolidPng } from "../helpers/png";
import { recordingStore, type RecordingStore } from "./capture-provider-fakes";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "capture-import-session-secret-sentinel-0123456789";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let recording: RecordingStore;
let session: { token: string; csrf: string };

const element = (id: string, rect: { x: number; y: number; width: number; height: number }) => ({
  id,
  kind: "control",
  tag: "button",
  role: "",
  text: `Button ${id}`,
  accessibleName: `Button ${id}`,
  hints: { id: "", classes: [], alt: "", title: "", testId: "" },
  path: ["html:1", "body:1", "button:1"],
  rect,
});

const MANIFEST = {
  schemaVersion: 1,
  truncated: false,
  elements: [element("e1", { x: 10, y: 10, width: 60, height: 20 }), element("e2", { x: 10, y: 50, width: 60, height: 20 })],
};

interface ImportOptions {
  meta: Record<string, unknown>;
  image?: Uint8Array;
  imageType?: string;
  auth?: "editor" | "bearer" | "none";
  bearer?: string;
  origin?: string | null;
  csrf?: string | null;
}

function png(width = 80, height = 120): Uint8Array {
  return encodeSolidPng({ width, height, rgb: [200, 120, 40] });
}

function importRequest(options: ImportOptions): Request {
  const form = new FormData();
  form.set("meta", JSON.stringify(options.meta));
  const image = options.image ?? png();
  form.set("image", new Blob([image as BlobPart], { type: options.imageType ?? "image/png" }), "capture.png");
  const headers = new Headers();
  const auth = options.auth ?? "editor";
  if (auth === "editor") {
    const origin = options.origin === undefined ? ORIGIN : options.origin;
    if (origin) headers.set("origin", origin);
    headers.set("host", "127.0.0.1:3100");
    headers.set("cookie", `${EDITOR_SESSION_COOKIE}=${session.token}`);
    const csrf = options.csrf === undefined ? session.csrf : options.csrf;
    if (csrf) headers.set(EDITOR_CSRF_HEADER, csrf);
  } else if (auth === "bearer") {
    headers.set("origin", "chrome-extension://abcdefghijklmnopabcdefghijklmnop");
    headers.set("authorization", `Bearer ${options.bearer ?? createExtensionToken(TEST_SECRET, T0).token}`);
  }
  return new Request(`${ORIGIN}/api/imports`, { method: "POST", headers, body: form });
}

const baseMeta = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: crypto.randomUUID(),
  target: { newProject: {} },
  url: "https://app.example.com/settings?tab=billing#plans",
  variant: "desktop",
  capturedAt: T0 - 60_000,
  document: { width: 80, height: 120 },
  manifest: MANIFEST,
  ...overrides,
});

async function send(options: ImportOptions) {
  const response = await importPOST(importRequest(options));
  const text = await response.text();
  return { response, body: text ? (JSON.parse(text) as Record<string, any>) : null };
}

async function createUrlProject(key: string) {
  const headers = new Headers({
    origin: ORIGIN,
    host: "127.0.0.1:3100",
    "content-type": "application/json",
    cookie: `${EDITOR_SESSION_COOKIE}=${session.token}`,
    [EDITOR_CSRF_HEADER]: session.csrf,
  });
  const response = await projectsPOST(
    new Request(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({ rootUrl: "https://app.example.com/settings?tab=billing", idempotencyKey: key }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).project as {
    projectId: string;
    publicId: string;
    pages: { id: string }[];
  };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  recording = recordingStore();
  __setScreenshotStoreForTests(recording.store);
  __setContinuationSchedulerForTests(() => undefined);
  const created = createEditorSession(TEST_SECRET, T0);
  session = { token: created.token, csrf: created.payload.csrf };
});

afterEach(() => {
  __setScreenshotStoreForTests(undefined);
  __setContinuationSchedulerForTests(null);
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("POST /api/imports from the editor's page", () => {
  test("a new project files the upload as a ready Desktop attempt with its element list", async () => {
    const { response, body } = await send({ meta: baseMeta() });
    expect(response.status).toBe(201);
    expect(body!.project.created).toBe(true);
    expect(body!.project.title).toBe("app.example.com");
    // The fragment is dropped from the page identity; the query is kept.
    expect(body!.page).toMatchObject({
      normalizedUrl: "https://app.example.com/settings?tab=billing",
      created: true,
    });
    expect(body!.capture).toMatchObject({ variant: "desktop", attempt: 1, elements: 2 });

    const [capture] = await testDb.db
      .select()
      .from(schema.captures)
      .where(eq(schema.captures.id, body!.capture.id));
    expect(capture).toMatchObject({
      status: "ready",
      origin: "upload",
      documentWidth: 80,
      documentHeight: 120,
      blobContentType: "image/png",
      domManifestVersion: 1,
      capturedAt: T0 - 60_000,
      viewportWidth: 1440,
    });
    expect(JSON.parse(capture!.domManifestJson!).elements).toHaveLength(2);
    expect(recording.puts).toHaveLength(1);
    expect(recording.puts[0]!.pathname).toBe(capture!.blobPath);
    expect(capture!.blobPath).toMatch(new RegExp(`^captures/${capture!.pageId}/${capture!.id}-[0-9a-f]{16}\\.png$`));

    // The hierarchy shows a usable Desktop capture that is never offered a
    // provider retry, and a Mobile device with nothing yet.
    const [project] = await listProjectHierarchies(testDb.db, T0);
    const desktop = project!.pages[0]!.devices.find((device) => device.variant === "desktop")!;
    expect(desktop.usable).toBe(true);
    expect(desktop.retryable).toBe(false);
    expect(desktop.latest!.origin).toBe("upload");
    const mobile = project!.pages[0]!.devices.find((device) => device.variant === "mobile")!;
    expect(mobile.latest).toBeNull();
  });

  test("the second device lands on the same page, and a later upload is the next version", async () => {
    const first = await send({ meta: baseMeta() });
    const publicId = first.body!.project.publicId;
    const pageId = first.body!.page.id;

    const mobile = await send({
      meta: baseMeta({ target: { project: publicId, page: pageId }, variant: "mobile" }),
    });
    expect(mobile.response.status).toBe(201);
    expect(mobile.body!.page).toMatchObject({ id: pageId, created: false });
    expect(mobile.body!.capture).toMatchObject({ variant: "mobile", attempt: 1 });

    // By address, without naming the page: the same page, Desktop version 2.
    const again = await send({
      meta: baseMeta({ target: { project: publicId }, url: "https://app.example.com/settings?tab=billing" }),
    });
    expect(again.response.status).toBe(201);
    expect(again.body!.page).toMatchObject({ id: pageId, created: false });
    expect(again.body!.capture).toMatchObject({ variant: "desktop", attempt: 2 });
  });

  test("an upload of a page a URL project already has joins that page after its attempts", async () => {
    const project = await createUrlProject("import-url-project-key");
    const { response, body } = await send({
      meta: baseMeta({ target: { project: project.publicId } }),
    });
    expect(response.status).toBe(201);
    expect(body!.page).toMatchObject({ id: project.pages[0]!.id, created: false });
    // The provider's pending initial attempt is version 1.
    expect(body!.capture.attempt).toBe(2);
  });

  test("a repeated key replays the first upload; the same key with another image conflicts", async () => {
    const meta = baseMeta();
    const first = await send({ meta });
    const replayed = await send({ meta });
    expect(replayed.response.status).toBe(200);
    expect(replayed.body).toEqual(first.body);
    expect(recording.puts).toHaveLength(1);

    const conflict = await send({ meta, image: png(80, 120).map((byte, index) => (index === 60 ? byte ^ 1 : byte)) });
    // A flipped byte inside the compressed data no longer decodes cleanly or
    // differs in hash; either way it is not the same upload.
    expect([409, 422]).toContain(conflict.response.status);
    const other = encodeSolidPng({ width: 80, height: 120, rgb: [1, 2, 3] });
    const conflicting = await send({ meta, image: other });
    expect(conflicting.response.status).toBe(409);
    expect(await testDb.db.select().from(schema.captures)).toHaveLength(1);
  });

  test("an image that is not the document it claims is refused before anything is stored", async () => {
    const { response, body } = await send({
      meta: baseMeta({ document: { width: 80, height: 121 } }),
    });
    expect(response.status).toBe(422);
    expect(body).toEqual({ error: "Invalid request.", code: "invalid-image" });
    expect(recording.puts).toHaveLength(0);
    expect(await testDb.db.select().from(schema.projects)).toHaveLength(0);

    const html = new TextEncoder().encode("<html>not an image</html>");
    const notImage = await send({ meta: baseMeta(), image: html });
    expect(notImage.response.status).toBe(422);
    expect(notImage.body!.code).toBe("invalid-image");
  });

  test("an address only the editor's browser can reach files as a label", async () => {
    const { response, body } = await send({
      meta: baseMeta({ url: "http://localhost:3000/dashboard#top" }),
    });
    expect(response.status).toBe(201);
    expect(body!.page.normalizedUrl).toBe("http://localhost:3000/dashboard");
    expect(body!.project.title).toBe("localhost");

    for (const url of ["javascript:alert(1)", "https://user:pass@example.com/", "/relative"]) {
      const refused = await send({ meta: baseMeta({ url }) });
      expect(refused.response.status, url).toBe(422);
      expect(refused.body!.code, url).toBe("invalid-url");
    }
  });

  test("a plain image has no element list, so a draft finds no nearby elements", async () => {
    const first = await send({ meta: baseMeta() });
    const plain = await send({
      meta: baseMeta({
        target: { project: first.body!.project.publicId, page: first.body!.page.id },
        url: undefined,
        variant: "mobile",
        manifest: null,
      }),
    });
    expect(plain.response.status).toBe(201);
    expect(plain.body!.capture.elements).toBe(0);
    const [row] = await testDb.db
      .select()
      .from(schema.captures)
      .where(eq(schema.captures.id, plain.body!.capture.id));
    expect(row!.domManifestJson).toBeNull();

    const context = await contextGET(
      new Request(`${ORIGIN}/api/captures/${row!.id}/context?x=10&y=10`, {
        headers: { cookie: `${EDITOR_SESSION_COOKIE}=${session.token}` },
      }),
      { params: Promise.resolve({ captureId: row!.id }) },
    );
    expect(context.status).toBe(200);
    expect(await context.json()).toEqual({ candidates: [] });
  });

  test("the editor's boundary holds: same origin, session, and CSRF proof", async () => {
    expect((await send({ meta: baseMeta(), origin: "https://evil.example" })).response.status).toBe(403);
    expect((await send({ meta: baseMeta(), csrf: null })).response.status).toBe(403);
    expect((await send({ meta: baseMeta(), auth: "none" })).response.status).toBe(403);
    expect(recording.puts).toHaveLength(0);
  });

  test("malformed, oversized, and unknown-target requests are bounded refusals", async () => {
    const strict = await send({ meta: { ...baseMeta(), extra: true } });
    expect(strict.response.status).toBe(400);

    const big = new Uint8Array(UPLOAD_REQUEST_MAX_BYTES + 10);
    const oversized = await send({ meta: baseMeta(), image: big });
    expect(oversized.response.status).toBe(413);

    const missing = await send({ meta: baseMeta({ target: { project: "nope-nope-nope" } }) });
    expect(missing.response.status).toBe(404);

    const first = await send({ meta: baseMeta() });
    const [project] = await testDb.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.publicId, first.body!.project.publicId));
    await archiveProject(testDb.db, project!.publicId, T0);
    const archived = await send({
      meta: baseMeta({ target: { project: project!.publicId } }),
    });
    expect(archived.response.status).toBe(404);
  });

  test("a project at its screenshot limit refuses another upload", async () => {
    const first = await send({ meta: baseMeta() });
    const [page] = await testDb.db.select().from(schema.pages);
    // Fill the project's attempt budget with failed history rows.
    const rows = Array.from({ length: MAX_CAPTURE_ATTEMPTS_PER_PROJECT - 1 }, (_, index) => ({
      id: `filler-${index}`,
      pageId: page!.id,
      variant: "mobile",
      attempt: index + 1,
      status: "failed",
      idempotencyKey: `filler:${index}`,
      requestedUrl: page!.normalizedUrl,
      viewportWidth: 390,
      viewportHeight: 844,
      deviceScaleFactor: 1,
      createdAt: T0,
      updatedAt: T0,
    }));
    await testDb.db.insert(schema.captures).values(rows);
    const full = await send({
      meta: baseMeta({ target: { project: first.body!.project.publicId } }),
    });
    expect(full.response.status).toBe(422);
    expect(full.body!.code).toBe("too-many-captures");
  });

  test("an upload is never retried by the capture provider", async () => {
    const first = await send({ meta: baseMeta() });
    const result = await retryCapture(testDb.db, {
      pageId: first.body!.page.id,
      variant: "desktop",
      idempotencyKey: "retry-an-upload-key",
    });
    expect(result).toEqual({ ok: false, error: "not-retryable" });
  });
});

describe("POST /api/imports from the extension", () => {
  test("a bearer token imports without cookies, CSRF, or a same Origin", async () => {
    const { response, body } = await send({ meta: baseMeta(), auth: "bearer" });
    expect(response.status).toBe(201);
    const [row] = await testDb.db
      .select()
      .from(schema.captures)
      .where(and(eq(schema.captures.id, body!.capture.id), eq(schema.captures.origin, "upload")));
    expect(JSON.parse(row!.warningJson!).source).toBe("extension");
  });

  test("a forged, expired, or cookie-session bearer is refused", async () => {
    const forged = await send({ meta: baseMeta(), auth: "bearer", bearer: "x1.e30.AAAA" });
    expect(forged.response.status).toBe(401);
    const old = createExtensionToken(TEST_SECRET, T0 - 8 * 24 * 60 * 60 * 1000).token;
    const expired = await send({ meta: baseMeta(), auth: "bearer", bearer: old });
    expect(expired.response.status).toBe(401);
    const cookieToken = await send({ meta: baseMeta(), auth: "bearer", bearer: session.token });
    expect(cookieToken.response.status).toBe(401);
    expect(recording.puts).toHaveLength(0);
  });

  test("a day-old token comes back renewed on the response", async () => {
    const dayOld = createExtensionToken(TEST_SECRET, T0 - 2 * 24 * 60 * 60 * 1000).token;
    const { response } = await send({ meta: baseMeta(), auth: "bearer", bearer: dayOld });
    expect(response.status).toBe(201);
    expect(response.headers.get("x-pinata-token")).toMatch(/^x1\./);
    expect(response.headers.get("x-pinata-token-expires")).toBe(
      new Date(T0 + 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });
});
