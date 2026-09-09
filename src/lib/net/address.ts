// Pure IP-address classification against the published non-public range
// catalog (VAL-CAPTURE-001).
//
// Every check is a prefix match over parsed bytes rather than a string
// comparison, so noncanonical spellings (compressed IPv6, embedded IPv4,
// leading zeros) cannot spell their way past a range. Nothing here performs
// I/O or reports the address it was given: callers must not disclose
// resolved addresses.

import { NON_PUBLIC_ADDRESS_RANGES } from "../boundaries";

export type IpFamily = "ipv4" | "ipv6";

export interface ParsedIpAddress {
  family: IpFamily;
  /** 4 bytes for IPv4, 16 for IPv6. */
  bytes: Uint8Array;
}

const IPV4_GROUP = /^(0|[1-9]\d{0,2})$/;

/**
 * Parse dotted-quad IPv4. Only the canonical spelling is accepted here;
 * alternative spellings (decimal, octal, hex) are canonicalized by WHATWG
 * `URL` before any address ever reaches this module.
 */
function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    const part = parts[i]!;
    if (!IPV4_GROUP.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[i] = value;
  }
  return bytes;
}

function parseIpv6(text: string): Uint8Array | null {
  if (text.includes(":::")) return null;
  const zone = text.indexOf("%");
  // A scoped literal (fe80::1%eth0) is never a capture destination; refusing
  // to parse it keeps it out of the "unclassifiable" path as well.
  if (zone >= 0) return null;

  let head = text;
  let tail = "";
  const doubleColon = text.indexOf("::");
  if (doubleColon >= 0) {
    if (text.indexOf("::", doubleColon + 1) >= 0) return null;
    head = text.slice(0, doubleColon);
    tail = text.slice(doubleColon + 2);
  }

  const split = (segment: string): string[] => (segment === "" ? [] : segment.split(":"));
  const headGroups = split(head);
  const tailGroups = split(tail);

  // A trailing dotted-quad (::ffff:127.0.0.1) occupies the last two groups.
  const last = tailGroups.length > 0 ? tailGroups[tailGroups.length - 1]! : headGroups[headGroups.length - 1];
  let embedded: Uint8Array | null = null;
  if (last !== undefined && last.includes(".")) {
    embedded = parseIpv4(last);
    if (!embedded) return null;
    if (tailGroups.length > 0) tailGroups.pop();
    else headGroups.pop();
  }

  const groupCount = headGroups.length + tailGroups.length + (embedded ? 2 : 0);
  if (doubleColon < 0 ? groupCount !== 8 : groupCount > 7) return null;

  const bytes = new Uint8Array(16);
  let offset = 0;
  const writeGroup = (group: string): boolean => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return false;
    const value = Number.parseInt(group, 16);
    bytes[offset] = value >> 8;
    bytes[offset + 1] = value & 0xff;
    offset += 2;
    return true;
  };
  for (const group of headGroups) if (!writeGroup(group)) return null;
  offset = 16 - (tailGroups.length * 2 + (embedded ? 4 : 0));
  for (const group of tailGroups) if (!writeGroup(group)) return null;
  if (embedded) bytes.set(embedded, 12);
  return bytes;
}

/** Parse an IPv4 or IPv6 address, with or without surrounding brackets. */
export function parseIpAddress(text: string): ParsedIpAddress | null {
  const trimmed = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  if (trimmed === "") return null;
  if (trimmed.includes(":")) {
    const bytes = parseIpv6(trimmed);
    return bytes ? { family: "ipv6", bytes } : null;
  }
  const bytes = parseIpv4(trimmed);
  return bytes ? { family: "ipv4", bytes } : null;
}

interface CompiledRange {
  family: IpFamily;
  bytes: Uint8Array;
  prefixBits: number;
  label: string;
}

function compileRange(policy: { cidr: string; label: string }): CompiledRange {
  const slash = policy.cidr.lastIndexOf("/");
  const address = policy.cidr.slice(0, slash);
  const prefixBits = Number(policy.cidr.slice(slash + 1));
  const parsed = parseIpAddress(address);
  if (!parsed || !Number.isInteger(prefixBits)) {
    throw new Error(`Unparseable address range in the boundary catalog: ${policy.cidr}`);
  }
  return { family: parsed.family, bytes: parsed.bytes, prefixBits, label: policy.label };
}

const COMPILED_RANGES: readonly CompiledRange[] = NON_PUBLIC_ADDRESS_RANGES.map(compileRange);

function withinPrefix(address: Uint8Array, range: CompiledRange): boolean {
  const wholeBytes = range.prefixBits >> 3;
  for (let i = 0; i < wholeBytes; i += 1) {
    if (address[i] !== range.bytes[i]) return false;
  }
  const remainder = range.prefixBits & 7;
  if (remainder === 0) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (address[wholeBytes]! & mask) === (range.bytes[wholeBytes]! & mask);
}

export type AddressClassification =
  | { public: true }
  /** `label` names the matched range, or null when the text is not an address. */
  | { public: false; label: string | null };

/**
 * Classify one address literal. Anything that does not parse is treated as
 * non-public: an answer we cannot understand is never proof of safety.
 */
export function classifyAddress(text: string): AddressClassification {
  const parsed = parseIpAddress(text);
  if (!parsed) return { public: false, label: null };
  for (const range of COMPILED_RANGES) {
    if (range.family !== parsed.family) continue;
    if (withinPrefix(parsed.bytes, range)) return { public: false, label: range.label };
  }
  return { public: true };
}

/** True only for an address that parses and matches no non-public range. */
export function isPublicAddress(text: string): boolean {
  return classifyAddress(text).public;
}
