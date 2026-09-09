// The public-HTTPS admission boundary: canonicalization order, bounded CNAME
// chains, mixed A/AAAA answers, fail-closed DNS, and redirect-hop
// revalidation (VAL-CAPTURE-001, VAL-CAPTURE-002).

import { describe, expect, test, vi } from "vitest";
import { MAX_CNAME_HOPS, MAX_REDIRECT_HOPS } from "../../src/lib/boundaries";
import {
  admitCaptureTarget,
  type AdmissionDeps,
  type RedirectProbe,
} from "../../src/lib/server/captures/admission";
import { resolveHostPublicly, type DnsResolver } from "../../src/lib/server/captures/dns";

/** A resolver driven by explicit per-host answers; anything unlisted is NXDOMAIN. */
interface FakeZone {
  cname?: Record<string, string[]>;
  a?: Record<string, string[]>;
  aaaa?: Record<string, string[]>;
  /** Hosts whose query never settles. */
  hangs?: string[];
  /** Hosts whose query fails ambiguously (SERVFAIL). */
  servfail?: { cname?: string[]; a?: string[]; aaaa?: string[] };
}

function nxdomain(): never {
  throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
}

function servfail(): never {
  throw Object.assign(new Error("server failure"), { code: "ESERVFAIL" });
}

function fakeResolver(zone: FakeZone): DnsResolver {
  const answer = (
    table: Record<string, string[]> | undefined,
    failures: string[] | undefined,
    host: string,
  ): Promise<string[]> => {
    if (zone.hangs?.includes(host)) return new Promise<string[]>(() => {});
    if (failures?.includes(host)) return Promise.resolve().then(servfail);
    const values = table?.[host];
    if (!values) return Promise.resolve().then(nxdomain);
    return Promise.resolve(values);
  };
  return {
    resolveCname: (host) => answer(zone.cname, zone.servfail?.cname, host),
    resolve4: (host) => answer(zone.a, zone.servfail?.a, host),
    resolve6: (host) => answer(zone.aaaa, zone.servfail?.aaaa, host),
  };
}

/** The default happy zone: one public A record for every named host. */
const publicZone = (...hosts: string[]): FakeZone => ({
  a: Object.fromEntries(hosts.map((host) => [host, ["93.184.216.34"]])),
});

const deps = (zone: FakeZone, probe?: RedirectProbe): AdmissionDeps => ({
  resolver: fakeResolver(zone),
  ...(probe ? { probe } : {}),
  dnsTimeoutMs: 50,
});

/** A probe backed by a fixed chain: url → next url, terminating at 200. */
function chainProbe(chain: Record<string, string>): RedirectProbe {
  return (url) =>
    Promise.resolve(
      chain[url] === undefined
        ? { status: 200, location: null }
        : { status: 302, location: chain[url]! },
    );
}

describe("initial target admission", () => {
  test("a public HTTPS target is admitted with its canonical form", async () => {
    const result = await admitCaptureTarget(
      "HTTPS://Example.COM:443/Pricing?ref=a#team",
      deps(publicZone("example.com")),
    );
    expect(result).toEqual({
      ok: true,
      target: {
        requestedUrl: "https://example.com/Pricing?ref=a",
        finalUrl: "https://example.com/Pricing?ref=a",
        hops: 0,
      },
    });
  });

  test.each([
    ["a relative URL", "/pricing", "relative"],
    ["plain HTTP", "http://example.com/", "scheme"],
    ["a javascript URL", "javascript:alert(1)", "scheme"],
    ["user information", "https://user:pass@example.com/", "credentials"],
    ["a bare password", "https://:pass@example.com/", "credentials"],
    ["a non-443 port", "https://example.com:8443/", "port"],
    ["an IPv4 literal", "https://93.184.216.34/", "ip-literal"],
    ["a decimal IPv4 spelling", "https://2130706433/", "ip-literal"],
    ["an octal IPv4 spelling", "https://0177.0.0.1/", "ip-literal"],
    ["a hex IPv4 spelling", "https://0x7f000001/", "ip-literal"],
    ["a metadata literal", "https://169.254.169.254/latest/meta-data/", "ip-literal"],
    ["an IPv6 loopback literal", "https://[::1]/", "ip-literal"],
    ["an IPv4-mapped IPv6 literal", "https://[::ffff:127.0.0.1]/", "ip-literal"],
    ["localhost", "https://localhost/", "not-public"],
    ["a single-label host", "https://intranet/", "not-public"],
    ["an internal suffix", "https://db.internal/", "not-public"],
    ["blank input", "   ", "blank"],
  ])("%s is rejected as invalid-url before any resolution", async (_label, input, detail) => {
    const resolver = fakeResolver(publicZone("example.com"));
    const spy = vi.spyOn(resolver, "resolve4");
    const result = await admitCaptureTarget(input, {
      resolver,
      dnsTimeoutMs: 50,
    });
    expect(result).toEqual({
      ok: false,
      outcome: "invalid-url",
      reason: { kind: "url", detail },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  test("canonicalization runs before the literal check, not after", async () => {
    // The submitted text is not a dotted quad; only WHATWG canonicalization
    // turns it into 127.0.0.1, so a check applied to the raw text would let
    // it through.
    const raw = "https://2130706433/";
    expect(new URL(raw).hostname).toBe("127.0.0.1");
    const result = await admitCaptureTarget(raw, deps({}));
    expect(result).toMatchObject({ outcome: "invalid-url" });
  });

  test("a host that resolves to a private address is rejected", async () => {
    const result = await admitCaptureTarget(
      "https://rebind.example/",
      deps({ a: { "rebind.example": ["10.0.0.5"] } }),
    );
    expect(result).toEqual({
      ok: false,
      outcome: "dns-failed",
      reason: { kind: "dns", detail: "non-public" },
    });
  });

  test("one non-public answer among public ones rejects the whole host", async () => {
    const result = await admitCaptureTarget(
      "https://mixed.example/",
      deps({
        a: { "mixed.example": ["93.184.216.34", "169.254.169.254"] },
        aaaa: { "mixed.example": ["2606:4700:4700::1111"] },
      }),
    );
    expect(result).toMatchObject({ outcome: "dns-failed", reason: { detail: "non-public" } });
  });

  test("a private AAAA answer rejects a host with a public A answer", async () => {
    const result = await admitCaptureTarget(
      "https://dual.example/",
      deps({
        a: { "dual.example": ["93.184.216.34"] },
        aaaa: { "dual.example": ["fd00::1"] },
      }),
    );
    expect(result).toMatchObject({ outcome: "dns-failed", reason: { detail: "non-public" } });
  });

  test("a rejection never discloses the resolved address", async () => {
    const result = await admitCaptureTarget(
      "https://rebind.example/",
      deps({ a: { "rebind.example": ["169.254.169.254"] } }),
    );
    expect(JSON.stringify(result)).not.toContain("169.254");
  });
});

describe("bounded DNS resolution", () => {
  const resolve = (zone: FakeZone, host = "site.example") =>
    resolveHostPublicly(host, fakeResolver(zone), { timeoutMs: 50 });

  test("a CNAME chain is followed to its public terminal name", async () => {
    const result = await resolve({
      cname: { "site.example": ["edge.cdn.example"], "edge.cdn.example": ["pop.cdn.example"] },
      a: { "pop.cdn.example": ["93.184.216.34"] },
    });
    expect(result).toEqual({ ok: true, addressCount: 1 });
  });

  test("a CNAME chain ending on a private address is rejected", async () => {
    const result = await resolve({
      cname: { "site.example": ["internal.cdn.example"] },
      a: { "internal.cdn.example": ["192.168.1.10"] },
    });
    expect(result).toEqual({ ok: false, reason: "non-public" });
  });

  test("a CNAME loop is rejected rather than followed", async () => {
    const result = await resolve({
      cname: { "site.example": ["b.example"], "b.example": ["site.example"] },
    });
    expect(result).toEqual({ ok: false, reason: "cname-loop" });
  });

  test("a chain longer than the published hop cap is rejected", async () => {
    const cname: Record<string, string[]> = { "site.example": ["hop0.example"] };
    for (let i = 0; i < MAX_CNAME_HOPS + 2; i += 1) {
      cname[`hop${i}.example`] = [`hop${i + 1}.example`];
    }
    const result = await resolve({ cname });
    expect(result).toEqual({ ok: false, reason: "cname-hops" });
  });

  test("a chain exactly at the hop cap still resolves", async () => {
    const cname: Record<string, string[]> = {};
    let name = "site.example";
    for (let i = 0; i < MAX_CNAME_HOPS; i += 1) {
      cname[name] = [`hop${i}.example`];
      name = `hop${i}.example`;
    }
    const result = await resolve({ cname, a: { [name]: ["93.184.216.34"] } });
    expect(result).toEqual({ ok: true, addressCount: 1 });
  });

  test("a host with two CNAMEs is refused as unresolvable", async () => {
    const result = await resolve({
      cname: { "site.example": ["a.example", "b.example"] },
      a: { "a.example": ["93.184.216.34"], "b.example": ["93.184.216.34"] },
    });
    expect(result).toEqual({ ok: false, reason: "unresolved" });
  });

  test("a query that never settles fails closed on the published budget", async () => {
    const result = await resolve({ hangs: ["site.example"] });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  test("a hanging AAAA query fails the host even when A answered publicly", async () => {
    const result = await resolve({
      a: { "site.example": ["93.184.216.34"] },
      hangs: ["site.example"],
    });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  test("an ambiguous AAAA failure fails closed even when A answered publicly", async () => {
    const result = await resolve({
      a: { "site.example": ["93.184.216.34"] },
      servfail: { aaaa: ["site.example"] },
    });
    expect(result).toEqual({ ok: false, reason: "unresolved" });
  });

  test("a definitive empty AAAA answer does not block a public A answer", async () => {
    const result = await resolve({ a: { "site.example": ["93.184.216.34"] } });
    expect(result).toEqual({ ok: true, addressCount: 1 });
  });

  test("a host with no records at all is rejected", async () => {
    const result = await resolve({});
    expect(result).toEqual({ ok: false, reason: "unresolved" });
  });

  test("an answer that does not parse as an address is rejected", async () => {
    const result = await resolve({ a: { "site.example": ["not-an-address"] } });
    expect(result).toEqual({ ok: false, reason: "non-public" });
  });
});

describe("redirect hop revalidation", () => {
  test("a public-to-public chain completes and reports the final URL", async () => {
    const result = await admitCaptureTarget(
      "https://start.example/",
      deps(
        publicZone("start.example", "www.start.example", "final.example"),
        chainProbe({
          "https://start.example/": "https://www.start.example/",
          "https://www.start.example/": "https://final.example/home",
        }),
      ),
    );
    expect(result).toEqual({
      ok: true,
      target: {
        requestedUrl: "https://start.example/",
        finalUrl: "https://final.example/home",
        hops: 2,
      },
    });
  });

  test("a relative Location is resolved against the hop that sent it", async () => {
    const result = await admitCaptureTarget(
      "https://start.example/a/b",
      deps(
        publicZone("start.example"),
        chainProbe({ "https://start.example/a/b": "/pricing" }),
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      target: { finalUrl: "https://start.example/pricing", hops: 1 },
    });
  });

  test.each([
    ["HTTP", "http://start.example/"],
    ["credentials", "https://user:pass@start.example/"],
    ["a literal IP", "https://93.184.216.34/"],
    ["a metadata literal", "http://169.254.169.254/latest/meta-data/"],
    ["a non-443 port", "https://start.example:8443/"],
    ["localhost", "https://localhost/admin"],
    ["a file URL", "file:///etc/passwd"],
  ])("a hop to %s fails as unsafe-redirect", async (_label, location) => {
    const result = await admitCaptureTarget(
      "https://start.example/",
      deps(
        publicZone("start.example"),
        chainProbe({ "https://start.example/": location }),
      ),
    );
    expect(result).toMatchObject({ ok: false, outcome: "unsafe-redirect" });
  });

  test("a hop to a host that resolves privately fails as unsafe-redirect", async () => {
    const result = await admitCaptureTarget(
      "https://start.example/",
      deps(
        {
          a: { "start.example": ["93.184.216.34"], "inside.example": ["10.1.2.3"] },
        },
        chainProbe({ "https://start.example/": "https://inside.example/" }),
      ),
    );
    expect(result).toEqual({
      ok: false,
      outcome: "unsafe-redirect",
      reason: { kind: "dns", detail: "non-public" },
    });
  });

  test("an unsafe hop never discloses the private address it resolved to", async () => {
    const result = await admitCaptureTarget(
      "https://start.example/",
      deps(
        { a: { "start.example": ["93.184.216.34"], "inside.example": ["169.254.169.254"] } },
        chainProbe({ "https://start.example/": "https://inside.example/" }),
      ),
    );
    expect(JSON.stringify(result)).not.toContain("169.254");
  });

  test("a chain longer than the published hop cap is refused", async () => {
    const chain: Record<string, string> = {};
    const hosts: string[] = [];
    for (let i = 0; i <= MAX_REDIRECT_HOPS + 1; i += 1) {
      chain[`https://hop${i}.example/`] = `https://hop${i + 1}.example/`;
      hosts.push(`hop${i}.example`, `hop${i + 1}.example`);
    }
    const result = await admitCaptureTarget(
      "https://hop0.example/",
      deps(publicZone(...hosts), chainProbe(chain)),
    );
    expect(result).toEqual({
      ok: false,
      outcome: "unsafe-redirect",
      reason: { kind: "redirect", detail: "hop-cap" },
    });
  });

  test("a chain exactly at the published hop cap still completes", async () => {
    const chain: Record<string, string> = {};
    const hosts: string[] = ["hop0.example"];
    for (let i = 0; i < MAX_REDIRECT_HOPS; i += 1) {
      chain[`https://hop${i}.example/`] = `https://hop${i + 1}.example/`;
      hosts.push(`hop${i + 1}.example`);
    }
    const result = await admitCaptureTarget(
      "https://hop0.example/",
      deps(publicZone(...hosts), chainProbe(chain)),
    );
    expect(result).toMatchObject({
      ok: true,
      target: { finalUrl: `https://hop${MAX_REDIRECT_HOPS}.example/`, hops: MAX_REDIRECT_HOPS },
    });
  });

  test("a redirect without a Location header is refused", async () => {
    const result = await admitCaptureTarget(
      "https://start.example/",
      deps(publicZone("start.example"), () =>
        Promise.resolve({ status: 301, location: null }),
      ),
    );
    expect(result).toMatchObject({
      ok: false,
      outcome: "unsafe-redirect",
      reason: { kind: "redirect", detail: "missing-location" },
    });
  });

  test("a probe that throws is a bounded failure, not an exception", async () => {
    const result = await admitCaptureTarget(
      "https://start.example/",
      deps(publicZone("start.example"), () => Promise.reject(new Error("connection reset"))),
    );
    expect(result).toMatchObject({
      ok: false,
      outcome: "unsafe-redirect",
      reason: { kind: "redirect", detail: "unreadable" },
    });
  });

  test("no hop is probed once the initial target is rejected", async () => {
    const probe = vi.fn<RedirectProbe>();
    const result = await admitCaptureTarget("http://example.com/", deps({}, probe));
    expect(result).toMatchObject({ outcome: "invalid-url" });
    expect(probe).not.toHaveBeenCalled();
  });

  test("every hop after an unsafe one is left unprobed", async () => {
    const probe = vi.fn<RedirectProbe>(
      chainProbe({
        "https://start.example/": "https://localhost/",
        "https://localhost/": "https://start.example/",
      }),
    );
    await admitCaptureTarget("https://start.example/", deps(publicZone("start.example"), probe));
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
