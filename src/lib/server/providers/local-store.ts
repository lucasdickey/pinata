// Server-only screenshot store on the local disk, for scratch runs (D141).
//
// Every screenshot otherwise lives in private Vercel Blob, so a local run
// against a scratch database could create projects but never show a
// capture: the demo-video shots (remotion/demo/README.md) and sandbox
// previews both stopped there. With PINATA_LOCAL_BLOB_DIR set, the same
// ScreenshotStore contract writes into that directory instead, one file per
// pathname plus a small sidecar for the content type.
//
// HARD CONSTRAINTS, enforced here rather than documented:
// - Ignored whenever VERCEL is set (as the auth bypass is, D098): a
//   deployment always uses Blob.
// - Ignored unless TURSO_DATABASE_URL is a local file (file:): rows in a
//   shared database must never point at files on one machine's disk.
// - Pathnames stay inside the directory: no absolute paths, no "..".
//
// The file calls carry turbopackIgnore: the directory is known only at run
// time, and without the hint the build would trace the whole repository
// into every server function that can reach this module.

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { BlobResult, ScreenshotStore } from "./blob";

export interface LocalStoreEnv {
  PINATA_LOCAL_BLOB_DIR?: string | undefined;
  TURSO_DATABASE_URL?: string | undefined;
  VERCEL?: string | undefined;
  [key: string]: string | undefined;
}

let warned = false;

function refuse(reason: string): null {
  if (!warned) {
    warned = true;
    console.warn(`[store] PINATA_LOCAL_BLOB_DIR is ignored: ${reason}`);
  }
  return null;
}

/** The directory to store into, or null when the local store must not run. */
export function localStoreDir(env: LocalStoreEnv): string | null {
  const dir = env.PINATA_LOCAL_BLOB_DIR;
  if (!dir) return null;
  if (env.VERCEL) return refuse("it never applies on Vercel.");
  if (!env.TURSO_DATABASE_URL?.startsWith("file:")) {
    return refuse("it needs a local file database (TURSO_DATABASE_URL=file:...).");
  }
  return resolve(dir);
}

/** Map a store pathname into the directory, or null if it would escape it. */
function fileFor(root: string, pathname: string): string | null {
  if (!pathname || pathname.startsWith("/") || pathname.includes("\\")) return null;
  if (pathname.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return null;
  }
  const file = join(root, pathname);
  return file.startsWith(root + sep) ? file : null;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/**
 * The local store, or null when PINATA_LOCAL_BLOB_DIR is unset or refused.
 * Results carry the same shapes and error codes as the Blob store.
 */
export function createLocalScreenshotStore(env: LocalStoreEnv): ScreenshotStore | null {
  const root = localStoreDir(env);
  if (!root) return null;
  const meta = (file: string) => `${file}.meta.json`;

  return {
    async put(pathname, body, contentType) {
      const file = fileFor(root, pathname);
      if (!file) return { ok: false, error: "unavailable" };
      try {
        await mkdir(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
        await writeFile(/*turbopackIgnore: true*/ file, body);
        await writeFile(/*turbopackIgnore: true*/ meta(file), JSON.stringify({ contentType }));
        return { ok: true, value: { pathname, contentType, bytes: body.byteLength } };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },
    async head(pathname) {
      const file = fileFor(root, pathname);
      if (!file) return { ok: false, error: "not-found" };
      try {
        const info = await stat(/*turbopackIgnore: true*/ file);
        const { contentType } = JSON.parse(await readFile(/*turbopackIgnore: true*/ meta(file), "utf8")) as {
          contentType: string;
        };
        return { ok: true, value: { pathname, contentType, bytes: info.size } };
      } catch (error) {
        return { ok: false, error: missing(error) ? "not-found" : "unavailable" };
      }
    },
    async get(pathname): Promise<BlobResult<Uint8Array>> {
      const file = fileFor(root, pathname);
      if (!file) return { ok: false, error: "not-found" };
      try {
        return { ok: true, value: new Uint8Array(await readFile(/*turbopackIgnore: true*/ file)) };
      } catch (error) {
        return { ok: false, error: missing(error) ? "not-found" : "unavailable" };
      }
    },
    async del(pathname) {
      const file = fileFor(root, pathname);
      if (!file) return { ok: false, error: "not-found" };
      try {
        await stat(/*turbopackIgnore: true*/ file);
      } catch (error) {
        return { ok: false, error: missing(error) ? "not-found" : "unavailable" };
      }
      try {
        await rm(/*turbopackIgnore: true*/ file, { force: true });
        await rm(/*turbopackIgnore: true*/ meta(file), { force: true });
        return { ok: true, value: null };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },
  };
}

/** Test-only: let the refusal warning be printed again. */
export function __resetLocalStoreWarningForTests(): void {
  warned = false;
}
