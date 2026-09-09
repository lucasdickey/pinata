import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MAX_IMAGE_BYTES } from "../../src/lib/boundaries";
import type { ScreenshotStore } from "../../src/lib/server/providers/blob";
import type {
  BrowserlessClient,
  BrowserlessRunRequest,
  BrowserlessRunResult,
} from "../../src/lib/server/providers/browserless";
import { executeCapture } from "../../src/lib/server/captures/execute";
import { sha256Hex } from "../../src/lib/server/captures/image";
import { applyCaptureTransition } from "../../src/lib/server/captures/transitions";
import { schema } from "../../src/lib/server/db/client";
import {
  failureEnvelope,
  FIXTURE_NONCE,
  FIXTURE_PNG,
  recordingClient,
  recordingStore,
  successEnvelope,
} from "./capture-provider-fakes";
import { createTestDb, type TestDb } from "./test-db";

const T0 = 1_800_000_000_000;
const NONCE = FIXTURE_NONCE;
const PNG = FIXTURE_PNG;

let testDb: TestDb;
let requests: BrowserlessRunRequest[];
let puts: { pathname: string; bytes: Uint8Array; contentType: string }[];
let deletes: string[];

/** Wire one provider answer into the recorders these tests assert on. */
function clientReturning(
  answer: string | BrowserlessRunResult | ((request: BrowserlessRunRequest) => Promise<string>),
): BrowserlessClient {
  const recorder = recordingClient(answer);
  requests = recorder.requests;
  return recorder.client;
}

function storeSpy(overrides: Partial<ScreenshotStore> = {}): ScreenshotStore {
  const recorder = recordingStore(overrides);
  puts = recorder.puts;
  deletes = recorder.deletes;
  return recorder.store;
}

async function seedClaimedCapture(id: string, variant = "desktop"): Promise<string> {
  const pageId = `page-${id}`;
  await testDb.db.insert(schema.projects).values({
    id: `project-${id}`,
    publicId: `public-${id}`,
    title: "Fixture project",
    rootUrl: "https://fixture.example/",
    createdAt: T0,
    updatedAt: T0,
  });
  await testDb.db.insert(schema.pages).values({
    id: pageId,
    projectId: `project-${id}`,
    requestedUrl: "https://fixture.example/page",
    normalizedUrl: "https://fixture.example/page",
    sortIndex: 0,
    createdAt: T0,
  });
  await testDb.db.insert(schema.captures).values({
    id,
    pageId,
    variant,
    attempt: 1,
    status: "capturing",
    idempotencyKey: `seed-${id}`,
    requestedUrl: "https://fixture.example/page",
    finalUrl: "https://fixture.example/page",
    viewportWidth: variant === "mobile" ? 390 : 1440,
    viewportHeight: variant === "mobile" ? 844 : 900,
    deviceScaleFactor: 1,
    createdAt: T0,
    updatedAt: T0,
  });
  return id;
}

async function row(id: string) {
  const rows = await testDb.db
    .select()
    .from(schema.captures)
    .where(eq(schema.captures.id, id))
    .orderBy(asc(schema.captures.attempt));
  return rows[0]!;
}

const deps = (client: BrowserlessClient | null, store: ScreenshotStore | null = storeSpy()) => ({
  client,
  store,
  now: () => T0 + 5_000,
  nonce: () => NONCE,
});

beforeEach(async () => {
  testDb = await createTestDb();
  requests = [];
  puts = [];
  deletes = [];
});

afterEach(() => {
  testDb.client.close();
});

describe("a successful execution finalizes exactly one ready attempt", () => {
  test("stores the exact bytes and persists their hash, dimensions, and manifest", async () => {
    const id = await seedClaimedCapture("cap-ready");
    const result = await executeCapture(testDb.db, id, deps(clientReturning(successEnvelope())));

    expect(result).toMatchObject({
      ok: true,
      capture: {
        captureId: id,
        documentWidth: 400,
        documentHeight: 300,
        contentType: "image/png",
        bytes: PNG.byteLength,
        imageHash: sha256Hex(PNG),
        layoutNonce: NONCE,
        manifestElements: 2,
        manifestTruncated: false,
      },
    });

    expect(puts).toHaveLength(1);
    expect(puts[0]!.contentType).toBe("image/png");
    expect(Buffer.from(puts[0]!.bytes).equals(Buffer.from(PNG))).toBe(true);
    expect(puts[0]!.pathname).toContain(id);

    const stored = await row(id);
    expect(stored).toMatchObject({
      status: "ready",
      documentWidth: 400,
      documentHeight: 300,
      blobContentType: "image/png",
      blobBytes: PNG.byteLength,
      imageHash: sha256Hex(PNG),
      domManifestVersion: 1,
      errorCode: null,
      errorMessage: null,
      capturedAt: T0 + 5_000,
    });
    expect(stored.blobPath).toBe(puts[0]!.pathname);
    const manifest = JSON.parse(stored.domManifestJson!);
    expect(manifest.elements).toHaveLength(2);
    // The nonce element is the image/manifest correlation anchor.
    expect(manifest.elements[0]).toMatchObject({ id: "nonce", text: NONCE });
    expect(JSON.parse(stored.warningJson!).codes).toEqual([
      "motion-unsupported-warn:canvas-js",
    ]);
    expect(deletes).toEqual([]);
  });

  test("the provider request carries the device profile and no code-level target", async () => {
    const desktopRecorder = recordingClient(successEnvelope());
    const mobileRecorder = recordingClient(successEnvelope({ variant: "mobile" }));
    const desktopId = await seedClaimedCapture("cap-desktop");
    await executeCapture(testDb.db, desktopId, deps(desktopRecorder.client));
    const mobileId = await seedClaimedCapture("cap-mobile", "mobile");
    await executeCapture(testDb.db, mobileId, deps(mobileRecorder.client));

    const first = desktopRecorder.requests[0];
    const second = mobileRecorder.requests[0];
    expect(first!.code).toContain("export default async ({ page, context }) =>");
    expect(first!.code).not.toContain("fixture.example");
    expect(first!.context).toMatchObject({
      targetUrl: "https://fixture.example/page",
      variant: "desktop",
      layoutNonce: NONCE,
      viewport: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
      userAgent: null,
      imageContentType: "image/png",
    });
    expect(second!.context).toMatchObject({
      variant: "mobile",
      viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    });
    expect(String((second!.context as { userAgent: string }).userAgent)).toContain("iPhone");
    // Two separate provider executions, each with its own context and nonce.
    expect(desktopRecorder.requests).toHaveLength(1);
    expect(mobileRecorder.requests).toHaveLength(1);
  });
});

describe("provider transport failures close the claim", () => {
  test.each([
    ["rejected", "browserless-auth"],
    ["unavailable", "browserless-provider"],
    ["timeout", "total-timeout"],
    ["too-large", "provider-bytes-exceeded"],
  ] as const)("%s maps to %s and stores nothing", async (error, outcome) => {
    const id = await seedClaimedCapture(`cap-${error}`);
    const result = await executeCapture(
      testDb.db,
      id,
      deps(clientReturning({ ok: false, error })),
    );
    expect(result).toEqual({ ok: false, outcome });
    expect(await row(id)).toMatchObject({
      status: "failed",
      errorCode: outcome,
      blobPath: null,
      imageHash: null,
    });
    expect(puts).toEqual([]);
  });

  test("a client that throws still fails the attempt instead of leaving it capturing", async () => {
    const id = await seedClaimedCapture("cap-throw");
    const client: BrowserlessClient = {
      runFunction: () => Promise.reject(new Error("socket hang up")),
    };
    expect(await executeCapture(testDb.db, id, deps(client))).toEqual({
      ok: false,
      outcome: "browserless-provider",
    });
    expect((await row(id)).status).toBe("failed");
  });

  test("a missing provider credential fails the attempt rather than parking it", async () => {
    const id = await seedClaimedCapture("cap-noclient");
    expect(await executeCapture(testDb.db, id, deps(null))).toEqual({
      ok: false,
      outcome: "browserless-auth",
    });
    expect(await row(id)).toMatchObject({ status: "failed", errorCode: "browserless-auth" });
  });

  test("a missing store fails the attempt before any provider work", async () => {
    const id = await seedClaimedCapture("cap-nostore");
    expect(
      await executeCapture(testDb.db, id, deps(clientReturning(successEnvelope()), null)),
    ).toEqual({ ok: false, outcome: "blob-failure" });
    expect(requests).toEqual([]);
    expect((await row(id)).status).toBe("failed");
  });
});

describe("untrustworthy provider results never become ready", () => {
  test.each([
    ["a non-JSON body", "<html>Bad Gateway</html>", "browserless-provider"],
    ["an envelope with the wrong nonce", null, "browserless-provider"],
  ] as const)("%s fails as %s", async (label, body, outcome) => {
    const id = await seedClaimedCapture(`cap-${outcome}-${label.length}`);
    const envelope = body ?? successEnvelope({ layoutNonce: "layout_ffffffffffffff" });
    expect(await executeCapture(testDb.db, id, deps(clientReturning(envelope)))).toEqual({
      ok: false,
      outcome,
    });
    expect(puts).toEqual([]);
    expect((await row(id)).status).toBe("failed");
  });

  test.each([
    ["navigation-timeout"],
    ["total-timeout"],
    ["document-too-tall"],
    ["too-many-pixels"],
  ])("a bounded in-function failure (%s) is persisted verbatim", async (code) => {
    const id = await seedClaimedCapture(`cap-fn-${code}`);
    const envelope = failureEnvelope(code);
    expect(await executeCapture(testDb.db, id, deps(clientReturning(envelope)))).toEqual({
      ok: false,
      outcome: code,
    });
    expect(await row(id)).toMatchObject({ status: "failed", errorCode: code });
  });

  test("a capture envelope outside the provider transport wrapper is rejected", async () => {
    const id = await seedClaimedCapture("cap-untransported");
    const bare = JSON.stringify(JSON.parse(successEnvelope()).data);
    expect(await executeCapture(testDb.db, id, deps(clientReturning(bare)))).toEqual({
      ok: false,
      outcome: "browserless-provider",
    });
    expect(puts).toEqual([]);
  });

  test("HTML declared as an image is rejected before upload", async () => {
    const id = await seedClaimedCapture("cap-html");
    const envelope = successEnvelope({
      image: { base64: Buffer.from("<!doctype html><h1>502</h1>").toString("base64") },
    });
    expect(await executeCapture(testDb.db, id, deps(clientReturning(envelope)))).toEqual({
      ok: false,
      outcome: "invalid-image",
    });
    expect(puts).toEqual([]);
  });

  test("an image whose pixels disagree with the document dimensions is rejected", async () => {
    const id = await seedClaimedCapture("cap-dims");
    const envelope = successEnvelope({ document: { height: 301 } });
    expect(await executeCapture(testDb.db, id, deps(clientReturning(envelope)))).toEqual({
      ok: false,
      outcome: "invalid-image",
    });
    expect(puts).toEqual([]);
  });

  test("an oversized image fails as image-bytes-exceeded", async () => {
    const id = await seedClaimedCapture("cap-big");
    const big = new Uint8Array(MAX_IMAGE_BYTES + 8);
    big.set(PNG, 0);
    const envelope = successEnvelope({
      image: { base64: Buffer.from(big).toString("base64") },
    });
    expect(await executeCapture(testDb.db, id, deps(clientReturning(envelope)))).toEqual({
      ok: false,
      outcome: "image-bytes-exceeded",
    });
    expect(puts).toEqual([]);
  });

  test("a final URL from another origin fails as an unsafe redirect", async () => {
    const id = await seedClaimedCapture("cap-origin");
    const envelope = successEnvelope({ finalUrl: "https://elsewhere.example/page" });
    expect(await executeCapture(testDb.db, id, deps(clientReturning(envelope)))).toEqual({
      ok: false,
      outcome: "unsafe-redirect",
    });
    expect(puts).toEqual([]);
  });
});

describe("manifest correlation and bounding (VAL-CAPTURE-005)", () => {
  test("a manifest without the layout nonce never becomes ready", async () => {
    const id = await seedClaimedCapture("cap-nomatch");
    const envelope = successEnvelope({
      manifest: {
        schemaVersion: 1,
        truncated: false,
        elements: [
          {
            id: "e1",
            kind: "heading",
            tag: "h1",
            role: "",
            text: "Fixture heading",
            accessibleName: "Fixture heading",
            hints: { id: "top", classes: [], alt: "", title: "", testId: "" },
            path: ["html:1", "body:1", "h1:1"],
            rect: { x: 0, y: 0, width: 400, height: 40 },
          },
        ],
      },
    });
    expect(await executeCapture(testDb.db, id, deps(clientReturning(envelope)))).toEqual({
      ok: false,
      outcome: "browserless-provider",
    });
    expect(puts).toEqual([]);
    expect((await row(id)).status).toBe("failed");
  });

  test("an oversized manifest stays ready, bounded, and warned", async () => {
    const id = await seedClaimedCapture("cap-overflow");
    const nonce = {
      id: "nonce",
      kind: "text",
      tag: "div",
      role: "",
      text: NONCE,
      accessibleName: NONCE,
      hints: { id: "", classes: [], alt: "", title: "", testId: "" },
      path: ["html:1", "body:1", "div:1"],
      rect: { x: 0, y: 0, width: 148, height: 20 },
    };
    const rows = Array.from({ length: 499 }, (_, i) => ({
      id: `e${i + 1}`,
      kind: "text",
      tag: "p",
      role: "",
      text: `row-${i} ${"x".repeat(110)}`,
      accessibleName: `row-${i}`,
      hints: {
        id: `row-${i}`,
        classes: Array.from({ length: 8 }, (_, c) => `c${c}${"y".repeat(56)}`),
        alt: "",
        title: "",
        testId: "",
      },
      path: ["html:1", "body:1", "main:1", `p:${i + 1}`],
      rect: { x: 0, y: 40 + i * 2, width: 400, height: 2 },
    }));
    // The schema admits at most 500; the byte cap is what overflows here.
    const envelope = successEnvelope({
      manifest: { schemaVersion: 1, truncated: false, elements: [nonce, ...rows] },
    });
    const result = await executeCapture(testDb.db, id, deps(clientReturning(envelope)));
    expect(result).toMatchObject({ ok: true, capture: { manifestTruncated: true } });
    if (result.ok) {
      expect(result.capture.warnings).toContain("manifest-truncated");
      expect(result.capture.manifestBytes).toBeLessThanOrEqual(262_144);
    }

    const stored = await row(id);
    expect(stored.status).toBe("ready");
    const manifest = JSON.parse(stored.domManifestJson!);
    expect(manifest.truncated).toBe(true);
    expect(Buffer.byteLength(stored.domManifestJson!, "utf8")).toBeLessThanOrEqual(262_144);
    expect(JSON.parse(stored.warningJson!).codes).toContain("manifest-truncated");
    // Correlation survives truncation: the nonce is still the first element.
    expect(manifest.elements[0]).toMatchObject({ id: "nonce", text: NONCE });
  });
});

describe("storage and finalization faults", () => {
  test("an upload failure fails the attempt with nothing marked ready", async () => {
    const id = await seedClaimedCapture("cap-blob");
    const store = storeSpy({ put: async () => ({ ok: false, error: "unavailable" }) });
    expect(
      await executeCapture(testDb.db, id, deps(clientReturning(successEnvelope()), store)),
    ).toEqual({ ok: false, outcome: "blob-failure" });
    expect(await row(id)).toMatchObject({
      status: "failed",
      errorCode: "blob-failure",
      blobPath: null,
    });
  });

  test("a lost finalization deletes the object it just wrote", async () => {
    const id = await seedClaimedCapture("cap-fence");
    const client = clientReturning(async () => {
      // Another worker finalizes the same attempt while the provider runs.
      await applyCaptureTransition(testDb.db, {
        captureId: id,
        from: "capturing",
        to: "failed",
        now: T0 + 1_000,
        errorCode: "stale-lease",
        errorMessage: "stale",
      });
      return successEnvelope();
    });
    expect(await executeCapture(testDb.db, id, deps(client))).toEqual({
      ok: false,
      outcome: "finalization-failure",
    });
    expect(puts).toHaveLength(1);
    expect(deletes).toEqual([puts[0]!.pathname]);
    // The terminal row the other worker wrote is not rewritten.
    expect(await row(id)).toMatchObject({ status: "failed", errorCode: "stale-lease" });
  });

  test("an attempt that is not a live claim is left exactly as it is", async () => {
    const id = await seedClaimedCapture("cap-notclaimed");
    await applyCaptureTransition(testDb.db, {
      captureId: id,
      from: "capturing",
      to: "ready",
      now: T0 + 1,
      imageHash: "deadbeef",
    });
    expect(await executeCapture(testDb.db, id, deps(clientReturning(successEnvelope())))).toEqual({
      ok: false,
      error: "not-executable",
    });
    expect(requests).toEqual([]);
    expect(await row(id)).toMatchObject({ status: "ready", imageHash: "deadbeef" });
  });
});
