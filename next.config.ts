import type { NextConfig } from "next";

/**
 * Founder capability surfaces (ARCHITECTURE "Security boundaries"): no
 * referrer ever leaves a founder page, no crawler may index one, no other
 * site may frame one, and nothing served there is cacheable. The capability
 * token itself travels only in the URL fragment, which no header or log
 * ever sees.
 */
const founderHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/f/:path*", headers: founderHeaders },
      { source: "/api/founder/:path*", headers: founderHeaders },
    ];
  },
};

export default nextConfig;
