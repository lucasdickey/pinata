// Remote-network admission policy for capture (VAL-CAPTURE-001/002): the
// bounded DNS budget and the enumerated set of address ranges a capture
// target may never resolve to.
//
// The CIDR list below is the executable policy, not documentation: the
// address classifier matches resolved answers against these prefixes, and
// the Browserless in-function request guard is generated from the same
// array, so there is exactly one place to change a range.

/** Per-query DNS budget. A query that outlives it fails the capture closed. */
export const DNS_TIMEOUT_MS = 3_000;

/** CNAME hops followed before a chain is rejected as unresolvable. */
export const MAX_CNAME_HOPS = 8;

/** Per-hop budget for the server-side redirect preflight. */
export const REDIRECT_PROBE_TIMEOUT_MS = 5_000;

export interface AddressRangePolicy {
  /** CIDR prefix in canonical notation. */
  cidr: string;
  /** Why this range can never be a capture destination. */
  label: string;
}

/**
 * Every IPv4 and IPv6 prefix that is not a public capture destination:
 * loopback, private, carrier-grade NAT, link-local (including the cloud
 * metadata address), multicast, benchmarking, documentation, and reserved
 * space, plus the IPv6 transition prefixes that can carry an embedded
 * non-public IPv4 address.
 */
export const NON_PUBLIC_ADDRESS_RANGES: readonly AddressRangePolicy[] = Object.freeze([
  { cidr: "0.0.0.0/8", label: "this network" },
  { cidr: "10.0.0.0/8", label: "private" },
  { cidr: "100.64.0.0/10", label: "carrier-grade NAT" },
  { cidr: "127.0.0.0/8", label: "loopback" },
  { cidr: "169.254.0.0/16", label: "link-local and cloud metadata" },
  { cidr: "172.16.0.0/12", label: "private" },
  { cidr: "192.0.0.0/24", label: "IETF protocol assignments" },
  { cidr: "192.0.2.0/24", label: "documentation (TEST-NET-1)" },
  { cidr: "192.88.99.0/24", label: "6to4 relay anycast" },
  { cidr: "192.168.0.0/16", label: "private" },
  { cidr: "198.18.0.0/15", label: "benchmarking" },
  { cidr: "198.51.100.0/24", label: "documentation (TEST-NET-2)" },
  { cidr: "203.0.113.0/24", label: "documentation (TEST-NET-3)" },
  { cidr: "224.0.0.0/4", label: "multicast" },
  { cidr: "240.0.0.0/4", label: "reserved and broadcast" },
  { cidr: "::/96", label: "unspecified and IPv4-compatible" },
  { cidr: "::ffff:0:0/96", label: "IPv4-mapped" },
  { cidr: "64:ff9b::/96", label: "NAT64" },
  { cidr: "64:ff9b:1::/48", label: "local-use NAT64" },
  { cidr: "100::/64", label: "discard-only" },
  { cidr: "2001::/32", label: "Teredo" },
  { cidr: "2001:2::/48", label: "benchmarking" },
  { cidr: "2001:db8::/32", label: "documentation" },
  { cidr: "2002::/16", label: "6to4" },
  { cidr: "fc00::/7", label: "unique-local" },
  { cidr: "fe80::/10", label: "link-local" },
  { cidr: "ff00::/8", label: "multicast" },
]);
