// Address-range fixtures for the capture admission boundary
// (VAL-CAPTURE-001). Every resolved DNS answer is classified by this module,
// so the table below is the executable statement of which destinations a
// capture may never reach.

import { describe, expect, test } from "vitest";
import { NON_PUBLIC_ADDRESS_RANGES } from "../src/lib/boundaries";
import { classifyAddress, isPublicAddress, parseIpAddress } from "../src/lib/net/address";

describe("IP parsing", () => {
  test.each([
    ["dotted quad", "8.8.8.8", "ipv4", [8, 8, 8, 8]],
    ["all zeroes", "0.0.0.0", "ipv4", [0, 0, 0, 0]],
    ["broadcast", "255.255.255.255", "ipv4", [255, 255, 255, 255]],
  ])("%s parses as IPv4", (_label, text, family, bytes) => {
    const parsed = parseIpAddress(text);
    expect(parsed?.family).toBe(family);
    expect([...(parsed?.bytes ?? [])]).toEqual(bytes);
  });

  test("compressed, expanded, and IPv4-embedded IPv6 spellings agree", () => {
    const expanded = parseIpAddress("0000:0000:0000:0000:0000:ffff:7f00:0001");
    const compressed = parseIpAddress("::ffff:7f00:1");
    const embedded = parseIpAddress("::ffff:127.0.0.1");
    const bracketed = parseIpAddress("[::ffff:127.0.0.1]");
    expect(expanded?.bytes).toEqual(compressed?.bytes);
    expect(embedded?.bytes).toEqual(compressed?.bytes);
    expect(bracketed?.bytes).toEqual(compressed?.bytes);
  });

  test.each([
    ["empty", ""],
    ["a hostname", "example.com"],
    ["a three-part IPv4", "127.0.1"],
    ["an out-of-range octet", "999.0.0.1"],
    ["a leading-zero octet", "010.0.0.1"],
    ["two compressions", "1::2::3"],
    ["too many groups", "1:2:3:4:5:6:7:8:9"],
    ["too few groups without compression", "1:2:3:4:5:6:7"],
    ["a scoped literal", "fe80::1%eth0"],
    ["a non-hex group", "1:2:3:4:5:6:7:zzzz"],
  ])("%s does not parse", (_label, text) => {
    expect(parseIpAddress(text)).toBeNull();
  });
});

describe("non-public address ranges", () => {
  test.each([
    ["Cloudflare DNS", "1.1.1.1"],
    ["Google DNS", "8.8.8.8"],
    ["a public IPv4", "93.184.216.34"],
    ["a public IPv6", "2606:4700:4700::1111"],
    ["a public IPv6 in another block", "2a00:1450:4001:80f::200e"],
  ])("%s is public", (_label, text) => {
    expect(isPublicAddress(text), text).toBe(true);
  });

  test.each([
    ["this network", "0.0.0.0"],
    ["private class A", "10.0.0.5"],
    ["private class A upper", "10.255.255.255"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["carrier-grade NAT upper", "100.127.255.254"],
    ["loopback", "127.0.0.1"],
    ["loopback alias", "127.1.2.3"],
    ["link-local", "169.254.1.1"],
    ["cloud metadata", "169.254.169.254"],
    ["private class B", "172.16.0.1"],
    ["private class B upper", "172.31.255.254"],
    ["IETF protocol assignments", "192.0.0.192"],
    ["documentation TEST-NET-1", "192.0.2.5"],
    ["6to4 relay anycast", "192.88.99.1"],
    ["private class C", "192.168.1.1"],
    ["benchmarking", "198.19.0.1"],
    ["documentation TEST-NET-2", "198.51.100.5"],
    ["documentation TEST-NET-3", "203.0.113.5"],
    ["multicast", "224.0.0.1"],
    ["reserved", "240.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["IPv6 unspecified", "::"],
    ["IPv6 loopback", "::1"],
    ["IPv4-compatible IPv6", "::93.184.216.34"],
    ["IPv4-mapped public IPv4", "::ffff:8.8.8.8"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["NAT64", "64:ff9b::7f00:1"],
    ["local-use NAT64", "64:ff9b:1::1"],
    ["discard-only", "100::1"],
    ["Teredo", "2001:0:1:2:3:4:5:6"],
    ["IPv6 benchmarking", "2001:2:0:1::1"],
    ["IPv6 documentation", "2001:db8::1"],
    ["6to4", "2002:7f00:1::1"],
    ["unique-local", "fd00::1"],
    ["unique-local lower bound", "fc00::1"],
    ["IPv6 link-local", "fe80::1"],
    ["AWS IPv6 metadata", "fd00:ec2::254"],
    ["IPv6 multicast", "ff02::1"],
  ])("%s is not public", (_label, text) => {
    expect(isPublicAddress(text), text).toBe(false);
  });

  test("an unparseable answer is treated as non-public, not as unknown", () => {
    expect(classifyAddress("not-an-address")).toEqual({ public: false, label: null });
  });

  test("every rejection names the range it matched", () => {
    const classification = classifyAddress("169.254.169.254");
    expect(classification).toEqual({
      public: false,
      label: "link-local and cloud metadata",
    });
  });

  test("the published catalog covers both families and parses completely", () => {
    const families = new Set(
      NON_PUBLIC_ADDRESS_RANGES.map((range) => {
        const [address, bits] = range.cidr.split("/");
        expect(Number.isInteger(Number(bits)), range.cidr).toBe(true);
        const parsed = parseIpAddress(address!);
        expect(parsed, range.cidr).not.toBeNull();
        return parsed!.family;
      }),
    );
    expect([...families].sort()).toEqual(["ipv4", "ipv6"]);
  });
});
