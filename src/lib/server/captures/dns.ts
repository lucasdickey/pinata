// Bounded, fail-closed DNS validation for capture targets (VAL-CAPTURE-001).
//
// The rule is deliberately strict: follow a bounded CNAME chain, ask for both
// A and AAAA, and admit the host only when every answer parses and every
// answer is public. A timeout, a server failure, an empty result, a loop, or
// a single non-public answer rejects the host, because a target that resolves
// differently for us than for the browser is exactly the case this boundary
// exists to refuse.
//
// Results never carry the resolved addresses. Disclosing them would turn a
// rejection into an internal-network oracle.

import { DNS_TIMEOUT_MS, MAX_CNAME_HOPS } from "../../boundaries";
import { isPublicAddress } from "../../net/address";

/** The three queries the boundary needs, injectable for focused tests. */
export interface DnsResolver {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

export type DnsFailureReason =
  | "timeout"
  | "unresolved"
  | "cname-loop"
  | "cname-hops"
  | "non-public";

export type HostResolution =
  | { ok: true; addressCount: number }
  | { ok: false; reason: DnsFailureReason };

export interface ResolveOptions {
  /** Per-query budget; defaults to the published DNS timeout. */
  timeoutMs?: number;
}

/** Node's `dns` reports "this name has no record of that type" with these. */
const DEFINITIVE_EMPTY = new Set(["ENODATA", "ENOTFOUND", "NOTFOUND"]);

const TIMEOUT = Symbol("dns-timeout");

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type QueryOutcome =
  | { kind: "answers"; values: string[] }
  /** The name definitively has no record of this type. */
  | { kind: "empty" }
  | { kind: "timeout" }
  /** SERVFAIL, REFUSED, or anything else we cannot interpret as an answer. */
  | { kind: "ambiguous" };

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
}

async function query(
  run: () => Promise<string[]>,
  timeoutMs: number,
): Promise<QueryOutcome> {
  let result: string[] | typeof TIMEOUT;
  try {
    result = await withTimeout(run(), timeoutMs);
  } catch (error) {
    return DEFINITIVE_EMPTY.has(errorCode(error))
      ? { kind: "empty" }
      : { kind: "ambiguous" };
  }
  if (result === TIMEOUT) return { kind: "timeout" };
  return result.length === 0 ? { kind: "empty" } : { kind: "answers", values: result };
}

function canonicalName(name: string): string {
  const lowered = name.trim().toLowerCase();
  return lowered.endsWith(".") ? lowered.slice(0, -1) : lowered;
}

/**
 * Resolve one hostname and decide whether it is a public capture
 * destination. Returns only how many answers were checked, never which.
 */
export async function resolveHostPublicly(
  hostname: string,
  resolver: DnsResolver,
  options: ResolveOptions = {},
): Promise<HostResolution> {
  const timeoutMs = options.timeoutMs ?? DNS_TIMEOUT_MS;
  const seen = new Set<string>();
  let name = canonicalName(hostname);

  for (let hop = 0; ; hop += 1) {
    if (seen.has(name)) return { ok: false, reason: "cname-loop" };
    seen.add(name);

    const cname = await query(() => resolver.resolveCname(name), timeoutMs);
    if (cname.kind === "timeout") return { ok: false, reason: "timeout" };
    // A CNAME lookup that neither answers nor definitively denies leaves the
    // rest of the chain unknown, so it cannot be treated as a terminal name.
    if (cname.kind === "ambiguous") return { ok: false, reason: "unresolved" };
    if (cname.kind === "empty") break;
    // A name with more than one CNAME is malformed; which alias the browser
    // would follow is unknowable, so neither is admitted.
    if (cname.values.length !== 1) return { ok: false, reason: "unresolved" };
    if (hop + 1 > MAX_CNAME_HOPS) return { ok: false, reason: "cname-hops" };
    name = canonicalName(cname.values[0]!);
    if (name === "") return { ok: false, reason: "unresolved" };
  }

  const [a, aaaa] = await Promise.all([
    query(() => resolver.resolve4(name), timeoutMs),
    query(() => resolver.resolve6(name), timeoutMs),
  ]);
  if (a.kind === "timeout" || aaaa.kind === "timeout") return { ok: false, reason: "timeout" };
  // One family answering does not license ignoring an unreadable answer from
  // the other: the browser may prefer the family we could not check.
  if (a.kind === "ambiguous" || aaaa.kind === "ambiguous") {
    return { ok: false, reason: "unresolved" };
  }

  const addresses = [
    ...(a.kind === "answers" ? a.values : []),
    ...(aaaa.kind === "answers" ? aaaa.values : []),
  ];
  if (addresses.length === 0) return { ok: false, reason: "unresolved" };
  if (addresses.some((address) => !isPublicAddress(address))) {
    return { ok: false, reason: "non-public" };
  }
  return { ok: true, addressCount: addresses.length };
}

/** The real resolver, backed by Node's DNS client. */
export function createNodeDnsResolver(): DnsResolver {
  return {
    async resolveCname(hostname) {
      const { Resolver } = await import("node:dns/promises");
      return new Resolver().resolveCname(hostname);
    },
    async resolve4(hostname) {
      const { Resolver } = await import("node:dns/promises");
      return new Resolver().resolve4(hostname);
    },
    async resolve6(hostname) {
      const { Resolver } = await import("node:dns/promises");
      return new Resolver().resolve6(hostname);
    },
  };
}
