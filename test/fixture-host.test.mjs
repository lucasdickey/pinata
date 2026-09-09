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
const EXPECTED_FIXTURES = [
  "echo-v1.html",
  "tall-motion-v1.html",
  "manifest-v1.html",
  "links-v1.html",
  "links-v2.html",
  "remote-network-v1.html",
  "remote-network-hard-v1.html",
  "pixel-v1.png",
];

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

describe("the remote-network fixture (VAL-CAPTURE-013)", () => {
  test("pins its version and probe inventory without prefilled sentinels", async () => {
    const html = await readFile(path.join(fixtureDir, "remote-network-v1.html"), "utf8");
    expect(html).toContain("fixture-version: remote-network-v1");
    // The leak marker is assembled at runtime so even a manifest regression
    // that collected script text could not produce a false positive.
    expect(html).not.toContain("PRIVLEAK");
    expect(html).toContain('"PRIV" + "LEAK"');
    // Every private-destination vector the contract names is present:
    // redirect, fetch, frame, worker, WebSocket, image, and DNS-rebind names
    // that resolve private only when looked up.
    for (const marker of [
      "probe-fetch-rfc1918",
      "probe-fetch-rebind-loopback",
      "probe-fetch-rebind-live",
      "probe-fetch-redirect-meta",
      "probe-image-rfc1918",
      "probe-ws-loopback",
      "probe-ws-rebind",
      "probe-worker-rebind-meta",
      "probe-frame-rfc1918",
      "probe-frame-rebind-meta",
      "probes-settled",
    ]) {
      expect(html, marker).toContain(marker);
    }
    // No private address is ever painted as visible text: each lives only
    // inside the probe script, so the persisted-manifest scan for those
    // addresses is a true leak detector.
    for (const address of ["169.254.169.254", "127.0.0.1", "192.168.", "10.0.0.1", "fd00::"]) {
      const visibleOnly = html.replace(/<script>[\s\S]*?<\/script>/g, "");
      expect(visibleOnly, address).not.toContain(address);
    }
  });

  test("the hard companion carries the session-fatal literal destinations", async () => {
    const html = await readFile(path.join(fixtureDir, "remote-network-hard-v1.html"), "utf8");
    expect(html).toContain("fixture-version: remote-network-hard-v1");
    expect(html).not.toContain("PRIVLEAK");
    expect(html).toContain('"PRIV" + "LEAK"');
    // Literal loopback, link-local, metadata, and both IPv6-local forms are
    // the destinations the provider destroys the session over.
    for (const address of [
      "https://169.254.169.254/latest/meta-data/",
      "https://127.0.0.1/",
      "https://169.254.1.10/",
      "https://[::1]/",
      "https://[fd00::1]/",
    ]) {
      expect(html, address).toContain(address);
    }
    const visibleOnly = html.replace(/<script>[\s\S]*?<\/script>/g, "");
    expect(visibleOnly).not.toContain("169.254.169.254");
  });

  test("the public pixel fixture is a decodable PNG", async () => {
    const bytes = await readFile(path.join(fixtureDir, "pixel-v1.png"));
    // PNG signature; the live suite decodes it fully after a real load.
    expect([...bytes.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });
});
