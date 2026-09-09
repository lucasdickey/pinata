// End-to-end proof of authorized private screenshot delivery against the
// production build (VAL-CAPTURE-014 delivery half): the real private Blob
// store and real Turso rows behind the real HTTP server, the full
// method/range/conditional/header matrix, and the browser cache/logout
// behavior — a warmed, rendered image must be unreachable the moment the
// session ends.
//
// The suite gates on the local configuration it needs and skips with a
// name-only reason in CI. The session token is minted in-process from the
// environment and never logged; the disposable Turso rows and the private
// Blob object carry a unique run id and are deleted — and verified absent —
// in afterAll (never in a trailing test).

import { randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { like } from "drizzle-orm";
import { ASSET_CACHE_CONTROL } from "../src/lib/boundaries";
import { createEditorSession } from "../src/lib/server/auth/session";
import { sha256Hex } from "../src/lib/server/captures/image";
import { createDatabase, schema, type Database } from "../src/lib/server/db/client";
import { createVercelBlobStore, type ScreenshotStore } from "../src/lib/server/providers/blob";
import { encodeSolidPng } from "../test/helpers/png";
import { localEnvGate, requireLocalEnvValue } from "./local-env";
import { stubDispatchQuota } from "./stub-dispatch";

const gate = localEnvGate([
  "SESSION_SECRET",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
]);

const RUN_ID = `e2easset-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const BASE = "http://127.0.0.1:3100";

const PNG = encodeSolidPng({ width: 64, height: 40, rgb: [70, 110, 170] });
const PNG_SHA256 = sha256Hex(PNG);
const ETAG = `"${PNG_SHA256}"`;

const CAPTURE_ID = `${RUN_ID}-ready`;
const FAILED_CAPTURE_ID = `${RUN_ID}-failed`;
const PAGE_ID = `${RUN_ID}-page`;
const PROJECT_ID = `${RUN_ID}-project`;
const BLOB_PATH = `captures/${PAGE_ID}/${CAPTURE_ID}-${PNG_SHA256.slice(0, 16)}.png`;

let db: Database;
let store: ScreenshotStore;
let sessionToken: string;
let csrf: string;

const assetPath = (captureId: string) => `/api/captures/${captureId}/asset`;

function authedGet(
  request: APIRequestContext,
  captureId: string,
  headers: Record<string, string> = {},
) {
  return request.get(assetPath(captureId), {
    headers: { cookie: `pinata_editor_session=${sessionToken}`, ...headers },
  });
}

test.beforeAll(async () => {
  if (!gate.ready) return;
  const env = {
    TURSO_DATABASE_URL: requireLocalEnvValue("TURSO_DATABASE_URL"),
    TURSO_AUTH_TOKEN: requireLocalEnvValue("TURSO_AUTH_TOKEN"),
    BLOB_READ_WRITE_TOKEN: requireLocalEnvValue("BLOB_READ_WRITE_TOKEN"),
  };
  db = createDatabase(env)!;
  store = createVercelBlobStore(env)!;
  const created = createEditorSession(requireLocalEnvValue("SESSION_SECRET"), Date.now());
  sessionToken = created.token;
  csrf = created.payload.csrf;

  const now = Date.now();
  await db.insert(schema.projects).values({
    id: PROJECT_ID,
    publicId: PROJECT_ID,
    title: `${RUN_ID} e2e asset`,
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

test.afterAll(async () => {
  if (!gate.ready) return;
  await store.del(BLOB_PATH);
  await db.delete(schema.captures).where(like(schema.captures.pageId, `${RUN_ID}-%`));
  await db.delete(schema.pages).where(like(schema.pages.id, `${RUN_ID}-%`));
  await db.delete(schema.projects).where(like(schema.projects.id, `${RUN_ID}-%`));
  const head = await store.head(BLOB_PATH);
  expect(head.ok).toBe(false);
});

test("the authorized editor receives exact bytes with the published headers", async ({
  request,
}) => {
  test.skip(!gate.ready, gate.reason);

  const response = await authedGet(request, CAPTURE_ID);
  expect(response.status()).toBe(200);
  const body = await response.body();
  expect(new Uint8Array(body)).toEqual(PNG);
  expect(sha256Hex(new Uint8Array(body))).toBe(PNG_SHA256);
  const headers = response.headers();
  expect(headers["content-type"]).toBe("image/png");
  expect(headers["content-length"]).toBe(String(PNG.byteLength));
  expect(headers["etag"]).toBe(ETAG);
  expect(headers["cache-control"]).toBe(ASSET_CACHE_CONTROL);
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["vary"]).toContain("Cookie");
  expect(headers["accept-ranges"]).toBe("bytes");
  // No provider location leaks through any header.
  for (const [name, value] of Object.entries(headers)) {
    expect(`${name}: ${value}`).not.toContain(BLOB_PATH);
    expect(value).not.toContain("vercel-storage");
    expect(value).not.toContain("blob.vercel");
  }
});

test("HEAD, range, and conditional requests behave over HTTP", async ({ request }) => {
  test.skip(!gate.ready, gate.reason);

  const head = await request.fetch(assetPath(CAPTURE_ID), {
    method: "HEAD",
    headers: { cookie: `pinata_editor_session=${sessionToken}` },
  });
  expect(head.status()).toBe(200);
  expect(head.headers()["content-length"]).toBe(String(PNG.byteLength));
  expect((await head.body()).byteLength).toBe(0);

  const ranged = await authedGet(request, CAPTURE_ID, { range: "bytes=4-19" });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()["content-range"]).toBe(`bytes 4-19/${PNG.byteLength}`);
  expect(new Uint8Array(await ranged.body())).toEqual(PNG.subarray(4, 20));

  for (const bad of ["bytes=abc", "bytes=-5", "bytes=0-1,4-5", "bytes=9-2"]) {
    const rejected = await authedGet(request, CAPTURE_ID, { range: bad });
    expect(rejected.status(), bad).toBe(400);
    expect((await rejected.body()).byteLength, bad).toBeLessThan(200);
  }
  const unsatisfiable = await authedGet(request, CAPTURE_ID, {
    range: `bytes=${PNG.byteLength}-`,
  });
  expect(unsatisfiable.status()).toBe(416);

  const conditional = await authedGet(request, CAPTURE_ID, { "if-none-match": ETAG });
  expect(conditional.status()).toBe(304);
  expect((await conditional.body()).byteLength).toBe(0);
  // The 304 still carries the anti-caching policy.
  expect(conditional.headers()["cache-control"]).toBe(ASSET_CACHE_CONTROL);
});

test("every unauthorized or unresolvable request receives no bytes", async ({ request }) => {
  test.skip(!gate.ready, gate.reason);

  // Anonymous.
  const anonymous = await request.get(assetPath(CAPTURE_ID));
  expect(anonymous.status()).toBe(401);
  expect((await anonymous.body()).byteLength).toBeLessThan(200);
  expect(anonymous.headers()["cache-control"]).toBe(ASSET_CACHE_CONTROL);

  // Tampered session.
  const tampered = await request.get(assetPath(CAPTURE_ID), {
    headers: { cookie: `pinata_editor_session=${sessionToken.slice(0, -2)}xx` },
  });
  expect(tampered.status()).toBe(401);

  // Nonexistent id and non-ready capture are the same generic denial.
  const missing = await authedGet(request, `${RUN_ID}-nope`);
  const failed = await authedGet(request, FAILED_CAPTURE_ID);
  expect(missing.status()).toBe(404);
  expect(failed.status()).toBe(404);
  expect(await missing.text()).toBe(await failed.text());

  // Unsupported methods.
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await request.fetch(assetPath(CAPTURE_ID), {
      method,
      headers: { cookie: `pinata_editor_session=${sessionToken}` },
    });
    expect(response.status(), method).toBe(405);
  }

  // Conditional and range replays without authority still get nothing.
  const replayConditional = await request.get(assetPath(CAPTURE_ID), {
    headers: { "if-none-match": ETAG },
  });
  expect(replayConditional.status()).toBe(401);
  const replayRange = await request.get(assetPath(CAPTURE_ID), {
    headers: { range: "bytes=0-3" },
  });
  expect(replayRange.status()).toBe(401);
});

test("a warmed, rendered image is unreachable after logout", async ({ page, request }) => {
  test.skip(!gate.ready, gate.reason);
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    // The stubbed dispatch answers 429 (the editor home drives pending
    // captures by design, D049); Chromium logs that as a resource error.
    if (msg.type() === "error" && !msg.text().includes("status of 429")) {
      consoleErrors.push(msg.text());
    }
  });
  // This spec is about asset delivery, not provider execution: keep the
  // editor home's dispatch driver from consuming real capture quota.
  await stubDispatchQuota(page);

  await page.context().addCookies([
    {
      name: "pinata_editor_session",
      value: sessionToken,
      url: BASE,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);

  // Record every network response for the asset URL: a cache replay would
  // produce no network response at all, so the log is the no-store proof.
  const assetResponses: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes(assetPath(CAPTURE_ID))) assetResponses.push(response.status());
  });

  // Warm the browser: a public page first so history has a distinct entry,
  // then the image, which renders as a real decoded image.
  await page.goto("/");
  const first = await page.goto(assetPath(CAPTURE_ID));
  expect(first?.status()).toBe(200);
  const rendered = await page.evaluate(() => {
    const img = document.querySelector("img");
    return img ? { width: img.naturalWidth, height: img.naturalHeight } : null;
  });
  expect(rendered).toEqual({ width: 64, height: 40 });

  // A same-session reload reauthorizes and serves again — over the network.
  const again = await page.reload();
  expect(again?.status()).toBe(200);
  expect(assetResponses).toEqual([200, 200]);

  // End the session authoritatively (real logout route: Origin + CSRF).
  const logout = await request.post("/api/auth/logout", {
    headers: {
      origin: BASE,
      cookie: `pinata_editor_session=${sessionToken}`,
      "x-pinata-csrf": csrf,
    },
  });
  expect(logout.status()).toBe(200);

  // The old cookie cannot replay the bytes through any request shape.
  for (const headers of [
    {},
    { "if-none-match": ETAG },
    { range: "bytes=0-3" },
  ] as Record<string, string>[]) {
    const replay = await request.get(assetPath(CAPTURE_ID), {
      headers: { cookie: `pinata_editor_session=${sessionToken}`, ...headers },
    });
    expect(replay.status()).toBe(401);
    expect((await replay.body()).byteLength).toBeLessThan(200);
  }

  // Browser re-navigation after logout: no-store means every re-navigation
  // re-requests, and each request reauthorizes to the 401 denial.
  await page.context().clearCookies();
  const reloaded = await page.reload();
  expect(reloaded?.status()).toBe(401);
  const deniedBody = await page.evaluate(() => document.body.innerText);
  expect(deniedBody).toContain("Authentication required.");
  expect(deniedBody.length).toBeLessThan(500);

  // A fresh navigation to the warmed URL also reauthorizes over the network.
  const fresh = await page.goto(assetPath(CAPTURE_ID));
  expect(fresh?.status()).toBe(401);

  // Back to the public page. Every asset navigation above hit the network;
  // no cached replay served a pixel.
  const back = await page.goBack();
  expect(back?.status()).toBe(200);
  expect(assetResponses).toEqual([200, 200, 401, 401]);

  // Chromium logs a resource error for each denied top-level navigation; the
  // two 401s above are the point of the test. Nothing else may be logged.
  const unexpected = consoleErrors.filter(
    (text) => !text.includes("the server responded with a status of 401"),
  );
  expect(unexpected).toEqual([]);
});
