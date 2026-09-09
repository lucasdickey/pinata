// Integrity of the committed durable fixture host record (D041).
//
// test/fixtures/capture/host.json is written by scripts/publish-capture-fixtures.mjs
// after a verified deploy. It is public and non-secret, so it is committed;
// this test guarantees the committed record still describes the repository
// fixtures byte-for-byte, so a stale or drifting host file fails the gate
// without any network access.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const fixtureDir = path.join(import.meta.dirname, "fixtures", "capture");
const EXPECTED_FIXTURES = ["echo-v1.html", "tall-motion-v1.html", "manifest-v1.html", "links-v1.html"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function readHost() {
  return JSON.parse(await readFile(path.join(fixtureDir, "host.json"), "utf8"));
}

describe("the committed fixture host record", () => {
  test("names the dedicated unprotected project and a safe durable base URL", async () => {
    const host = await readHost();
    expect(host.project).toBe("pinata-fixtures");
    expect(host.deploymentProtection).toBe("disabled");

    const base = new URL(host.baseUrl);
    expect(base.protocol).toBe("https:");
    expect(base.username).toBe("");
    expect(base.password).toBe("");
    expect(base.hash).toBe("");
    expect(base.pathname).toBe("/");
  });

  test("covers exactly the repository fixtures with matching bytes and hashes", async () => {
    const host = await readHost();
    const entries = Object.values(host.fixtures);
    expect(entries.map((entry) => entry.file).sort()).toEqual([...EXPECTED_FIXTURES].sort());

    for (const entry of entries) {
      const bytes = await readFile(path.join(fixtureDir, entry.file));
      expect(entry.url).toBe(`${host.baseUrl}/${entry.file}`);
      expect(entry.bytes).toBe(bytes.byteLength);
      expect(entry.sha256).toBe(sha256(bytes));
    }
  });
});
