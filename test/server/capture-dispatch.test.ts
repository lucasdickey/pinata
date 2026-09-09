// POST /api/captures/[captureId]/dispatch — admission before provider work
// (VAL-CAPTURE-001, VAL-CAPTURE-002).
//
// The point of these tests is what does *not* happen: a rejected target must
// leave a bounded failed attempt, no provider call, and no ready image, while
// a safe chain claims the attempt and persists both public URLs.

import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DELETE as dispatchDELETE,
  GET as dispatchGET,
  POST as dispatchPOST,
  PUT as dispatchPUT,
} from "../../app/api/captures/[captureId]/dispatch/route";
import { POST as projectsPOST } from "../../app/api/projects/route";
import { CAPTURE_REQUEST_MAX_BYTES } from "../../src/lib/boundaries";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { createEditorSession } from "../../src/lib/server/auth/session";
import type { AdmissionDeps, RedirectProbe } from "../../src/lib/server/captures/admission";
import { __setAdmissionDepsForTests } from "../../src/lib/server/captures/deps";
import type { DnsResolver } from "../../src/lib/server/captures/dns";
import { applyCaptureTransition } from "../../src/lib/server/captures/transitions";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "capture-dispatch-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let session: { token: string; csrf: string };
let pageIds: string[];

interface RequestOptions {
  origin?: string | null;
  cookie?: string | null;
  csrf?: string | null;
  contentLength?: string;
}

function build(captureId: string, options: RequestOptions = {}): Request {
  const headers = new Headers();
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.set("origin", origin);
  headers.set("host", "127.0.0.1:3100");
  const cookie =
    options.cookie === undefined ? `${EDITOR_SESSION_COOKIE}=${session.token}` : options.cookie;
  if (cookie) headers.set("cookie", cookie);
  const csrf = options.csrf === undefined ? session.csrf : options.csrf;
  if (csrf) headers.set(EDITOR_CSRF_HEADER, csrf);
  if (options.contentLength) headers.set("content-length", options.contentLength);
  return new Request(`${ORIGIN}/api/captures/${captureId}/dispatch`, { method: "POST", headers });
}

const routeContext = (captureId: string) => ({ params: Promise.resolve({ captureId }) });

function resolverFor(answers: Record<string, string[]>): DnsResolver {
  const reject = (code: string) => () =>
    Promise.reject(Object.assign(new Error(code), { code }));
  return {
    resolveCname: reject("ENODATA"),
    resolve4: (host) =>
      answers[host] ? Promise.resolve(answers[host]!) : Promise.resolve().then(reject("ENOTFOUND")),
    resolve6: reject("ENODATA"),
  };
}

function injectDeps(answers: Record<string, string[]>, probe?: RedirectProbe): void {
  const deps: AdmissionDeps = {
    resolver: resolverFor(answers),
    ...(probe ? { probe } : {}),
    dnsTimeoutMs: 50,
  };
  __setAdmissionDepsForTests(deps);
}

async function attemptsFor(pageId: string, variant: string) {
  return testDb.db
    .select()
    .from(schema.captures)
    .where(and(eq(schema.captures.pageId, pageId), eq(schema.captures.variant, variant)))
    .orderBy(asc(schema.captures.attempt));
}

async function firstAttempt(pageId: string, variant = "desktop") {
  const rows = await attemptsFor(pageId, variant);
  return rows[0]!;
}

let seedCounter = 0;

async function seedProject(rootUrl: string, urls: string[] = []): Promise<void> {
  seedCounter += 1;
  const response = await projectsPOST(
    new Request(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        host: "127.0.0.1:3100",
        "content-type": "application/json",
        cookie: `${EDITOR_SESSION_COOKIE}=${session.token}`,
        [EDITOR_CSRF_HEADER]: session.csrf,
      },
      body: JSON.stringify({
        rootUrl,
        urls,
        idempotencyKey: `seed-dispatch-${String(seedCounter).padStart(4, "0")}`,
      }),
    }),
  );
  const { project } = await response.json();
  pageIds = project.pages.map((page: { id: string }) => page.id);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  const created = createEditorSession(TEST_SECRET, T0);
  session = { token: created.token, csrf: created.payload.csrf };
  await seedProject("https://safe.example");
  injectDeps({ "safe.example": ["93.184.216.34"] });
});

afterEach(() => {
  __setAdmissionDepsForTests(null);
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("dispatch boundary", () => {
  test.each([
    ["a foreign Origin", { origin: "https://evil.example" }, 403],
    ["a missing Origin", { origin: null }, 403],
    ["no session", { cookie: null }, 401],
    ["no CSRF proof", { csrf: null }, 403],
    ["a wrong CSRF proof", { csrf: "not-the-proof" }, 403],
  ])("%s is rejected and leaves the attempt pending", async (_label, options, status) => {
    const attempt = await firstAttempt(pageIds[0]!);
    const response = await dispatchPOST(build(attempt.id, options), routeContext(attempt.id));
    expect(response.status).toBe(status);
    expect((await firstAttempt(pageIds[0]!)).status).toBe("pending");
  });

  test("a body over the published cap is rejected before any work", async () => {
    const attempt = await firstAttempt(pageIds[0]!);
    const response = await dispatchPOST(
      build(attempt.id, { contentLength: String(CAPTURE_REQUEST_MAX_BYTES + 1) }),
      routeContext(attempt.id),
    );
    expect(response.status).toBe(413);
    expect((await firstAttempt(pageIds[0]!)).status).toBe("pending");
  });

  test("an unknown capture answers the same generic 404", async () => {
    const response = await dispatchPOST(build("no-such-capture"), routeContext("no-such-capture"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Request rejected." });
  });

  test("an already-claimed attempt cannot be dispatched twice", async () => {
    const attempt = await firstAttempt(pageIds[0]!);
    const first = await dispatchPOST(build(attempt.id), routeContext(attempt.id));
    const second = await dispatchPOST(build(attempt.id), routeContext(attempt.id));
    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "Request rejected." });
  });

  test("a terminal attempt cannot be dispatched", async () => {
    const attempt = await firstAttempt(pageIds[0]!);
    await applyCaptureTransition(testDb.db, {
      captureId: attempt.id,
      from: "pending",
      to: "failed",
      errorCode: "total-timeout",
      now: T0 + 1,
    });
    const response = await dispatchPOST(build(attempt.id), routeContext(attempt.id));
    expect(response.status).toBe(409);
    expect((await firstAttempt(pageIds[0]!)).errorCode).toBe("total-timeout");
  });

  test("unsupported methods answer 405", async () => {
    for (const handler of [dispatchGET, dispatchPUT, dispatchDELETE]) {
      expect(handler().status).toBe(405);
    }
  });

  test("an unavailable database fails closed", async () => {
    const attempt = await firstAttempt(pageIds[0]!);
    __setDatabaseForTests(null);
    const response = await dispatchPOST(build(attempt.id), routeContext(attempt.id));
    expect(response.status).toBe(503);
    __setDatabaseForTests(testDb.db);
  });
});

describe("safe targets are admitted and claimed", () => {
  test("a public target claims the attempt and persists both URLs", async () => {
    const attempt = await firstAttempt(pageIds[0]!);
    const response = await dispatchPOST(build(attempt.id), routeContext(attempt.id));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      capture: {
        captureId: attempt.id,
        variant: "desktop",
        requestedUrl: "https://safe.example/",
        finalUrl: "https://safe.example/",
        hops: 0,
        status: "capturing",
      },
    });
    const row = await firstAttempt(pageIds[0]!);
    expect(row).toMatchObject({
      status: "capturing",
      requestedUrl: "https://safe.example/",
      finalUrl: "https://safe.example/",
      errorCode: null,
      imageHash: null,
      blobPath: null,
    });
  });

  test("a safe public redirect chain persists the requested and final URLs", async () => {
    injectDeps(
      { "safe.example": ["93.184.216.34"], "www.safe.example": ["93.184.216.34"] },
      (url) =>
        Promise.resolve(
          url === "https://safe.example/"
            ? { status: 301, location: "https://www.safe.example/home" }
            : { status: 200, location: null },
        ),
    );
    const attempt = await firstAttempt(pageIds[0]!);
    const response = await dispatchPOST(build(attempt.id), routeContext(attempt.id));
    expect(response.status).toBe(202);
    expect(await firstAttempt(pageIds[0]!)).toMatchObject({
      status: "capturing",
      requestedUrl: "https://safe.example/",
      finalUrl: "https://www.safe.example/home",
    });
  });

  test("dispatching one variant leaves its sibling untouched", async () => {
    const attempt = await firstAttempt(pageIds[0]!, "desktop");
    await dispatchPOST(build(attempt.id), routeContext(attempt.id));
    expect((await firstAttempt(pageIds[0]!, "mobile")).status).toBe("pending");
  });
});

describe("unsafe targets fail before provider work", () => {
  test("a host that resolves privately fails as dns-failed with no image", async () => {
    injectDeps({ "safe.example": ["169.254.169.254"] });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const attempt = await firstAttempt(pageIds[0]!);
    const response = await dispatchPOST(build(attempt.id), routeContext(attempt.id));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({
      error: "The address could not be resolved to a public host.",
      code: "dns-failed",
      remediation: "Check the domain resolves publicly, then retry.",
    });
    expect(JSON.stringify(body)).not.toContain("169.254");
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = await firstAttempt(pageIds[0]!);
    expect(row).toMatchObject({
      status: "failed",
      errorCode: "dns-failed",
      finalUrl: null,
      blobPath: null,
      imageHash: null,
      domManifestJson: null,
    });
    fetchSpy.mockRestore();
  });

  test("a DNS timeout fails closed rather than dispatching", async () => {
    __setAdmissionDepsForTests({
      resolver: {
        resolveCname: () => new Promise<string[]>(() => {}),
        resolve4: () => new Promise<string[]>(() => {}),
        resolve6: () => new Promise<string[]>(() => {}),
      },
      dnsTimeoutMs: 20,
    });
    const attempt = await firstAttempt(pageIds[0]!);
    vi.useRealTimers();
    const response = await dispatchPOST(build(attempt.id), routeContext(attempt.id));
    expect(response.status).toBe(502);
    expect((await firstAttempt(pageIds[0]!))).toMatchObject({
      status: "failed",
      errorCode: "dns-failed",
    });
  });

  test("an unsafe redirect hop fails as unsafe-redirect with no ready image", async () => {
    injectDeps({ "safe.example": ["93.184.216.34"] }, (url) =>
      Promise.resolve(
        url === "https://safe.example/"
          ? { status: 302, location: "http://169.254.169.254/latest/meta-data/" }
          : { status: 200, location: null },
      ),
    );
    const attempt = await firstAttempt(pageIds[0]!);
    const response = await dispatchPOST(build(attempt.id), routeContext(attempt.id));

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({
      error: "A redirect pointed at an address Pinata will not capture.",
      code: "unsafe-redirect",
      remediation: "Remove or replace the unsafe redirect target.",
    });
    expect(JSON.stringify(body)).not.toContain("169.254");
    expect(await firstAttempt(pageIds[0]!)).toMatchObject({
      status: "failed",
      errorCode: "unsafe-redirect",
      finalUrl: null,
      blobPath: null,
    });
  });

  test("a target whose stored URL is no longer admissible fails as invalid-url", async () => {
    // The page row was written before this policy existed; admission is
    // revalidated at dispatch rather than trusted from creation time.
    const attempt = await firstAttempt(pageIds[0]!);
    await testDb.db
      .update(schema.captures)
      .set({ requestedUrl: "http://safe.example/" })
      .where(eq(schema.captures.id, attempt.id));
    const response = await dispatchPOST(build(attempt.id), routeContext(attempt.id));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "invalid-url" });
    expect(await firstAttempt(pageIds[0]!)).toMatchObject({
      status: "failed",
      errorCode: "invalid-url",
    });
  });

  test("a failed admission leaves a retryable attempt and no sibling damage", async () => {
    await seedProject("https://safe.example", ["https://safe.example/pricing"]);
    injectDeps({ "safe.example": ["10.0.0.5"] });
    const attempt = await firstAttempt(pageIds[0]!);
    await dispatchPOST(build(attempt.id), routeContext(attempt.id));
    expect((await firstAttempt(pageIds[0]!)).status).toBe("failed");
    expect((await firstAttempt(pageIds[1]!)).status).toBe("pending");
    expect(await attemptsFor(pageIds[0]!, "desktop")).toHaveLength(1);
  });
});
