// Focused tests for durable founder-reply throttling (VAL-THREAD-006): the
// published quota per project, the exact recovery boundary, per-project
// isolation, atomic window reset, and the guarantee that the bucket key is a
// digest carrying no token or session material.

import { describe, expect, test } from "vitest";
import { REPLY_MAX_PER_WINDOW, REPLY_WINDOW_MS } from "../../src/lib/boundaries";
import { schema } from "../../src/lib/server/db/client";
import {
  REPLY_THROTTLE_SCOPE,
  checkReplyThrottle,
  registerReply,
  replyBucketKey,
} from "../../src/lib/server/threads/throttle";
import { createTestDb } from "./test-db";

const T0 = 1_800_000_000_000;

describe("replyBucketKey", () => {
  test("is a stable SHA-256 hex of scope + project, never the plaintext", () => {
    const key = replyBucketKey("proj-1");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(replyBucketKey("proj-1", REPLY_THROTTLE_SCOPE));
    expect(key).not.toBe(replyBucketKey("proj-2"));
    expect(key).not.toBe(replyBucketKey("proj-1", "other-scope"));
    expect(key).not.toContain("proj-1");
    expect(key).not.toContain(REPLY_THROTTLE_SCOPE);
  });
});

describe("checkReplyThrottle / registerReply", () => {
  test("an empty bucket is not throttled", async () => {
    const { client, db } = await createTestDb();
    expect(await checkReplyThrottle(db, "proj-1", T0)).toEqual({ throttled: false });
    client.close();
  });

  test("replies up to the published quota are accepted, then throttled until recovery", async () => {
    const { client, db } = await createTestDb();
    for (let n = 1; n <= REPLY_MAX_PER_WINDOW; n += 1) {
      expect(await checkReplyThrottle(db, "proj-1", T0 + n)).toEqual({ throttled: false });
      const result = await registerReply(db, "proj-1", T0 + n);
      expect(result.count).toBe(n);
      expect(result.throttled).toBe(false);
    }
    const state = await checkReplyThrottle(db, "proj-1", T0 + REPLY_MAX_PER_WINDOW + 1);
    expect(state.throttled).toBe(true);
    if (state.throttled) {
      // The window started at the first reply (T0 + 1).
      expect(state.retryAfterMs).toBe(REPLY_WINDOW_MS - REPLY_MAX_PER_WINDOW);
    }
    // A racing registration past the limit reports throttled too.
    const raced = await registerReply(db, "proj-1", T0 + REPLY_MAX_PER_WINDOW + 2);
    expect(raced.throttled).toBe(true);
    // Recovery at exactly window start + window.
    const justBefore = await checkReplyThrottle(db, "proj-1", T0 + 1 + REPLY_WINDOW_MS - 1);
    expect(justBefore.throttled).toBe(true);
    const at = await checkReplyThrottle(db, "proj-1", T0 + 1 + REPLY_WINDOW_MS);
    expect(at).toEqual({ throttled: false });
    // The next registration atomically resets the window.
    const fresh = await registerReply(db, "proj-1", T0 + 1 + REPLY_WINDOW_MS);
    expect(fresh).toEqual({ count: 1, throttled: false, retryAfterMs: REPLY_WINDOW_MS });
    client.close();
  });

  test("projects are throttled independently", async () => {
    const { client, db } = await createTestDb();
    for (let n = 1; n <= REPLY_MAX_PER_WINDOW; n += 1) await registerReply(db, "proj-1", T0 + n);
    expect((await checkReplyThrottle(db, "proj-1", T0 + 100)).throttled).toBe(true);
    expect(await checkReplyThrottle(db, "proj-2", T0 + 100)).toEqual({ throttled: false });
    client.close();
  });

  test("the durable row carries only the digest key and counters", async () => {
    const { client, db } = await createTestDb();
    await registerReply(db, "proj-secret-ish", T0);
    const rows = await db.select().from(schema.rateLimitBuckets);
    expect(rows).toEqual([
      {
        bucketKey: replyBucketKey("proj-secret-ish"),
        count: 1,
        windowStartedAt: T0,
        updatedAt: T0,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("proj-secret-ish");
    client.close();
  });
});
