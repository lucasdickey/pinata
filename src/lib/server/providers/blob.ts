// Server-only private Vercel Blob boundary. Screenshots are stored in a
// private store; every read and write flows through authorized application
// routes that use this adapter. The browser never receives provider URLs,
// signed URLs, credentials, or pathnames — the adapter's results carry only
// the internal pathname reference, content type, and byte count.
//
// The SDK surface is injectable so focused fault tests can drive
// deterministic outcomes (upload failure, metadata mismatch, delete failure,
// not-found) without network access. Mocks prove adapter behavior only; the
// real private-Blob lifecycle (put/metadata/direct-denial/delete) is verified
// against the configured store by the integration checks that own it.

import {
  del as vercelBlobDel,
  get as vercelBlobGet,
  head as vercelBlobHead,
  put as vercelBlobPut,
  type PutBlobResult,
} from "@vercel/blob";

/** Internal, non-secret metadata the server persists for a stored object. */
export interface BlobObjectInfo {
  /** Internal store pathname; server-only, never sent to the browser. */
  pathname: string;
  contentType: string;
  /** Byte length of the stored object. */
  bytes: number;
}

export type BlobErrorCode = "unavailable" | "not-found";

export type BlobResult<T> = { ok: true; value: T } | { ok: false; error: BlobErrorCode };

/**
 * Storage boundary used by the capture pipeline and asset delivery. All
 * operations are pathname-addressed; provider URLs never cross this seam.
 */
export interface ScreenshotStore {
  /** Store bytes privately at an exact pathname (no random suffix). */
  put(
    pathname: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<BlobResult<BlobObjectInfo>>;
  /** Read metadata for an exact pathname. */
  head(pathname: string): Promise<BlobResult<BlobObjectInfo>>;
  /** Fetch the exact stored bytes, bypassing the CDN cache. */
  get(pathname: string): Promise<BlobResult<Uint8Array>>;
  /** Delete an exact pathname (orphan cleanup); missing objects are ok. */
  del(pathname: string): Promise<BlobResult<null>>;
}

export interface BlobEnv {
  BLOB_READ_WRITE_TOKEN?: string | undefined;
  [key: string]: string | undefined;
}

/** Injectable SDK seam for deterministic fault tests. */
export interface BlobSdk {
  put(
    pathname: string,
    body: Uint8Array,
    options: { access: "private"; token: string; contentType: string; addRandomSuffix: false },
  ): Promise<PutBlobResult>;
  head(pathname: string, options: { token: string }): Promise<{
    pathname: string;
    contentType: string;
    size: number;
  }>;
  get(
    pathname: string,
    options: { access: "private"; token: string; useCache: false },
  ): Promise<{ stream: ReadableStream<Uint8Array> | null } | null>;
  del(pathname: string, options: { token: string }): Promise<void>;
}

const defaultSdk: BlobSdk = {
  put: (pathname, body, options) => vercelBlobPut(pathname, Buffer.from(body), options),
  head: (pathname, options) => vercelBlobHead(pathname, options),
  get: (pathname, options) => vercelBlobGet(pathname, options),
  del: (pathname, options) => vercelBlobDel(pathname, options),
};

function isNotFound(error: unknown): boolean {
  // The SDK's BlobNotFoundError carries name "Error"; match the constructor.
  return (
    error instanceof Error &&
    (error.name === "BlobNotFoundError" || error.constructor.name === "BlobNotFoundError")
  );
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const response = new Response(stream);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Build the private Vercel Blob store from environment configuration, with
 * an injectable SDK for focused fault tests. Fails closed (null) when the
 * token is absent; never logs the token, provider URLs, or object contents.
 */
export function createVercelBlobStore(
  env: BlobEnv,
  sdk: BlobSdk = defaultSdk,
): ScreenshotStore | null {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  return {
    async put(pathname, body, contentType) {
      try {
        const result = await sdk.put(pathname, body, {
          access: "private",
          token,
          contentType,
          addRandomSuffix: false,
        });
        return {
          ok: true,
          value: { pathname: result.pathname, contentType: result.contentType, bytes: body.byteLength },
        };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },
    async head(pathname) {
      try {
        const result = await sdk.head(pathname, { token });
        return {
          ok: true,
          value: {
            pathname: result.pathname,
            contentType: result.contentType,
            bytes: result.size,
          },
        };
      } catch (error) {
        return { ok: false, error: isNotFound(error) ? "not-found" : "unavailable" };
      }
    },
    async get(pathname) {
      try {
        const result = await sdk.get(pathname, { access: "private", token, useCache: false });
        if (!result || !result.stream) return { ok: false, error: "not-found" };
        return { ok: true, value: await streamToBytes(result.stream) };
      } catch (error) {
        return { ok: false, error: isNotFound(error) ? "not-found" : "unavailable" };
      }
    },
    async del(pathname) {
      try {
        await sdk.del(pathname, { token });
        return { ok: true, value: null };
      } catch (error) {
        // Deleting an already-absent object is not a cleanup failure.
        return { ok: false, error: isNotFound(error) ? "not-found" : "unavailable" };
      }
    },
  };
}
