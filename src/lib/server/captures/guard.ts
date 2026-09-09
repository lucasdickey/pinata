// The Browserless in-function request guard (VAL-CAPTURE-002).
//
// Browserless runs in a different network from this application, so the
// server-side DNS and redirect checks in `admission.ts` prove nothing about
// what the remote browser resolves a moment later. This guard is the second
// defence: it runs inside the provider's function, revalidates every
// top-level navigation, and aborts subresource requests aimed at
// destinations that can never be public.
//
// It is emitted as JavaScript source rather than imported, because it
// executes in the provider's sandbox. It therefore restates the host policy
// instead of importing it — and deliberately refuses *every* IP-literal host
// rather than range-checking inside the sandbox, so there is no address
// arithmetic to keep in sync. That is strictly stricter than the
// application-side range catalog, which applies to resolved DNS answers where
// literals are unavoidable. `test/server/capture-guard.test.ts` evaluates this
// exact source and cross-checks it against the shared catalog.
//
// The guard never disables web security, TLS validation, sandboxing, or the
// provider's own private-network blocklist; it only adds refusals.

/** Host suffixes that can never name a public destination. */
const RESERVED_HOST_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "intranet",
  "home.arpa",
  "invalid",
  "test",
  "onion",
];

/** Schemes a subresource may use; anything else is aborted. */
const ALLOWED_SUBRESOURCE_SCHEMES = ["https:", "http:", "wss:", "ws:"];

/** Inert schemes that carry no network destination and are always allowed. */
const INERT_SCHEMES = ["data:", "blob:", "about:"];

/**
 * Source defining `__pinataGuard`, with `checkNavigation(url)` and
 * `checkSubresource(url)` returning null to allow or a bounded reason string
 * to abort. The catalogs above are the only interpolated values: no capture
 * target, credential, or caller-supplied string is ever embedded here.
 */
export const REQUEST_GUARD_SOURCE = `
const __pinataGuard = (() => {
  const RESERVED = ${JSON.stringify(RESERVED_HOST_SUFFIXES)};
  const SUBRESOURCE_SCHEMES = ${JSON.stringify(ALLOWED_SUBRESOURCE_SCHEMES)};
  const INERT = ${JSON.stringify(INERT_SCHEMES)};
  const IPV4 = /^\\d{1,3}(?:\\.\\d{1,3}){3}$/;

  const parse = (raw) => {
    try {
      return new URL(raw);
    } catch {
      return null;
    }
  };

  // WHATWG canonicalizes every accepted IPv4 spelling to dotted-quad and
  // brackets every IPv6 host, so these two shapes cover the literal space.
  const isIpLiteral = (host) => host.startsWith("[") || IPV4.test(host);

  const isReserved = (host) => {
    const name = host.endsWith(".") ? host.slice(0, -1) : host;
    if (!name.includes(".")) return true;
    return RESERVED.some((s) => name === s || name.endsWith("." + s));
  };

  const hostVerdict = (url) => {
    if (url.username !== "" || url.password !== "") return "credentials";
    if (isIpLiteral(url.hostname)) return "ip-literal";
    if (isReserved(url.hostname)) return "reserved-host";
    return null;
  };

  const checkNavigation = (raw) => {
    const url = parse(raw);
    if (!url) return "malformed";
    if (url.protocol !== "https:") return "scheme";
    if (url.port !== "") return "port";
    return hostVerdict(url);
  };

  const checkSubresource = (raw) => {
    const url = parse(raw);
    if (!url) return "malformed";
    if (INERT.includes(url.protocol)) return null;
    if (!SUBRESOURCE_SCHEMES.includes(url.protocol)) return "scheme";
    return hostVerdict(url);
  };

  return { checkNavigation, checkSubresource };
})();
`;

/**
 * Source that installs the guard on a Puppeteer `page` and records what it
 * refused in `__pinataBlocked`. Requires REQUEST_GUARD_SOURCE earlier in the
 * same function body.
 */
export const REQUEST_GUARD_INSTALL_SOURCE = `
const __pinataBlocked = [];
const __pinataInstallGuard = async (page) => {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    const topLevel = request.isNavigationRequest() && request.frame() === page.mainFrame();
    const reason = topLevel
      ? __pinataGuard.checkNavigation(url)
      : __pinataGuard.checkSubresource(url);
    if (reason === null) {
      request.continue().catch(() => {});
      return;
    }
    // The refused URL is never recorded: a blocked probe must not be able to
    // write its own target into the manifest or the warnings.
    __pinataBlocked.push({ topLevel, reason });
    request.abort("blockedbyclient").catch(() => {});
  });
};
`;

/** Both fragments, in the order a capture function must include them. */
export function buildRequestGuardSource(): string {
  return `${REQUEST_GUARD_SOURCE}\n${REQUEST_GUARD_INSTALL_SOURCE}`;
}
