// Unit tests for the founder capability store (REQUIREMENTS 7,
// VAL-THREAD-005): token entropy and shape, digest-only persistence,
// create/rotate/revoke transitions, the timing-safe exchange, and the live
// binding check that makes rotation and revocation end every session. Runs
// against the committed migrations in an in-memory libSQL database.

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { schema } from "../../src/lib/server/db/client";
import {
  FOUNDER_TOKEN_BYTES,
  FOUNDER_TOKEN_LENGTH,
  exchangeFounderToken,
  founderBindingIsCurrent,
  founderTokenDigest,
  generateFounderToken,
  isFounderTokenShaped,
  issueFounderCapability,
  readShareStatus,
  revokeFounderCapability,
  shareStatusOf,
} from "../../src/lib/server/founder/capability";
import { createTestDb, type TestDb } from "./test-db";

const T0 = 1_800_000_000_000;

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
  await testDb.db.insert(schema.projects).values([
    {
      id: "proj-a",
      publicId: "pub-a",
      title: "A",
      rootUrl: "https://a.example/",
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: "proj-b",
      publicId: "pub-b",
      title: "B",
      rootUrl: "https://b.example/",
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: "proj-gone",
      publicId: "pub-gone",
      title: "Gone",
      rootUrl: "https://gone.example/",
      createdAt: T0,
      updatedAt: T0,
      deletedAt: T0 + 1,
    },
  ]);
});

afterEach(() => {
  testDb.client.close();
});

async function projectRow(id: string) {
  const rows = await testDb.db.select().from(schema.projects).where(eq(schema.projects.id, id));
  return rows[0]!;
}

describe("token generation and digest", () => {
  test("tokens carry at least 256 random bits and are URL-safe", () => {
    expect(FOUNDER_TOKEN_BYTES * 8).toBeGreaterThanOrEqual(256);
    const token = generateFounderToken();
    expect(token).toHaveLength(FOUNDER_TOKEN_LENGTH);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // Fragment-safe: nothing that a URL parser would treat specially.
    expect(encodeURIComponent(token)).toBe(token);
    expect(isFounderTokenShaped(token)).toBe(true);
  });

  test("tokens are unique across many generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateFounderToken());
    expect(seen.size).toBe(500);
  });

  test("the digest is a stable SHA-256 hex that never contains the token", () => {
    const token = generateFounderToken();
    const digest = founderTokenDigest(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe(founderTokenDigest(token));
    expect(digest).not.toContain(token);
    expect(founderTokenDigest(generateFounderToken())).not.toBe(digest);
  });

  test("only exactly-shaped values count as tokens", () => {
    expect(isFounderTokenShaped("")).toBe(false);
    expect(isFounderTokenShaped("a".repeat(42))).toBe(false);
    expect(isFounderTokenShaped("a".repeat(44))).toBe(false);
    expect(isFounderTokenShaped(`${"a".repeat(42)}+`)).toBe(false);
    expect(isFounderTokenShaped(42)).toBe(false);
    expect(isFounderTokenShaped(null)).toBe(false);
  });
});

describe("issue, rotate, revoke", () => {
  test("a fresh project has no capability", async () => {
    expect(await readShareStatus(testDb.db, "pub-a")).toEqual({
      state: "none",
      version: 0,
      revokedAt: null,
    });
  });

  test("issuing persists only the digest and bumps the version", async () => {
    const issued = await issueFounderCapability(testDb.db, "pub-a", T0 + 10);
    expect(issued).not.toBeNull();
    expect(issued!.status).toEqual({ state: "active", version: 1, revokedAt: null });
    const row = await projectRow("proj-a");
    expect(row.shareTokenDigest).toBe(founderTokenDigest(issued!.token));
    expect(row.shareTokenVersion).toBe(1);
    expect(row.shareRevokedAt).toBeNull();
    expect(row.updatedAt).toBe(T0 + 10);
    // The raw token is nowhere in the durable row.
    expect(JSON.stringify(row)).not.toContain(issued!.token);
    expect(await readShareStatus(testDb.db, "pub-a")).toEqual(issued!.status);
  });

  test("rotation replaces the digest, increments the version, and the old token dies", async () => {
    const first = await issueFounderCapability(testDb.db, "pub-a", T0 + 10);
    const second = await issueFounderCapability(testDb.db, "pub-a", T0 + 20);
    expect(second!.token).not.toBe(first!.token);
    expect(second!.status.version).toBe(2);
    const row = await projectRow("proj-a");
    expect(row.shareTokenDigest).toBe(founderTokenDigest(second!.token));
    expect(await exchangeFounderToken(testDb.db, "pub-a", first!.token)).toBeNull();
    expect(await exchangeFounderToken(testDb.db, "pub-a", second!.token)).toEqual({
      projectId: "proj-a",
      publicId: "pub-a",
      version: 2,
    });
  });

  test("revocation clears the digest, stamps the instant, and keeps history", async () => {
    const issued = await issueFounderCapability(testDb.db, "pub-a", T0 + 10);
    const revoked = await revokeFounderCapability(testDb.db, "pub-a", T0 + 30);
    expect(revoked).toEqual({
      ok: true,
      status: { state: "revoked", version: 1, revokedAt: T0 + 30 },
    });
    const row = await projectRow("proj-a");
    expect(row.shareTokenDigest).toBeNull();
    expect(row.shareRevokedAt).toBe(T0 + 30);
    expect(row.deletedAt).toBeNull();
    expect(row.title).toBe("A");
    expect(await exchangeFounderToken(testDb.db, "pub-a", issued!.token)).toBeNull();
    // Idempotent: a second revoke reports the same state.
    expect(await revokeFounderCapability(testDb.db, "pub-a", T0 + 40)).toEqual(revoked);
  });

  test("re-issuing after a revocation clears the revocation and moves on", async () => {
    await issueFounderCapability(testDb.db, "pub-a", T0 + 10);
    await revokeFounderCapability(testDb.db, "pub-a", T0 + 20);
    const reissued = await issueFounderCapability(testDb.db, "pub-a", T0 + 30);
    expect(reissued!.status).toEqual({ state: "active", version: 2, revokedAt: null });
    expect(await exchangeFounderToken(testDb.db, "pub-a", reissued!.token)).toMatchObject({
      version: 2,
    });
  });

  test("a project that never issued a link has nothing to revoke", async () => {
    expect(await revokeFounderCapability(testDb.db, "pub-a", T0)).toEqual({
      ok: false,
      error: "never-issued",
    });
  });

  test("missing and tombstoned projects are the same null everywhere", async () => {
    for (const publicId of ["pub-missing", "pub-gone"]) {
      expect(await readShareStatus(testDb.db, publicId)).toBeNull();
      expect(await issueFounderCapability(testDb.db, publicId, T0)).toBeNull();
      expect(await revokeFounderCapability(testDb.db, publicId, T0)).toEqual({
        ok: false,
        error: "not-found",
      });
    }
  });

  test("shareStatusOf derives the three states from the columns", () => {
    expect(shareStatusOf({ shareTokenDigest: null, shareTokenVersion: 0, shareRevokedAt: null }))
      .toEqual({ state: "none", version: 0, revokedAt: null });
    expect(shareStatusOf({ shareTokenDigest: "d", shareTokenVersion: 3, shareRevokedAt: null }))
      .toEqual({ state: "active", version: 3, revokedAt: null });
    expect(shareStatusOf({ shareTokenDigest: null, shareTokenVersion: 3, shareRevokedAt: 5 }))
      .toEqual({ state: "revoked", version: 3, revokedAt: 5 });
  });
});

describe("exchange", () => {
  test("verifies by digest and never by the stored value", async () => {
    const issued = await issueFounderCapability(testDb.db, "pub-a", T0);
    // Presenting the digest itself is not the token.
    const digest = founderTokenDigest(issued!.token);
    expect(await exchangeFounderToken(testDb.db, "pub-a", digest.slice(0, 43))).toBeNull();
    // One character off fails.
    const flipped = `${issued!.token.slice(0, -1)}${issued!.token.endsWith("A") ? "B" : "A"}`;
    expect(await exchangeFounderToken(testDb.db, "pub-a", flipped)).toBeNull();
    expect(await exchangeFounderToken(testDb.db, "pub-a", issued!.token)).toEqual({
      projectId: "proj-a",
      publicId: "pub-a",
      version: 1,
    });
  });

  test("a token exchanged against another project's public id fails", async () => {
    const a = await issueFounderCapability(testDb.db, "pub-a", T0);
    await issueFounderCapability(testDb.db, "pub-b", T0);
    expect(await exchangeFounderToken(testDb.db, "pub-b", a!.token)).toBeNull();
  });

  test("malformed, never-issued, revoked, and tombstoned cases are all null", async () => {
    expect(await exchangeFounderToken(testDb.db, "pub-a", "")).toBeNull();
    expect(await exchangeFounderToken(testDb.db, "pub-a", generateFounderToken())).toBeNull();
    const issued = await issueFounderCapability(testDb.db, "pub-a", T0);
    await revokeFounderCapability(testDb.db, "pub-a", T0 + 1);
    expect(await exchangeFounderToken(testDb.db, "pub-a", issued!.token)).toBeNull();
    expect(await exchangeFounderToken(testDb.db, "pub-gone", generateFounderToken())).toBeNull();
    expect(await exchangeFounderToken(testDb.db, "pub-missing", generateFounderToken())).toBeNull();
  });
});

describe("live binding check", () => {
  test("is current only for the active version of a live, unrevoked project", async () => {
    expect(await founderBindingIsCurrent(testDb.db, "proj-a", 1)).toBe(false);
    await issueFounderCapability(testDb.db, "pub-a", T0);
    expect(await founderBindingIsCurrent(testDb.db, "proj-a", 1)).toBe(true);
    expect(await founderBindingIsCurrent(testDb.db, "proj-a", 2)).toBe(false);
    expect(await founderBindingIsCurrent(testDb.db, "proj-b", 1)).toBe(false);
    // Rotation ends version 1.
    await issueFounderCapability(testDb.db, "pub-a", T0 + 1);
    expect(await founderBindingIsCurrent(testDb.db, "proj-a", 1)).toBe(false);
    expect(await founderBindingIsCurrent(testDb.db, "proj-a", 2)).toBe(true);
    // Revocation ends the current version too.
    await revokeFounderCapability(testDb.db, "pub-a", T0 + 2);
    expect(await founderBindingIsCurrent(testDb.db, "proj-a", 2)).toBe(false);
    // A tombstoned project is never current.
    await testDb.db.insert(schema.projects).values({
      id: "proj-c",
      publicId: "pub-c",
      title: "C",
      rootUrl: "https://c.example/",
      shareTokenDigest: "d".repeat(64),
      shareTokenVersion: 1,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: T0,
    });
    expect(await founderBindingIsCurrent(testDb.db, "proj-c", 1)).toBe(false);
  });
});
