// The exact public capture outcome catalog (VAL-CAPTURE-012), driven through
// the real dispatch route and pipeline.
//
// Three guarantees, all pinned here:
//
//  1. The catalog is exactly the documented matrix: every code's persisted
//     status, retryability, HTTP class, attempt consumption, and warning
//     policy match the published table — no more, no less.
//  2. Every reachable outcome behaves as its catalog row: the API answer is
//     the bounded public message plus remediation, the persisted row carries
//     exactly the catalog code/message, and retryability follows the catalog.
//  3. Nothing leaks: provider bodies, stacks, tokens, signed URLs, private
//     addresses, credentialed URLs, and source HTML injected into every
//     failure surface never reach a response, a persisted row, or a cleanup
//     record.

import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as dispatchPOST } from "../../app/api/captures/[captureId]/dispatch/route";
import { POST as projectsPOST } from "../../app/api/projects/route";
import {
  CAPTURE_OUTCOMES,
  MAX_ACTIVE_CAPTURES,
  MAX_PUBLIC_MESSAGE_BYTES,
  STALE_CAPTURE_AGE_MS,
  captureOutcome,
} from "../../src/lib/boundaries";
import { EDITOR_CSRF_HEADER, EDITOR_SESSION_COOKIE } from "../../src/lib/auth-constants";
import { createEditorSession } from "../../src/lib/server/auth/session";
import type { AdmissionDeps } from "../../src/lib/server/captures/admission";
import {
  __setAdmissionDepsForTests,
  __setCaptureExecutionDepsForTests,
} from "../../src/lib/server/captures/deps";
import type { CaptureExecutionDeps } from "../../src/lib/server/captures/execute";
import { claimCaptureLease } from "../../src/lib/server/captures/leases";
import { summarizeVariant } from "../../src/lib/server/captures/status";
import { applyCaptureTransition } from "../../src/lib/server/captures/transitions";
import {
  __resetDatabaseCacheForTests,
  __setDatabaseForTests,
  schema,
} from "../../src/lib/server/db/client";
import {
  echoClient,
  failureEnvelope,
  recordingClient,
  recordingStore,
  successEnvelope,
} from "./capture-provider-fakes";
import { createTestDb, type TestDb } from "./test-db";

const TEST_SECRET = "capture-outcomes-session-secret-sentinel";
const ORIGIN = "http://127.0.0.1:3100";
const T0 = 1_800_000_000_000;

let testDb: TestDb;
let session: { token: string; csrf: string };
let pageId: string;

function build(captureId: string): Request {
  return new Request(`${ORIGIN}/api/captures/${captureId}/dispatch`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      host: "127.0.0.1:3100",
      cookie: `${EDITOR_SESSION_COOKIE}=${session.token}`,
      [EDITOR_CSRF_HEADER]: session.csrf,
    },
  });
}

const routeContext = (captureId: string) => ({ params: Promise.resolve({ captureId }) });

function injectExecution(deps: Partial<CaptureExecutionDeps>): void {
  __setCaptureExecutionDepsForTests({
    client: echoClient().client,
    store: recordingStore().store,
    ...deps,
  });
}

function injectAnswers(answers: Record<string, string[]>): void {
  const reject = (code: string) => () =>
    Promise.reject(Object.assign(new Error(code), { code }));
  const deps: AdmissionDeps = {
    resolver: {
      resolveCname: reject("ENODATA"),
      resolve4: (host) =>
        answers[host]
          ? Promise.resolve(answers[host]!)
          : Promise.resolve().then(reject("ENOTFOUND")),
      resolve6: reject("ENODATA"),
    },
    dnsTimeoutMs: 50,
  };
  __setAdmissionDepsForTests(deps);
}

async function attemptRow() {
  const rows = await testDb.db
    .select()
    .from(schema.captures)
    .where(and(eq(schema.captures.pageId, pageId), eq(schema.captures.variant, "desktop")))
    .orderBy(asc(schema.captures.attempt));
  return rows[0]!;
}

async function variantSummary(now: number) {
  const rows = await testDb.db
    .select()
    .from(schema.captures)
    .where(and(eq(schema.captures.pageId, pageId), eq(schema.captures.variant, "desktop")));
  return summarizeVariant("desktop", rows, now);
}

/** Drive one dispatch to its outcome and collect every observable surface. */
async function drive() {
  const attempt = await attemptRow();
  const response = await dispatchPOST(build(attempt.id), routeContext(attempt.id));
  const body = await response.json();
  return { response, body, row: await attemptRow(), summary: await variantSummary(T0) };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.stubEnv("SESSION_SECRET", TEST_SECRET);
  testDb = await createTestDb();
  __setDatabaseForTests(testDb.db);
  const created = createEditorSession(TEST_SECRET, T0);
  session = { token: created.token, csrf: created.payload.csrf };
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
        rootUrl: "https://safe.example",
        idempotencyKey: "seed-outcomes-0001",
      }),
    }),
  );
  const { project } = await response.json();
  pageId = project.pages[0].id;
  injectAnswers({ "safe.example": ["93.184.216.34"] });
  injectExecution({});
});

afterEach(() => {
  __setAdmissionDepsForTests(null);
  __setCaptureExecutionDepsForTests(null);
  testDb.client.close();
  __resetDatabaseCacheForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the catalog is exactly the documented matrix", () => {
  test("every entry matches the published policy table", () => {
    const expected = [
      // code, status, retryable, http, consumesAttempt, warn
      ["invalid-url", "failed", false, 422, false, false],
      ["dns-failed", "failed", true, 502, true, false],
      ["unsafe-redirect", "failed", false, 422, true, false],
      ["browserless-auth", "failed", false, 502, true, false],
      ["browserless-provider", "failed", true, 502, true, false],
      ["navigation-timeout", "failed", true, 504, true, false],
      ["total-timeout", "failed", true, 504, true, false],
      ["document-too-tall", "failed", false, 422, true, false],
      ["too-many-pixels", "failed", false, 422, true, false],
      ["provider-bytes-exceeded", "failed", true, 502, true, false],
      ["image-bytes-exceeded", "failed", false, 422, true, false],
      ["invalid-image", "failed", true, 502, true, false],
      ["quota-exceeded", "failed", true, 429, false, false],
      ["blob-failure", "failed", true, 502, true, false],
      ["finalization-failure", "failed", true, 502, true, false],
      ["stale-lease", "failed", true, null, true, false],
      ["cleanup-pending", "ready", false, null, true, true],
      ["manifest-truncated", "ready", false, null, true, true],
    ] as const;
    expect(CAPTURE_OUTCOMES.map((outcome) => outcome.code)).toEqual(
      expected.map(([code]) => code),
    );
    for (const [code, status, retryable, http, consumes, warn] of expected) {
      const outcome = captureOutcome(code);
      expect(
        {
          captureStatus: outcome.captureStatus,
          retryable: outcome.retryable,
          httpStatus: outcome.httpStatus,
          consumesAttempt: outcome.consumesAttempt,
          warn: outcome.warn,
        },
        code,
      ).toEqual({
        captureStatus: status,
        retryable,
        httpStatus: http,
        consumesAttempt: consumes,
        warn,
      });
      expect(Buffer.byteLength(outcome.publicMessage, "utf8"), code).toBeLessThanOrEqual(
        MAX_PUBLIC_MESSAGE_BYTES,
      );
    }
  });

  test("no outcome outside the catalog may be named", () => {
    expect(() => captureOutcome("something-else")).toThrow(/Unknown capture outcome/);
  });
});

describe("every reachable outcome behaves as its catalog row", () => {
  interface DrivenCase {
    code: string;
    setup: () => Promise<void> | void;
  }

  const cases: DrivenCase[] = [
    {
      code: "invalid-url",
      setup: async () => {
        const attempt = await attemptRow();
        await testDb.db
          .update(schema.captures)
          .set({ requestedUrl: "http://safe.example/" })
          .where(eq(schema.captures.id, attempt.id));
      },
    },
    {
      code: "dns-failed",
      setup: () => injectAnswers({ "safe.example": ["100.64.0.1"] }),
    },
    {
      code: "unsafe-redirect",
      setup: () =>
        __setAdmissionDepsForTests({
          resolver: {
            resolveCname: () => Promise.reject(Object.assign(new Error("x"), { code: "ENODATA" })),
            resolve4: () => Promise.resolve(["93.184.216.34"]),
            resolve6: () => Promise.reject(Object.assign(new Error("x"), { code: "ENODATA" })),
          },
          probe: () => Promise.resolve({ status: 302, location: "http://93.184.216.34/" }),
          dnsTimeoutMs: 50,
        }),
    },
    {
      code: "browserless-auth",
      setup: () => injectExecution({ client: null }),
    },
    {
      code: "browserless-provider",
      setup: () =>
        injectExecution({
          client: { runFunction: async () => ({ ok: false, error: "unavailable" }) },
        }),
    },
    {
      code: "navigation-timeout",
      setup: () =>
        injectExecution({ client: recordingClient(failureEnvelope("navigation-timeout")).client }),
    },
    {
      code: "total-timeout",
      setup: () =>
        injectExecution({
          client: { runFunction: async () => ({ ok: false, error: "timeout" }) },
        }),
    },
    {
      code: "document-too-tall",
      setup: () =>
        injectExecution({ client: recordingClient(failureEnvelope("document-too-tall")).client }),
    },
    {
      code: "too-many-pixels",
      setup: () =>
        injectExecution({ client: recordingClient(failureEnvelope("too-many-pixels")).client }),
    },
    {
      code: "provider-bytes-exceeded",
      setup: () =>
        injectExecution({
          client: { runFunction: async () => ({ ok: false, error: "too-large" }) },
        }),
    },
    {
      code: "invalid-image",
      setup: () =>
        injectExecution({
          client: echoClient({
            image: { base64: Buffer.from("this is not an image").toString("base64") },
          }).client,
        }),
    },
    {
      code: "blob-failure",
      setup: () =>
        injectExecution({
          store: recordingStore({
            put: async () => ({ ok: false, error: "unavailable" }),
          }).store,
        }),
    },
  ];

  for (const { code, setup } of cases) {
    test(`${code}: status, message, persistence, and retry policy match the catalog`, async () => {
      await setup();
      const outcome = captureOutcome(code);
      const { response, body, row, summary } = await drive();

      expect(response.status).toBe(outcome.httpStatus);
      expect(body).toEqual({
        error: outcome.publicMessage,
        code: outcome.code,
        remediation: outcome.remediation,
      });
      // The persisted attempt consumed exactly the catalog fields.
      expect(row).toMatchObject({
        status: outcome.captureStatus,
        errorCode: outcome.code,
        errorMessage: outcome.publicMessage,
        blobPath: null,
        imageHash: null,
      });
      // Retry availability follows the catalog, not the mood of the UI: the
      // failed row on its own is retryable exactly when its catalog row says.
      expect(summarizeVariant("desktop", [row], T0).retryable).toBe(outcome.retryable);
      if (outcome.retryable) {
        // The server spends the one automatic retry itself (D076): the
        // variant's newest attempt is a pending automatic row keyed to the
        // failed one, and there is exactly one of them.
        expect(summary.attempts).toHaveLength(2);
        expect(summary.latest).toMatchObject({ state: "pending", attempt: 2 });
        const automatic = await testDb.db
          .select()
          .from(schema.captures)
          .where(eq(schema.captures.id, summary.latest!.id));
        expect(automatic[0]).toMatchObject({
          origin: "automatic",
          idempotencyKey: `retry:auto:${row.id}`,
        });
      } else {
        expect(summary.attempts).toHaveLength(1);
        expect(summary.latest?.state).toBe("failed");
        expect(summary.retryable).toBe(false);
      }
    });
  }

  test("quota-exceeded leaves the attempt pending and resumable", async () => {
    for (let slot = 0; slot < MAX_ACTIVE_CAPTURES; slot += 1) {
      await claimCaptureLease(testDb.db, `cap-elsewhere-${slot}`, T0);
    }
    const outcome = captureOutcome("quota-exceeded");
    const { response, body, row } = await drive();

    expect(response.status).toBe(429);
    expect(body).toEqual({
      error: outcome.publicMessage,
      code: "quota-exceeded",
      remediation: outcome.remediation,
    });
    // consumesAttempt is false: no failure was persisted, nothing burned.
    expect(row).toMatchObject({ status: "pending", errorCode: null, errorMessage: null });
  });

  test("finalization-failure after a lost fence stays bounded and the winner is untouched", async () => {
    const attempt = await attemptRow();
    const client = recordingClient(async (request) => {
      const context = request.context as { layoutNonce: string; variant: string; targetUrl: string };
      // Another worker finalizes the attempt while the provider runs.
      await applyCaptureTransition(testDb.db, {
        captureId: attempt.id,
        from: "capturing",
        to: "failed",
        now: T0 + 1_000,
        errorCode: "stale-lease",
        errorMessage: captureOutcome("stale-lease").publicMessage,
      });
      return successEnvelope({
        layoutNonce: context.layoutNonce,
        variant: context.variant,
        finalUrl: context.targetUrl,
      });
    });
    injectExecution({ client: client.client });
    const outcome = captureOutcome("finalization-failure");
    const { response, body, row } = await drive();

    expect(response.status).toBe(outcome.httpStatus);
    expect(body).toEqual({
      error: outcome.publicMessage,
      code: outcome.code,
      remediation: outcome.remediation,
    });
    // The terminal row the other worker wrote is not rewritten.
    expect(row).toMatchObject({ status: "failed", errorCode: "stale-lease" });
  });

  test("stale-lease is computed from the published age and never rewrites the row", async () => {
    const attempt = await attemptRow();
    await applyCaptureTransition(testDb.db, {
      captureId: attempt.id,
      from: "pending",
      to: "capturing",
      now: T0,
      finalUrl: "https://safe.example/",
    });
    // Not yet stale at the exact age, stale one millisecond later.
    expect((await variantSummary(T0 + STALE_CAPTURE_AGE_MS)).latest?.state).toBe("capturing");
    const staleSummary = await variantSummary(T0 + STALE_CAPTURE_AGE_MS + 1);
    expect(staleSummary.latest?.state).toBe("stale");
    expect(staleSummary.retryable).toBe(captureOutcome("stale-lease").retryable);
    // The stored row is untouched: stale is computed, never persisted.
    expect(await attemptRow()).toMatchObject({ status: "capturing", errorCode: null });
  });

  test("ready-warning outcomes publish as warnings, not failures", () => {
    for (const code of ["cleanup-pending", "manifest-truncated"]) {
      const outcome = captureOutcome(code);
      expect(outcome.captureStatus).toBe("ready");
      expect(outcome.warn).toBe(true);
      expect(outcome.httpStatus).toBeNull();
      expect(outcome.retryable).toBe(false);
    }
  });
});

describe("no failure surface leaks provider or private material", () => {
  const SENTINELS = [
    "pinata-test-token-sentinel-9f8e7d",
    "Bearer",
    "https://blob.vercel-store.example/signed.png?sig=signed-url-sentinel",
    "https://user:hunter2@internal.example/",
    "169.254.169.254",
    "10.255.255.1",
    "<html><body>private source sentinel</body></html>",
    "at runFunction (/srv/provider/stack.ts:42:7)",
  ];
  const SENTINEL_PAYLOAD = SENTINELS.join(" ");

  async function surfaces() {
    const attempt = await attemptRow();
    const response = await dispatchPOST(build(attempt.id), routeContext(attempt.id));
    const body = await response.json();
    const row = await attemptRow();
    const cleanups = await testDb.db.select().from(schema.captureCleanups);
    return { response, body, row, cleanups };
  }

  function expectNoLeak(body: unknown, row: unknown, cleanups: unknown): void {
    const surfacesJson = [JSON.stringify(body), JSON.stringify(row), JSON.stringify(cleanups)];
    for (const surface of surfacesJson) {
      for (const sentinel of SENTINELS) {
        expect(surface, sentinel).not.toContain(sentinel);
      }
    }
    // Structural proof: the only message surfaces are catalog literals.
    const typed = body as { error?: string; code?: string };
    if (typed.code) {
      const outcome = captureOutcome(typed.code);
      expect(typed.error).toBe(outcome.publicMessage);
    }
  }

  test("a sentinel-laden provider error body is never relayed", async () => {
    injectExecution({
      client: recordingClient(`<html>Provider failure: ${SENTINEL_PAYLOAD}</html>`).client,
    });
    const { response, body, row, cleanups } = await surfaces();
    expect(response.status).toBe(502);
    expect(body).toMatchObject({ code: "browserless-provider" });
    expectNoLeak(body, row, cleanups);
  });

  test("a sentinel-laden thrown provider error is never relayed", async () => {
    injectExecution({
      client: {
        runFunction: () =>
          Promise.reject(new Error(`socket exploded ${SENTINEL_PAYLOAD}`)),
      },
    });
    const { response, body, row, cleanups } = await surfaces();
    expect(response.status).toBe(502);
    expectNoLeak(body, row, cleanups);
  });

  test("a sentinel-laden DNS failure is never relayed", async () => {
    __setAdmissionDepsForTests({
      resolver: {
        resolveCname: () => Promise.reject(new Error(`ENODATA ${SENTINEL_PAYLOAD}`)),
        resolve4: () => Promise.reject(new Error(`ENOTFOUND ${SENTINEL_PAYLOAD}`)),
        resolve6: () => Promise.reject(new Error(`ENODATA ${SENTINEL_PAYLOAD}`)),
      },
      dnsTimeoutMs: 50,
    });
    const { response, body, row, cleanups } = await surfaces();
    expect(response.status).toBe(502);
    expect(body).toMatchObject({ code: "dns-failed" });
    expectNoLeak(body, row, cleanups);
  });

  test("a sentinel-laden storage failure is never relayed", async () => {
    injectExecution({
      store: recordingStore({
        put: async () => {
          throw new Error(`blob write failed ${SENTINEL_PAYLOAD}`);
        },
      }).store,
    });
    const { response, body, row, cleanups } = await surfaces();
    expect(response.status).toBe(502);
    expect(body).toMatchObject({ code: "blob-failure" });
    expectNoLeak(body, row, cleanups);
  });

  test("a sentinel-laden orphan-delete failure leaves only the bounded cleanup label", async () => {
    const attempt = await attemptRow();
    const client = recordingClient(async (request) => {
      const context = request.context as { layoutNonce: string; variant: string; targetUrl: string };
      await applyCaptureTransition(testDb.db, {
        captureId: attempt.id,
        from: "capturing",
        to: "failed",
        now: T0 + 1_000,
        errorCode: "stale-lease",
        errorMessage: captureOutcome("stale-lease").publicMessage,
      });
      return successEnvelope({
        layoutNonce: context.layoutNonce,
        variant: context.variant,
        finalUrl: context.targetUrl,
      });
    });
    injectExecution({
      client: client.client,
      store: recordingStore({
        del: async () => {
          throw new Error(`delete failed ${SENTINEL_PAYLOAD}`);
        },
      }).store,
    });
    const { response, body, row, cleanups } = await surfaces();
    expect(response.status).toBe(502);
    expect(body).toMatchObject({ code: "finalization-failure" });
    expect(cleanups).toHaveLength(1);
    expect(cleanups[0]).toMatchObject({ captureId: attempt.id, lastError: "orphan-delete-failed" });
    expectNoLeak(body, row, cleanups);
  });
});
