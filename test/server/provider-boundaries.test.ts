// Focused tests for the dependency-injectable provider boundaries
// (feature: turso-schema-and-provider-boundaries). Injected fakes drive
// deterministic success/failure outcomes here; they prove adapter behavior
// and secret hygiene only. Real Turso and private Blob checks live in
// test/integration/turso.integration.test.ts, and real Browserless runs are
// owned by the capture features.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  BROWSERLESS_FUNCTION_ENDPOINT,
  createBrowserlessClient,
  type FetchLike,
} from "../../src/lib/server/providers/browserless";
import { createVercelBlobStore, type BlobSdk } from "../../src/lib/server/providers/blob";

// Non-production sentinel tokens; never real environment values.
const TEST_BROWSERLESS_TOKEN = "test-browserless-token-not-a-real-value";
const TEST_BLOB_TOKEN = "test-blob-token-not-a-real-value";

describe("browserless provider boundary", () => {
  const request = {
    code: "export default async ({ context }) => ({ ok: context.url })",
    context: { url: "https://example.com/" },
    timeoutMs: 5_000,
  };

  test("fails closed when the token is absent", () => {
    expect(createBrowserlessClient({})).toBeNull();
    expect(createBrowserlessClient({ BROWSERLESS_TOKEN: "" })).toBeNull();
  });

  test("posts to the fixed endpoint with the token in the Authorization header, never the URL", async () => {
    let seen: { url: string; init: Record<string, unknown> } | null = null;
    const fetchImpl: FetchLike = async (url, init) => {
      seen = { url, init: init as unknown as Record<string, unknown> };
      return { status: 200, body: new TextEncoder().encode('{"ok":true}') };
    };
    const client = createBrowserlessClient(
      { BROWSERLESS_TOKEN: TEST_BROWSERLESS_TOKEN },
      fetchImpl,
    );
    const result = await client!.runFunction(request);
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: new TextEncoder().encode('{"ok":true}'),
    });
    expect(seen).not.toBeNull();
    expect(seen!.url).toBe(BROWSERLESS_FUNCTION_ENDPOINT);
    expect(seen!.url).not.toContain(TEST_BROWSERLESS_TOKEN);
    const headers = (seen!.init as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe(`Bearer ${TEST_BROWSERLESS_TOKEN}`);
    // User input travels as context data, never interpolated into code.
    const body = JSON.parse(String((seen!.init as { body: string }).body));
    expect(body.context).toEqual({ url: "https://example.com/" });
    expect(body.code).toBe(request.code);
  });

  test("maps provider auth rejection, failure, and oversized responses to bounded codes", async () => {
    const statuses: Array<[number, string]> = [
      [401, "rejected"],
      [403, "rejected"],
      [429, "unavailable"],
      [500, "unavailable"],
    ];
    for (const [status, error] of statuses) {
      const fetchImpl: FetchLike = async () => ({
        status,
        body: new TextEncoder().encode(`provider body that must never leak ${TEST_BROWSERLESS_TOKEN}`),
      });
      const client = createBrowserlessClient(
        { BROWSERLESS_TOKEN: TEST_BROWSERLESS_TOKEN },
        fetchImpl,
      );
      const result = await client!.runFunction(request);
      expect(result).toEqual({ ok: false, error });
      expect(JSON.stringify(result)).not.toContain(TEST_BROWSERLESS_TOKEN);
    }

    const oversized: FetchLike = async () => ({
      status: 200,
      body: new Uint8Array(16_777_216 + 1),
    });
    const client = createBrowserlessClient({ BROWSERLESS_TOKEN: TEST_BROWSERLESS_TOKEN }, oversized);
    await expect(client!.runFunction(request)).resolves.toEqual({ ok: false, error: "too-large" });
  });

  test("maps aborts to a bounded timeout", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    const client = createBrowserlessClient(
      { BROWSERLESS_TOKEN: TEST_BROWSERLESS_TOKEN },
      fetchImpl,
    );
    const result = await client!.runFunction({ ...request, timeoutMs: 10 });
    expect(result).toEqual({ ok: false, error: "timeout" });
  });
});

describe("private blob provider boundary", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);

  function sdkWith(overrides: Partial<BlobSdk>): BlobSdk {
    return {
      put: async (pathname, _body, options) => ({
        url: `https://provider.example/${pathname}`,
        downloadUrl: `https://provider.example/download/${pathname}`,
        pathname,
        contentType: options.contentType,
        contentDisposition: "inline",
        etag: "etag-1",
      }),
      head: async (pathname) => ({ pathname, contentType: "image/webp", size: bytes.length }),
      get: async () => ({ stream: new Response(bytes).body! }),
      del: async () => undefined,
      ...overrides,
    };
  }

  test("fails closed when the token is absent", () => {
    expect(createVercelBlobStore({})).toBeNull();
    expect(createVercelBlobStore({ BLOB_READ_WRITE_TOKEN: "" })).toBeNull();
  });

  test("stores privately at exact pathnames and returns only internal metadata", async () => {
    let putOptions: Record<string, unknown> | null = null;
    const store = createVercelBlobStore(
      { BLOB_READ_WRITE_TOKEN: TEST_BLOB_TOKEN },
      sdkWith({
        put: async (pathname, _body, options) => {
          putOptions = options as unknown as Record<string, unknown>;
          return {
            url: `https://provider.example/${pathname}?signed=secret`,
            downloadUrl: `https://provider.example/download/${pathname}`,
            pathname,
            contentType: options.contentType,
            contentDisposition: "inline",
            etag: "etag-1",
          };
        },
      }),
    );
    const result = await store!.put("captures/test/one.webp", bytes, "image/webp");
    expect(result).toEqual({
      ok: true,
      value: { pathname: "captures/test/one.webp", contentType: "image/webp", bytes: 4 },
    });
    expect(putOptions).toMatchObject({
      access: "private",
      token: TEST_BLOB_TOKEN,
      addRandomSuffix: false,
    });
    // Provider URLs never cross the seam.
    expect(JSON.stringify(result)).not.toContain("provider.example");
  });

  test("reads metadata and exact bytes for authorized server-side lookups", async () => {
    const store = createVercelBlobStore({ BLOB_READ_WRITE_TOKEN: TEST_BLOB_TOKEN }, sdkWith({}));
    await expect(store!.head("captures/test/one.webp")).resolves.toEqual({
      ok: true,
      value: { pathname: "captures/test/one.webp", contentType: "image/webp", bytes: 4 },
    });
    const got = await store!.get("captures/test/one.webp");
    expect(got.ok).toBe(true);
    if (got.ok) expect([...got.value]).toEqual([1, 2, 3, 4]);
  });

  test("maps missing objects and provider failures to bounded codes without leaking tokens", async () => {
    const notFound = Object.assign(new Error("not found"), { name: "BlobNotFoundError" });
    const store = createVercelBlobStore(
      { BLOB_READ_WRITE_TOKEN: TEST_BLOB_TOKEN },
      sdkWith({
        head: async () => {
          throw notFound;
        },
        get: async () => null,
        put: async () => {
          throw new Error(`provider failure echoing ${TEST_BLOB_TOKEN}`);
        },
      }),
    );
    await expect(store!.head("captures/test/missing.webp")).resolves.toEqual({
      ok: false,
      error: "not-found",
    });
    await expect(store!.get("captures/test/missing.webp")).resolves.toEqual({
      ok: false,
      error: "not-found",
    });
    const putResult = await store!.put("captures/test/one.webp", bytes, "image/webp");
    expect(putResult).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(putResult)).not.toContain(TEST_BLOB_TOKEN);
  });
});

describe("provider credential confinement", () => {
  const ROOT = process.cwd();

  function* sourceFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) yield* sourceFiles(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) yield path;
    }
  }

  test("provider and database environment names appear only in server-only modules", () => {
    const offenders: string[] = [];
    const envNames = /TURSO_DATABASE_URL|TURSO_AUTH_TOKEN|BLOB_READ_WRITE_TOKEN|BROWSERLESS_TOKEN/;
    for (const base of ["src", "app"]) {
      for (const file of sourceFiles(join(ROOT, base))) {
        if (file.includes(join("src", "lib", "server"))) continue;
        const content = readFileSync(file, "utf8");
        if (envNames.test(content)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no client-reachable module imports the database or provider boundaries", () => {
    const offenders: string[] = [];
    for (const base of ["src", "app"]) {
      for (const file of sourceFiles(join(ROOT, base))) {
        const content = readFileSync(file, "utf8");
        const isClientModule =
          /["']use client["']/.test(content) || file.includes(join("src", "components"));
        if (!isClientModule) continue;
        if (/server\/db|server\/providers/.test(content)) {
          offenders.push(`${file}: imports a server-only persistence/provider module`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
