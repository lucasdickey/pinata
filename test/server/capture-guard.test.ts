// The Browserless in-function request guard (VAL-CAPTURE-002).
//
// The guard ships as JavaScript source that executes in the provider's
// sandbox, so these tests evaluate that exact source rather than a TypeScript
// restatement of it, and cross-check its host verdicts against the shared
// non-public address catalog.

import { describe, expect, test } from "vitest";
import { NON_PUBLIC_ADDRESS_RANGES } from "../../src/lib/boundaries";
import { isPublicAddress, parseIpAddress } from "../../src/lib/net/address";
import {
  REQUEST_GUARD_INSTALL_SOURCE,
  REQUEST_GUARD_SOURCE,
  buildRequestGuardSource,
} from "../../src/lib/server/captures/guard";

interface Guard {
  checkNavigation(url: string): string | null;
  checkSubresource(url: string): string | null;
}

const guard: Guard = new Function(`${REQUEST_GUARD_SOURCE}\nreturn __pinataGuard;`)() as Guard;

describe("top-level navigation policy", () => {
  test.each([
    "https://example.com/",
    "https://docs.example.org/guide?ref=a",
    "https://xn--bcher-kva.example/",
  ])("%s is allowed", (url) => {
    expect(guard.checkNavigation(url)).toBeNull();
  });

  test.each([
    ["plain HTTP", "http://example.com/", "scheme"],
    ["a file URL", "file:///etc/passwd", "scheme"],
    ["a data URL", "data:text/html,<h1>x</h1>", "scheme"],
    ["credentials", "https://user:pass@example.com/", "credentials"],
    ["a non-443 port", "https://example.com:8443/", "port"],
    ["an IPv4 literal", "https://93.184.216.34/", "ip-literal"],
    ["a decimal IPv4 spelling", "https://2130706433/", "ip-literal"],
    ["the metadata address", "https://169.254.169.254/latest/meta-data/", "ip-literal"],
    ["an IPv6 literal", "https://[::1]/", "ip-literal"],
    ["localhost", "https://localhost/", "reserved-host"],
    ["a single-label host", "https://intranet/", "reserved-host"],
    ["an internal suffix", "https://db.internal/", "reserved-host"],
    ["a malformed URL", "https://", "malformed"],
  ])("%s is refused as %s", (_label, url, reason) => {
    expect(guard.checkNavigation(url)).toBe(reason);
  });
});

describe("subresource policy", () => {
  test.each([
    ["an ordinary HTTPS asset", "https://cdn.example.com/app.js"],
    ["an HTTPS asset on another port", "https://cdn.example.com:8443/app.js"],
    ["a public HTTP asset", "http://images.example.org/logo.png"],
    ["a public WebSocket", "wss://live.example.com/socket"],
    ["an inline data image", "data:image/png;base64,iVBORw0KGgo="],
    ["a blob URL", "blob:https://example.com/8f1c"],
    ["about:blank", "about:blank"],
  ])("%s stays available", (_label, url) => {
    expect(guard.checkSubresource(url), url).toBeNull();
  });

  test.each([
    ["a metadata fetch", "http://169.254.169.254/latest/meta-data/", "ip-literal"],
    ["a loopback fetch", "http://127.0.0.1:8080/admin", "ip-literal"],
    ["a private-range fetch", "https://10.0.0.5/secret", "ip-literal"],
    ["an IPv6 loopback fetch", "http://[::1]:9000/", "ip-literal"],
    ["an IPv6 unique-local fetch", "https://[fd00::1]/", "ip-literal"],
    ["a link-local fetch", "https://169.254.1.10/", "ip-literal"],
    ["a loopback WebSocket", "wss://127.0.0.1/", "ip-literal"],
    ["a private-range image", "http://10.0.0.1/favicon.ico", "ip-literal"],
    ["a localhost frame", "https://localhost:3100/api/projects", "reserved-host"],
    ["an internal host", "https://vault.internal/token", "reserved-host"],
    ["a credentialed asset", "https://user:pass@cdn.example.com/app.js", "credentials"],
    ["a file read", "file:///etc/passwd", "scheme"],
    ["an FTP fetch", "ftp://files.example.com/secret", "scheme"],
  ])("%s is refused as %s", (_label, url, reason) => {
    expect(guard.checkSubresource(url), url).toBe(reason);
  });

  // VAL-CAPTURE-013: the remote-network fixture's rebinding probes use public
  // host *shapes* whose DNS answers are private. The sandbox has no resolver,
  // so the guard deliberately lets these through to the one layer that can
  // see the answer: the provider's private-network enforcement. The live
  // fixture suite proves that layer holds.
  test.each([
    "https://127.0.0.1.nip.io/",
    "https://169.254.169.254.nip.io/latest/meta-data/",
    "https://7f000001.08080808.rbndr.us/",
  ])("rebind-shaped name %s passes the shape guard to the provider layer", (url) => {
    expect(guard.checkSubresource(url)).toBeNull();
    expect(guard.checkNavigation(url)).toBeNull();
  });
});

describe("agreement with the shared address catalog", () => {
  test("every non-public range's base address is refused as a host", () => {
    for (const range of NON_PUBLIC_ADDRESS_RANGES) {
      const address = range.cidr.slice(0, range.cidr.lastIndexOf("/"));
      const parsed = parseIpAddress(address)!;
      const host = parsed.family === "ipv6" ? `[${address}]` : address;
      expect(isPublicAddress(address), range.cidr).toBe(false);
      expect(guard.checkSubresource(`https://${host}/probe`), range.cidr).toBe("ip-literal");
    }
  });

  test("the guard is stricter than the catalog: public literals are refused too", () => {
    // The sandbox has no resolver, so it refuses the whole literal space
    // rather than doing address arithmetic remotely.
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(guard.checkSubresource("https://93.184.216.34/asset.js")).toBe("ip-literal");
  });
});

describe("source shape", () => {
  test("the emitted source carries no capture target or credential", () => {
    const source = buildRequestGuardSource();
    expect(source).toContain("__pinataGuard");
    expect(source).toContain("__pinataInstallGuard");
    // Only the host/scheme catalogs are interpolated. No absolute URL may be
    // baked into executed code, which is what keeps a capture target — and
    // anything a target could smuggle into one — out of the provider sandbox.
    expect(source).not.toMatch(/https?:\/\//);
    expect(source.match(/\[".*?"\]/g)).toEqual([
      '["localhost","local","internal","intranet","home.arpa","invalid","test","onion"]',
      '["https:","http:","wss:","ws:"]',
      '["data:","blob:","about:"]',
    ]);
  });

  test("the install fragment never disables a browser protection", () => {
    expect(REQUEST_GUARD_INSTALL_SOURCE).not.toMatch(
      /disable-web-security|ignoreHTTPSErrors|no-sandbox|setBypassCSP/i,
    );
  });

  test("the install fragment records refusals without the refused URL", () => {
    expect(REQUEST_GUARD_INSTALL_SOURCE).toContain("__pinataBlocked.push({ topLevel, reason })");
    expect(REQUEST_GUARD_INSTALL_SOURCE).not.toMatch(/push\([^)]*url/);
  });

  test("the combined source parses as JavaScript", () => {
    expect(() => new Function(buildRequestGuardSource())).not.toThrow();
  });
});
