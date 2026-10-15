// The local-disk screenshot store for scratch runs (D141): it honors the
// same ScreenshotStore contract as private Blob, it keeps every pathname
// inside its directory, and it refuses to run on Vercel or beside a
// database that is not a local file.

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  __resetLocalStoreWarningForTests,
  createLocalScreenshotStore,
  localStoreDir,
} from "../../src/lib/server/providers/local-store";
import { __setScreenshotStoreForTests, getScreenshotStore } from "../../src/lib/server/captures/deps";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pinata-local-store-"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __resetLocalStoreWarningForTests();
  __setScreenshotStoreForTests(undefined);
});

const scratch = () => ({
  PINATA_LOCAL_BLOB_DIR: dir,
  TURSO_DATABASE_URL: "file:/tmp/scratch.db",
});

describe("when the local store runs", () => {
  test("only with a directory, a file database, and no Vercel", () => {
    expect(localStoreDir(scratch())).toBe(dir);
    expect(localStoreDir({ ...scratch(), PINATA_LOCAL_BLOB_DIR: "" })).toBeNull();
    expect(localStoreDir({ ...scratch(), VERCEL: "1" })).toBeNull();
    expect(
      localStoreDir({ ...scratch(), TURSO_DATABASE_URL: "libsql://pinata.turso.io" }),
    ).toBeNull();
    expect(localStoreDir({ PINATA_LOCAL_BLOB_DIR: dir })).toBeNull();
  });

  test("a refusal says why, once, and never prints the database address", () => {
    const warn = vi.mocked(console.warn);
    localStoreDir({ ...scratch(), TURSO_DATABASE_URL: "libsql://secret-host.turso.io" });
    localStoreDir({ ...scratch(), VERCEL: "1" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("local file database");
    expect(String(warn.mock.calls[0]![0])).not.toContain("secret-host");
  });

  test("the process store prefers it, and otherwise falls back to Blob's rules", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("TURSO_DATABASE_URL", "file:/tmp/scratch.db");
    vi.stubEnv("PINATA_LOCAL_BLOB_DIR", dir);
    expect(getScreenshotStore()).not.toBeNull();
    vi.stubEnv("PINATA_LOCAL_BLOB_DIR", "");
    // No local directory and no Blob token: no store at all, as before.
    expect(getScreenshotStore()).toBeNull();
  });
});

describe("the store contract", () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);

  test("put, head, get, and del round-trip one object", async () => {
    const store = createLocalScreenshotStore(scratch())!;
    const path = "captures/page_1/cap_1-abc.webp";
    expect(await store.put(path, bytes, "image/webp")).toEqual({
      ok: true,
      value: { pathname: path, contentType: "image/webp", bytes: 5 },
    });
    expect(await store.head(path)).toEqual({
      ok: true,
      value: { pathname: path, contentType: "image/webp", bytes: 5 },
    });
    const got = await store.get(path);
    expect(got.ok && Array.from(got.value)).toEqual([1, 2, 3, 4, 5]);
    expect(await store.del(path)).toEqual({ ok: true, value: null });
    expect(await store.head(path)).toEqual({ ok: false, error: "not-found" });
    expect(await store.get(path)).toEqual({ ok: false, error: "not-found" });
    expect(await store.del(path)).toEqual({ ok: false, error: "not-found" });
    expect(readdirSync(join(dir, "captures", "page_1"))).toEqual([]);
  });

  test("a pathname can never leave the directory", async () => {
    const store = createLocalScreenshotStore(scratch())!;
    for (const path of ["../escape.webp", "/etc/passwd", "a/../../b.webp", "a//b.webp", "a\\b.webp", ""]) {
      expect(await store.put(path, bytes, "image/webp")).toEqual({
        ok: false,
        error: "unavailable",
      });
      expect(await store.get(path)).toEqual({ ok: false, error: "not-found" });
    }
    expect(readdirSync(dir)).toEqual([]);
  });
});
