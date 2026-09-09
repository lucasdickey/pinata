// The public-HTTPS admission boundary for capture (VAL-CAPTURE-001,
// VAL-CAPTURE-002).
//
// Order matters and is the whole point: canonicalize once with WHATWG `URL`,
// reject unsafe syntax and every IP spelling, resolve DNS under a bounded
// budget, and only then walk the redirect chain — applying the identical
// policy to every hop. Nothing here calls the capture provider, so a target
// that fails admission never produces a provider job, an image, or a
// manifest.
//
// The server-side chain walk is the first of two defences. It gives a bounded
// pre-provider verdict and the final URL to persist, but it cannot see what
// the remote browser resolves; the in-function request guard in `guard.ts`
// covers that side.

import { MAX_REDIRECT_HOPS, REDIRECT_PROBE_TIMEOUT_MS, type UrlRejectReason } from "../../boundaries";
import { normalizeProjectUrl } from "../../url/normalize";
import { resolveHostPublicly, type DnsFailureReason, type DnsResolver } from "./dns";

/** One top-level response, reduced to what the boundary needs. */
export interface RedirectProbeResult {
  status: number;
  /** The raw `Location` header, or null when the response is not a redirect. */
  location: string | null;
}

/** Fetches one URL without following redirects. Injectable for focused tests. */
export type RedirectProbe = (url: string) => Promise<RedirectProbeResult>;

export interface AdmissionDeps {
  resolver: DnsResolver;
  /** Omitted when the caller only needs initial-target admission. */
  probe?: RedirectProbe;
  dnsTimeoutMs?: number;
}

/** The three capture outcomes this boundary can produce. */
export type AdmissionOutcome = "invalid-url" | "dns-failed" | "unsafe-redirect";

export type AdmissionRejectionReason =
  | { kind: "url"; detail: UrlRejectReason }
  | { kind: "dns"; detail: DnsFailureReason }
  | { kind: "redirect"; detail: "hop-cap" | "unreadable" | "missing-location" };

export interface AdmittedTarget {
  /** The canonical form of what was submitted. */
  requestedUrl: string;
  /** Where the chain ended; equal to `requestedUrl` when there is no redirect. */
  finalUrl: string;
  /** Top-level redirect hops followed, always at or under the published cap. */
  hops: number;
}

export type AdmissionResult =
  | { ok: true; target: AdmittedTarget }
  | { ok: false; outcome: AdmissionOutcome; reason: AdmissionRejectionReason };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Apply the syntactic and DNS policy to one absolute or relative URL,
 * resolved against `base` when relative.
 */
async function admitUrl(
  input: string,
  base: string | null,
  deps: AdmissionDeps,
): Promise<
  | { ok: true; url: string }
  | { ok: false; reason: AdmissionRejectionReason }
> {
  let absolute = input;
  if (base !== null) {
    try {
      absolute = new URL(input, base).href;
    } catch {
      return { ok: false, reason: { kind: "url", detail: "malformed" } };
    }
  }

  const normalized = normalizeProjectUrl(absolute);
  if (!normalized.ok) return { ok: false, reason: { kind: "url", detail: normalized.reason } };

  const hostname = new URL(normalized.url).hostname;
  const resolution = await resolveHostPublicly(hostname, deps.resolver, {
    ...(deps.dnsTimeoutMs === undefined ? {} : { timeoutMs: deps.dnsTimeoutMs }),
  });
  if (!resolution.ok) return { ok: false, reason: { kind: "dns", detail: resolution.reason } };
  return { ok: true, url: normalized.url };
}

/**
 * Admit one capture target: canonicalize, check the initial destination, then
 * revalidate every top-level redirect hop under the same rules. A rejection
 * names the stage that refused it and never echoes a resolved address.
 */
export async function admitCaptureTarget(
  input: string,
  deps: AdmissionDeps,
): Promise<AdmissionResult> {
  const initial = await admitUrl(input, null, deps);
  if (!initial.ok) {
    const outcome: AdmissionOutcome = initial.reason.kind === "dns" ? "dns-failed" : "invalid-url";
    return { ok: false, outcome, reason: initial.reason };
  }

  if (!deps.probe) return { ok: true, target: { requestedUrl: initial.url, finalUrl: initial.url, hops: 0 } };

  let current = initial.url;
  for (let hops = 0; hops <= MAX_REDIRECT_HOPS; hops += 1) {
    let response: RedirectProbeResult;
    try {
      response = await deps.probe(current);
    } catch {
      return {
        ok: false,
        outcome: "unsafe-redirect",
        reason: { kind: "redirect", detail: "unreadable" },
      };
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { ok: true, target: { requestedUrl: initial.url, finalUrl: current, hops } };
    }
    if (hops === MAX_REDIRECT_HOPS) {
      return {
        ok: false,
        outcome: "unsafe-redirect",
        reason: { kind: "redirect", detail: "hop-cap" },
      };
    }
    if (!response.location) {
      return {
        ok: false,
        outcome: "unsafe-redirect",
        reason: { kind: "redirect", detail: "missing-location" },
      };
    }

    const next = await admitUrl(response.location, current, deps);
    // A hop that fails any part of the policy is one failure — an unsafe
    // redirect — whatever the underlying reason, so the caller cannot use the
    // outcome code to distinguish a private DNS answer from a bad scheme.
    if (!next.ok) {
      return { ok: false, outcome: "unsafe-redirect", reason: next.reason };
    }
    current = next.url;
  }

  return {
    ok: false,
    outcome: "unsafe-redirect",
    reason: { kind: "redirect", detail: "hop-cap" },
  };
}

/**
 * The real redirect probe. It reads only the status and `Location` header and
 * discards the body, so no target content enters the application.
 */
export function createRedirectProbe(
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = REDIRECT_PROBE_TIMEOUT_MS,
): RedirectProbe {
  return async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "text/html,*/*;q=0.1" },
      });
      await response.body?.cancel();
      return { status: response.status, location: response.headers.get("location") };
    } finally {
      clearTimeout(timer);
    }
  };
}
