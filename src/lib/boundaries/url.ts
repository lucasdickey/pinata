// URL and project-input boundary policy (VAL-PROJECT-002). The fixtures
// below are the executable definition of normalization: the URL module must
// make every fixture pass, and docs/EVALS.md publishes them verbatim.

/** Submitted URL rows accepted per project-create request, before dedupe. */
export const MAX_SUBMITTED_URL_ROWS = 32;

/** Unique normalized page URLs retained per project. */
export const MAX_UNIQUE_PAGE_URLS = 16;

/** Per-row URL length limit, measured as UTF-8 bytes. */
export const MAX_URL_BYTES = 2_048;

/**
 * Blank optional rows in the explicit URL array are ignored. The root URL is
 * always required, so a blank root is a validation error, not a blank row.
 */
export const BLANK_URL_ROW_POLICY = "ignore" as const;

/**
 * Hard cap on a project-create request body, enforced before parsing: every
 * submitted row at its maximum length plus room for the title, idempotency
 * key, and JSON framing.
 */
export const PROJECT_REQUEST_MAX_BYTES = MAX_SUBMITTED_URL_ROWS * MAX_URL_BYTES + 4_096;

/** Longest accepted project title. */
export const PROJECT_TITLE_MAX_CHARS = 120;

/** Shortest accepted mutation idempotency key. */
export const IDEMPOTENCY_KEY_MIN_CHARS = 8;

/** Longest accepted mutation idempotency key. */
export const IDEMPOTENCY_KEY_MAX_CHARS = 128;

export type UrlRejectReason =
  | "blank"
  | "malformed"
  | "relative"
  | "scheme"
  | "credentials"
  | "ip-literal"
  | "port"
  | "not-public"
  | "too-long";

export type UrlNormalizationFixture =
  | { name: string; type: "normalize"; input: string; url: string }
  | { name: string; type: "reject"; input: string; reason: UrlRejectReason }
  | { name: string; type: "equivalent"; inputs: readonly string[]; url: string };

/**
 * Normalization policy, pinned by fixtures:
 * - trim surrounding whitespace, then reject rows over `MAX_URL_BYTES`;
 * - parse once with WHATWG `URL` (lowercases scheme/host, converts IDNA hosts
 *   to punycode, removes the default `:443` port, resolves dot segments, and
 *   treats backslashes as slashes for special schemes);
 * - reject any IP-literal host (canonicalized first, so numeric spellings and
 *   private/link-local/metadata addresses cannot slip through) and any host
 *   that cannot be public (single label, or a reserved special-use suffix);
 * - strip a single trailing host dot (a policy step WHATWG does not perform);
 * - remove the fragment and drop an empty query;
 * - turn an empty path into `/`;
 * - preserve path case, percent-encoding (so `%7E` and `~`, and encoded
 *   separators such as `%2F`, stay distinct), and query order/duplicates.
 */
export const URL_NORMALIZATION_FIXTURES: readonly UrlNormalizationFixture[] =
  Object.freeze([
    {
      name: "scheme-and-host-are-lowercased",
      input: "HTTPS://EXAMPLE.COM/Pricing",
      type: "normalize", url: "https://example.com/Pricing",
    },
    {
      name: "empty-path-becomes-root",
      input: "https://example.com",
      type: "normalize", url: "https://example.com/",
    },
    {
      name: "default-port-443-removed",
      input: "https://example.com:443/pricing",
      type: "normalize", url: "https://example.com/pricing",
    },
    {
      name: "non-443-port-rejected",
      input: "https://example.com:8443/",
      type: "reject", reason: "port",
    },
    {
      name: "fragment-removed",
      input: "https://example.com/pricing#team",
      type: "normalize", url: "https://example.com/pricing",
    },
    {
      name: "query-order-and-duplicates-preserved",
      input: "https://example.com/pricing?ref=a&ref=b",
      type: "normalize", url: "https://example.com/pricing?ref=a&ref=b",
    },
    {
      name: "empty-query-dropped",
      input: "https://example.com/pricing?",
      type: "normalize", url: "https://example.com/pricing",
    },
    {
      name: "encoded-tilde-preserved",
      input: "https://example.com/%7Eme",
      type: "normalize", url: "https://example.com/%7Eme",
    },
    {
      name: "encoded-slash-preserved",
      input: "https://example.com/a%2fb",
      type: "normalize", url: "https://example.com/a%2fb",
    },
    {
      name: "idna-host-becomes-punycode",
      input: "https://bücher.example/",
      type: "normalize", url: "https://xn--bcher-kva.example/",
    },
    {
      name: "trailing-dot-stripped",
      input: "https://example.com./pricing",
      type: "normalize", url: "https://example.com/pricing",
    },
    {
      name: "backslash-treated-as-slash",
      input: "https://example.com\\pricing",
      type: "normalize", url: "https://example.com/pricing",
    },
    {
      name: "dot-segments-resolved",
      input: "https://example.com/a/../b/./c",
      type: "normalize", url: "https://example.com/b/c",
    },
    {
      // `/pricing` and `/pricing/` are different normalized URLs; neither is
      // collapsed into the other.
      name: "trailing-slash-is-distinct",
      input: "https://example.com/pricing/",
      type: "normalize", url: "https://example.com/pricing/",
    },
    {
      name: "credentials-rejected",
      input: "https://user:pass@example.com/",
      type: "reject", reason: "credentials",
    },
    {
      name: "http-scheme-rejected",
      input: "http://example.com/",
      type: "reject", reason: "scheme",
    },
    {
      name: "ip-literal-rejected",
      input: "https://127.0.0.1/",
      type: "reject", reason: "ip-literal",
    },
    {
      // WHATWG canonicalizes this to 127.0.0.1 before any range check.
      name: "numeric-ip-spelling-rejected",
      input: "https://2130706433/",
      type: "reject", reason: "ip-literal",
    },
    {
      name: "ipv6-loopback-rejected",
      input: "https://[::1]/",
      type: "reject", reason: "ip-literal",
    },
    {
      name: "relative-input-rejected",
      input: "/pricing",
      type: "reject", reason: "relative",
    },
    {
      name: "blank-input-rejected",
      input: "",
      type: "reject", reason: "blank",
    },
    {
      name: "surrounding-whitespace-trimmed",
      input: "  https://example.com/pricing  ",
      type: "normalize", url: "https://example.com/pricing",
    },
    {
      // An explicit array row may point at a different public origin than the
      // root; cross-origin is a Pinata feature, not an error.
      name: "cross-origin-https-allowed",
      input: "https://docs.example.org/guide",
      type: "normalize", url: "https://docs.example.org/guide",
    },
    {
      name: "unsupported-scheme-rejected",
      input: "javascript:alert(1)",
      type: "reject", reason: "scheme",
    },
    {
      name: "localhost-rejected",
      input: "https://localhost/",
      type: "reject", reason: "not-public",
    },
    {
      name: "single-label-host-rejected",
      input: "https://intranet/",
      type: "reject", reason: "not-public",
    },
    {
      name: "private-range-literal-rejected",
      input: "https://10.0.0.5/",
      type: "reject", reason: "ip-literal",
    },
    {
      name: "metadata-address-rejected",
      input: "https://169.254.169.254/latest/meta-data/",
      type: "reject", reason: "ip-literal",
    },
    {
      name: "root-and-slash-are-one-page",
      inputs: ["https://example.com", "https://example.com/"],
      type: "equivalent", url: "https://example.com/",
    },
  ]);
