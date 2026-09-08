// Executable proof that the URL admission boundary matches the published
// fixtures exactly (VAL-PROJECT-002). The catalog fixtures are the contract;
// the extra cases below cover the boundaries the fixtures cannot carry
// inline (byte limits, exotic IP spellings, hostile input shapes).

import { describe, expect, test } from "vitest";
import { MAX_URL_BYTES, URL_NORMALIZATION_FIXTURES } from "../src/lib/boundaries";
import { normalizeProjectUrl } from "../src/lib/url/normalize";

describe("published URL normalization fixtures", () => {
  for (const fixture of URL_NORMALIZATION_FIXTURES) {
    if (fixture.type === "normalize") {
      test(fixture.name, () => {
        expect(normalizeProjectUrl(fixture.input)).toEqual({ ok: true, url: fixture.url });
      });
    } else if (fixture.type === "reject") {
      test(fixture.name, () => {
        expect(normalizeProjectUrl(fixture.input)).toEqual({
          ok: false,
          reason: fixture.reason,
        });
      });
    } else {
      test(fixture.name, () => {
        for (const input of fixture.inputs) {
          expect(normalizeProjectUrl(input)).toEqual({ ok: true, url: fixture.url });
        }
      });
    }
  }
});

describe("per-row byte limit", () => {
  const longPath = (bytes: number) => `https://example.com/${"a".repeat(bytes)}`;

  test("accepts a row at exactly the limit", () => {
    const base = "https://example.com/";
    const url = longPath(MAX_URL_BYTES - base.length);
    expect(Buffer.byteLength(url, "utf8")).toBe(MAX_URL_BYTES);
    expect(normalizeProjectUrl(url)).toEqual({ ok: true, url });
  });

  test("rejects the limit plus one byte", () => {
    const base = "https://example.com/";
    const url = longPath(MAX_URL_BYTES - base.length + 1);
    expect(Buffer.byteLength(url, "utf8")).toBe(MAX_URL_BYTES + 1);
    expect(normalizeProjectUrl(url)).toEqual({ ok: false, reason: "too-long" });
  });

  test("measures UTF-8 bytes, not characters", () => {
    // Four-byte astral characters reach the byte cap at a quarter of the
    // character count.
    const url = `https://example.com/${"𝍄".repeat(MAX_URL_BYTES / 4)}`;
    expect(url.length).toBeLessThan(MAX_URL_BYTES);
    expect(normalizeProjectUrl(url)).toEqual({ ok: false, reason: "too-long" });
  });
});

describe("non-public destinations are rejected before any capture work", () => {
  test.each([
    ["https://127.0.0.1/", "ip-literal"],
    ["https://127.1/", "ip-literal"],
    ["https://0x7f.0x0.0x0.0x1/", "ip-literal"],
    ["https://0177.0.0.1/", "ip-literal"],
    ["https://2130706433/", "ip-literal"],
    ["https://10.11.12.13/", "ip-literal"],
    ["https://172.16.0.1/", "ip-literal"],
    ["https://192.168.1.1/", "ip-literal"],
    ["https://169.254.169.254/latest/meta-data/", "ip-literal"],
    ["https://100.64.0.1/", "ip-literal"],
    ["https://224.0.0.1/", "ip-literal"],
    ["https://[::1]/", "ip-literal"],
    ["https://[fd00::1]/", "ip-literal"],
    ["https://[fe80::1]/", "ip-literal"],
    ["https://[::ffff:127.0.0.1]/", "ip-literal"],
    ["https://localhost/", "not-public"],
    ["https://LOCALHOST/", "not-public"],
    ["https://localhost./", "not-public"],
    ["https://app.localhost/", "not-public"],
    ["https://printer.local/", "not-public"],
    ["https://db.internal/", "not-public"],
    ["https://wiki/", "not-public"],
    ["https://example.invalid/", "not-public"],
    ["https://host.home.arpa/", "not-public"],
  ])("%s is rejected as %s", (input, reason) => {
    expect(normalizeProjectUrl(input)).toEqual({ ok: false, reason });
  });
});

describe("hostile and malformed input shapes", () => {
  test.each([
    ["", "blank"],
    ["   ", "blank"],
    ["/pricing", "relative"],
    ["example.com/pricing", "relative"],
    ["//example.com/pricing", "relative"],
    ["javascript:alert(1)", "scheme"],
    ["data:text/html,<b>x</b>", "scheme"],
    ["file:///etc/hosts", "scheme"],
    ["ftp://example.com/", "scheme"],
    ["http://example.com/", "scheme"],
    ["https://", "malformed"],
    ["https://.com/", "malformed"],
    ["https://a..b/", "malformed"],
    // WHATWG reads the empty authority as the host "pricing", which is a
    // single-label name no public site can own.
    ["https:///pricing", "not-public"],
    ["https://user@example.com/", "credentials"],
    ["https://user:pass@example.com/", "credentials"],
    ["https://example.com:8443/", "port"],
    ["https://example.com:80/", "port"],
  ])("%s is rejected as %s", (input, reason) => {
    expect(normalizeProjectUrl(input)).toEqual({ ok: false, reason });
  });

  test("an encoded credential separator cannot smuggle a different host", () => {
    // %40 stays encoded in the path, so the host is still the real one.
    const result = normalizeProjectUrl("https://example.com/%40evil.example/");
    expect(result).toEqual({ ok: true, url: "https://example.com/%40evil.example/" });
  });

  test("a scheme-relative redirect-looking row keeps its own identity", () => {
    expect(normalizeProjectUrl("https://example.com/out?to=https://evil.example/")).toEqual({
      ok: true,
      url: "https://example.com/out?to=https://evil.example/",
    });
  });
});

describe("page identity", () => {
  test("fragments never create a second page", () => {
    const bare = normalizeProjectUrl("https://example.com/pricing");
    const fragment = normalizeProjectUrl("https://example.com/pricing#plans");
    const other = normalizeProjectUrl("https://example.com/pricing#faq");
    expect(fragment).toEqual(bare);
    expect(other).toEqual(bare);
  });

  test("case, encoding, and trailing slashes stay distinct where the policy says so", () => {
    const identities = [
      "https://example.com/Pricing",
      "https://example.com/pricing",
      "https://example.com/pricing/",
      "https://example.com/%7Eme",
      "https://example.com/~me",
    ].map((input) => {
      const result = normalizeProjectUrl(input);
      return result.ok ? result.url : "rejected";
    });
    expect(new Set(identities).size).toBe(identities.length);
  });

  test("query order and duplicates survive normalization", () => {
    expect(normalizeProjectUrl("https://example.com/s?b=2&a=1&b=3")).toEqual({
      ok: true,
      url: "https://example.com/s?b=2&a=1&b=3",
    });
  });
});
