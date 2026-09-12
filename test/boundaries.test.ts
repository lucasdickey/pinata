// Drift guard for the versioned validation boundary catalog (VAL-REQS-007).
//
// Every runtime policy value lives once in src/lib/boundaries/. These tests
// import those exported constants and prove that:
//   1. the catalog covers every boundary the validation contract names;
//   2. the values are internally consistent (budgets nest, caps align);
//   3. docs/EVALS.md and docs/ARCHITECTURE.md — and therefore the deployed
//      /reqs/architecture and /reqs/evals routes, which render those sources —
//      publish the exact same values, fixtures, and policy enums;
//   4. no other application module re-declares the same literals.
// Duplicated limit literals outside src/lib/boundaries/ are a defect.

import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  ANNOTATION_REQUEST_MAX_BYTES,
  ASSET_CACHE_CONTROL,
  ASSET_RANGE_UNIT,
  ASSET_VARY,
  AUTH_REQUEST_MAX_BYTES,
  BLANK_URL_ROW_POLICY,
  CAPTURE_CLEANUP_WINDOW_MS,
  CAPTURE_OUTCOMES,
  CAPTURE_POLL_DEADLINE_MS,
  CAPTURE_POLL_INITIAL_INTERVAL_MS,
  CAPTURE_POLL_MAX_INTERVAL_MS,
  CAPTURE_REQUEST_MAX_BYTES,
  CLIENT_REQUEST_TIMEOUT_MS,
  DESKTOP_VIEWPORT,
  DNS_TIMEOUT_MS,
  EDITOR_PASSWORD_MAX_CHARS,
  EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
  EDITOR_SESSION_RENEWAL_THRESHOLD_MS,
  FEEDBACK_BODY_MAX_CHARS,
  IDEMPOTENCY_KEY_MAX_CHARS,
  IDEMPOTENCY_KEY_MIN_CHARS,
  LAZY_SCROLL_MAX_STEPS,
  LAZY_SCROLL_STEP_DELAY_MS,
  LAZY_SCROLL_STEP_PX,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  MANIFEST_ACCESSIBLE_NAME_MAX_CHARS,
  MANIFEST_ELEMENT_KEYS,
  MANIFEST_TEXT_MAX_CHARS,
  MANIFEST_ELEMENT_KINDS,
  MANIFEST_HINT_KEYS,
  MANIFEST_HINT_MAX_CHARS,
  MANIFEST_MAX_CLASSES,
  MANIFEST_MAX_COMBINING_MARKS,
  MANIFEST_PATH_MAX_DEPTH,
  MANIFEST_RECT_MAX_PX,
  MANIFEST_RECT_DECIMALS,
  MANIFEST_SCHEMA_VERSION,
  MAX_ACTIVE_CAPTURES,
  MAX_ANNOTATIONS_PER_CAPTURE,
  MAX_AUTOMATIC_CAPTURE_RETRIES,
  MAX_CAPTURE_ATTEMPTS_PER_PROJECT,
  MAX_CNAME_HOPS,
  MAX_DOCUMENT_HEIGHT_PX,
  MAX_DOCUMENT_PIXELS,
  MAX_IMAGE_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_MANIFEST_ELEMENTS,
  MAX_PROVIDER_RESPONSE_BYTES,
  MAX_PUBLIC_MESSAGE_BYTES,
  MAX_REDIRECT_HOPS,
  MAX_SUBMITTED_URL_ROWS,
  MAX_UNIQUE_PAGE_URLS,
  MAX_URL_BYTES,
  MIN_ARROW_LENGTH_PX,
  MIN_HIT_TARGET_CSS_PX,
  MIN_SHAPE_SIZE_PX,
  MOBILE_VIEWPORT,
  MOTION_ANCHOR_TOLERANCE_CSS_PX,
  MOTION_MASKED_MAX_DIFF_RATIO,
  MOTION_POLICIES,
  NAVIGATION_TIMEOUT_MS,
  NEARBY_CANDIDATES_MAX,
  NETWORK_IDLE_TIMEOUT_MS,
  NON_PUBLIC_ADDRESS_RANGES,
  PERFORMANCE_PROTOCOL,
  PERF_CAMERA_REQUEST_BUDGET,
  PERF_DETACHED_NODES_MAX,
  PERF_IMAGE_TO_USABLE_P95_MS,
  PERF_INPUT_TO_PAINT_P95_MS,
  PERF_LONGEST_TASK_MS,
  PERF_PAN_ZOOM_CYCLES,
  PERF_RETAINED_HEAP_MAX_BYTES,
  PERF_SELECTION_CYCLES,
  POLICY_VERSION,
  PROJECT_REQUEST_MAX_BYTES,
  PROJECT_TITLE_MAX_CHARS,
  REDIRECT_PROBE_TIMEOUT_MS,
  REPLY_MAX_PER_WINDOW,
  REPLY_WINDOW_MS,
  STALE_CAPTURE_AGE_MS,
  SUPPORTED_MOTION,
  TOTAL_CAPTURE_TIMEOUT_MS,
  URL_NORMALIZATION_FIXTURES,
  type UrlNormalizationFixture,
} from "../src/lib/boundaries";
import { renderMarkdown } from "../src/lib/markdown";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Documentation formatting conventions. Value cells in the docs tables start
// with exactly these strings, so a changed constant or a hand-edited doc
// breaks the comparison in both directions.
const fmtMs = (v: number) => `${v.toLocaleString("en-US")} ms`;
const fmtBytes = (v: number) => `${v.toLocaleString("en-US")} bytes`;
const fmtPx = (v: number) => `${v.toLocaleString("en-US")} px`;
const fmtNum = (v: number) => v.toLocaleString("en-US");
const fmtViewport = (v: { width: number; height: number; deviceScaleFactor: number }) =>
  `${v.width} × ${v.height} CSS px, DPR ${v.deviceScaleFactor}`;

interface DocRow {
  name: string;
  value: string;
}

const SESSION_ROWS: DocRow[] = [
  { name: "EDITOR_SESSION_ABSOLUTE_LIFETIME_MS", value: fmtMs(EDITOR_SESSION_ABSOLUTE_LIFETIME_MS) },
  { name: "EDITOR_SESSION_RENEWAL_THRESHOLD_MS", value: fmtMs(EDITOR_SESSION_RENEWAL_THRESHOLD_MS) },
  { name: "AUTH_REQUEST_MAX_BYTES", value: fmtBytes(AUTH_REQUEST_MAX_BYTES) },
  { name: "EDITOR_PASSWORD_MAX_CHARS", value: fmtNum(EDITOR_PASSWORD_MAX_CHARS) },
];

const URL_ROWS: DocRow[] = [
  { name: "MAX_SUBMITTED_URL_ROWS", value: fmtNum(MAX_SUBMITTED_URL_ROWS) },
  { name: "MAX_UNIQUE_PAGE_URLS", value: fmtNum(MAX_UNIQUE_PAGE_URLS) },
  { name: "MAX_URL_BYTES", value: fmtBytes(MAX_URL_BYTES) },
  { name: "BLANK_URL_ROW_POLICY", value: BLANK_URL_ROW_POLICY },
  { name: "PROJECT_REQUEST_MAX_BYTES", value: fmtBytes(PROJECT_REQUEST_MAX_BYTES) },
  { name: "PROJECT_TITLE_MAX_CHARS", value: fmtNum(PROJECT_TITLE_MAX_CHARS) },
  { name: "IDEMPOTENCY_KEY_MIN_CHARS", value: fmtNum(IDEMPOTENCY_KEY_MIN_CHARS) },
  { name: "IDEMPOTENCY_KEY_MAX_CHARS", value: fmtNum(IDEMPOTENCY_KEY_MAX_CHARS) },
];

const CAPTURE_ROWS: DocRow[] = [
  { name: "DESKTOP_VIEWPORT", value: fmtViewport(DESKTOP_VIEWPORT) },
  { name: "MOBILE_VIEWPORT", value: fmtViewport(MOBILE_VIEWPORT) },
  { name: "MAX_DOCUMENT_HEIGHT_PX", value: fmtPx(MAX_DOCUMENT_HEIGHT_PX) },
  { name: "MAX_DOCUMENT_PIXELS", value: fmtPx(MAX_DOCUMENT_PIXELS) },
  { name: "MAX_IMAGE_BYTES", value: fmtBytes(MAX_IMAGE_BYTES) },
  { name: "ALLOWED_IMAGE_CONTENT_TYPES", value: ALLOWED_IMAGE_CONTENT_TYPES.join(", ") },
  { name: "MAX_PROVIDER_RESPONSE_BYTES", value: fmtBytes(MAX_PROVIDER_RESPONSE_BYTES) },
  { name: "NAVIGATION_TIMEOUT_MS", value: fmtMs(NAVIGATION_TIMEOUT_MS) },
  { name: "NETWORK_IDLE_TIMEOUT_MS", value: fmtMs(NETWORK_IDLE_TIMEOUT_MS) },
  { name: "LAZY_SCROLL_STEP_PX", value: fmtPx(LAZY_SCROLL_STEP_PX) },
  { name: "LAZY_SCROLL_MAX_STEPS", value: fmtNum(LAZY_SCROLL_MAX_STEPS) },
  { name: "LAZY_SCROLL_STEP_DELAY_MS", value: fmtMs(LAZY_SCROLL_STEP_DELAY_MS) },
  { name: "TOTAL_CAPTURE_TIMEOUT_MS", value: fmtMs(TOTAL_CAPTURE_TIMEOUT_MS) },
  { name: "MAX_REDIRECT_HOPS", value: fmtNum(MAX_REDIRECT_HOPS) },
  { name: "DNS_TIMEOUT_MS", value: fmtMs(DNS_TIMEOUT_MS) },
  { name: "MAX_CNAME_HOPS", value: fmtNum(MAX_CNAME_HOPS) },
  { name: "REDIRECT_PROBE_TIMEOUT_MS", value: fmtMs(REDIRECT_PROBE_TIMEOUT_MS) },
  { name: "MAX_CAPTURE_ATTEMPTS_PER_PROJECT", value: fmtNum(MAX_CAPTURE_ATTEMPTS_PER_PROJECT) },
  { name: "MAX_ACTIVE_CAPTURES", value: fmtNum(MAX_ACTIVE_CAPTURES) },
  { name: "MAX_AUTOMATIC_CAPTURE_RETRIES", value: fmtNum(MAX_AUTOMATIC_CAPTURE_RETRIES) },
  { name: "STALE_CAPTURE_AGE_MS", value: fmtMs(STALE_CAPTURE_AGE_MS) },
  { name: "CAPTURE_CLEANUP_WINDOW_MS", value: fmtMs(CAPTURE_CLEANUP_WINDOW_MS) },
  { name: "CAPTURE_REQUEST_MAX_BYTES", value: fmtBytes(CAPTURE_REQUEST_MAX_BYTES) },
  { name: "CAPTURE_POLL_INITIAL_INTERVAL_MS", value: fmtMs(CAPTURE_POLL_INITIAL_INTERVAL_MS) },
  { name: "CAPTURE_POLL_MAX_INTERVAL_MS", value: fmtMs(CAPTURE_POLL_MAX_INTERVAL_MS) },
  { name: "CAPTURE_POLL_DEADLINE_MS", value: fmtMs(CAPTURE_POLL_DEADLINE_MS) },
];

const MANIFEST_ROWS: DocRow[] = [
  { name: "MANIFEST_SCHEMA_VERSION", value: fmtNum(MANIFEST_SCHEMA_VERSION) },
  { name: "MAX_MANIFEST_ELEMENTS", value: fmtNum(MAX_MANIFEST_ELEMENTS) },
  { name: "MAX_MANIFEST_BYTES", value: fmtBytes(MAX_MANIFEST_BYTES) },
  { name: "MANIFEST_TEXT_MAX_CHARS", value: fmtNum(MANIFEST_TEXT_MAX_CHARS) },
  { name: "MANIFEST_ACCESSIBLE_NAME_MAX_CHARS", value: fmtNum(MANIFEST_ACCESSIBLE_NAME_MAX_CHARS) },
  { name: "MANIFEST_MAX_CLASSES", value: fmtNum(MANIFEST_MAX_CLASSES) },
  { name: "MANIFEST_HINT_MAX_CHARS", value: fmtNum(MANIFEST_HINT_MAX_CHARS) },
  { name: "MANIFEST_MAX_COMBINING_MARKS", value: fmtNum(MANIFEST_MAX_COMBINING_MARKS) },
  { name: "MANIFEST_RECT_MAX_PX", value: fmtPx(MANIFEST_RECT_MAX_PX) },
  { name: "MANIFEST_PATH_MAX_DEPTH", value: fmtNum(MANIFEST_PATH_MAX_DEPTH) },
  { name: "MANIFEST_RECT_DECIMALS", value: fmtNum(MANIFEST_RECT_DECIMALS) },
  { name: "MANIFEST_ELEMENT_KEYS", value: MANIFEST_ELEMENT_KEYS.join(", ") },
  { name: "MANIFEST_HINT_KEYS", value: MANIFEST_HINT_KEYS.join(", ") },
  { name: "MANIFEST_ELEMENT_KINDS", value: MANIFEST_ELEMENT_KINDS.join(", ") },
];

const MOTION_ROWS: DocRow[] = [
  { name: "MOTION_ANCHOR_TOLERANCE_CSS_PX", value: fmtPx(MOTION_ANCHOR_TOLERANCE_CSS_PX) },
  { name: "MOTION_MASKED_MAX_DIFF_RATIO", value: String(MOTION_MASKED_MAX_DIFF_RATIO) },
];

const GEOMETRY_ROWS: DocRow[] = [
  { name: "MIN_SHAPE_SIZE_PX", value: fmtPx(MIN_SHAPE_SIZE_PX) },
  { name: "MIN_ARROW_LENGTH_PX", value: fmtPx(MIN_ARROW_LENGTH_PX) },
];

const QUOTA_ROWS: DocRow[] = [
  { name: "LOGIN_MAX_FAILURES", value: fmtNum(LOGIN_MAX_FAILURES) },
  { name: "LOGIN_WINDOW_MS", value: fmtMs(LOGIN_WINDOW_MS) },
  { name: "REPLY_MAX_PER_WINDOW", value: fmtNum(REPLY_MAX_PER_WINDOW) },
  { name: "REPLY_WINDOW_MS", value: fmtMs(REPLY_WINDOW_MS) },
];

const FEEDBACK_ROWS: DocRow[] = [
  { name: "FEEDBACK_BODY_MAX_CHARS", value: fmtNum(FEEDBACK_BODY_MAX_CHARS) },
  { name: "MAX_ANNOTATIONS_PER_CAPTURE", value: fmtNum(MAX_ANNOTATIONS_PER_CAPTURE) },
  { name: "NEARBY_CANDIDATES_MAX", value: fmtNum(NEARBY_CANDIDATES_MAX) },
  { name: "ANNOTATION_REQUEST_MAX_BYTES", value: fmtBytes(ANNOTATION_REQUEST_MAX_BYTES) },
];

const INTERACTION_ROWS: DocRow[] = [
  { name: "CLIENT_REQUEST_TIMEOUT_MS", value: fmtMs(CLIENT_REQUEST_TIMEOUT_MS) },
  { name: "MIN_HIT_TARGET_CSS_PX", value: fmtPx(MIN_HIT_TARGET_CSS_PX) },
];

const PERFORMANCE_ROWS: DocRow[] = [
  {
    name: "PERFORMANCE_PROTOCOL",
    value: `${PERFORMANCE_PROTOCOL.runs} measured runs, ${PERFORMANCE_PROTOCOL.browser}, ${PERFORMANCE_PROTOCOL.viewportName} viewport, ${PERFORMANCE_PROTOCOL.machine}, ${PERFORMANCE_PROTOCOL.fixture}`,
  },
  { name: "PERF_IMAGE_TO_USABLE_P95_MS", value: fmtMs(PERF_IMAGE_TO_USABLE_P95_MS) },
  { name: "PERF_PAN_ZOOM_CYCLES", value: fmtNum(PERF_PAN_ZOOM_CYCLES) },
  { name: "PERF_SELECTION_CYCLES", value: fmtNum(PERF_SELECTION_CYCLES) },
  { name: "PERF_INPUT_TO_PAINT_P95_MS", value: fmtMs(PERF_INPUT_TO_PAINT_P95_MS) },
  { name: "PERF_LONGEST_TASK_MS", value: fmtMs(PERF_LONGEST_TASK_MS) },
  { name: "PERF_RETAINED_HEAP_MAX_BYTES", value: fmtBytes(PERF_RETAINED_HEAP_MAX_BYTES) },
  { name: "PERF_DETACHED_NODES_MAX", value: fmtNum(PERF_DETACHED_NODES_MAX) },
  { name: "PERF_CAMERA_REQUEST_BUDGET", value: fmtNum(PERF_CAMERA_REQUEST_BUDGET) },
];

const OUTCOME_ROWS: DocRow[] = [
  { name: "MAX_PUBLIC_MESSAGE_BYTES", value: fmtBytes(MAX_PUBLIC_MESSAGE_BYTES) },
];

const ASSET_ROWS: DocRow[] = [
  { name: "ASSET_CACHE_CONTROL", value: ASSET_CACHE_CONTROL },
  { name: "ASSET_VARY", value: ASSET_VARY },
  { name: "ASSET_RANGE_UNIT", value: ASSET_RANGE_UNIT },
];

/** Every constant the Evals source must publish, as `name | value` rows. */
const EVALS_ROWS: DocRow[] = [
  { name: "POLICY_VERSION", value: POLICY_VERSION },
  ...SESSION_ROWS,
  ...URL_ROWS,
  ...CAPTURE_ROWS,
  ...MANIFEST_ROWS,
  ...MOTION_ROWS,
  ...OUTCOME_ROWS,
  ...ASSET_ROWS,
  ...GEOMETRY_ROWS,
  ...QUOTA_ROWS,
  ...FEEDBACK_ROWS,
  ...INTERACTION_ROWS,
  ...PERFORMANCE_ROWS,
];

/** The subset the Architecture source publishes inline (it points at Evals for the rest). */
const ARCHITECTURE_ROWS: DocRow[] = [
  { name: "POLICY_VERSION", value: POLICY_VERSION },
  ...SESSION_ROWS,
  ...CAPTURE_ROWS,
  ...ASSET_ROWS,
  { name: "MANIFEST_SCHEMA_VERSION", value: fmtNum(MANIFEST_SCHEMA_VERSION) },
  { name: "MAX_MANIFEST_ELEMENTS", value: fmtNum(MAX_MANIFEST_ELEMENTS) },
  { name: "MAX_MANIFEST_BYTES", value: fmtBytes(MAX_MANIFEST_BYTES) },
];

const rowText = (r: DocRow) => `\`${r.name}\` | ${r.value}`;

const outcomeRow = (o: (typeof CAPTURE_OUTCOMES)[number]) =>
  `| ${o.code} | ${o.captureStatus} | ${o.retryable ? "yes" : "no"} | ${o.httpStatus ?? "—"} | ${
    o.consumesAttempt ? "yes" : "no"
  } | ${o.warn ? "yes" : "no"} |`;

const motionRow = (m: (typeof SUPPORTED_MOTION)[number]) => `| ${m.label} | ${m.policy} |`;

function fixtureRow(f: UrlNormalizationFixture): string {
  if (f.type === "normalize") {
    return `| ${f.name} | \`${f.input}\` | \`${f.url}\` |`;
  }
  if (f.type === "reject") {
    const input = f.input.trim() === "" ? "(blank)" : `\`${f.input}\``;
    return `| ${f.name} | ${input} | \`reject: ${f.reason}\` |`;
  }
  const inputs = f.inputs.map((i) => `\`${i}\``).join(" or ");
  return `| ${f.name} | ${inputs} | \`${f.url}\` (same page) |`;
}

describe("boundary catalog coverage and consistency", () => {
  test("the catalog is versioned with a dated policy version", () => {
    expect(POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  test("session renewal only makes sense inside the absolute lifetime", () => {
    expect(EDITOR_SESSION_RENEWAL_THRESHOLD_MS).toBeGreaterThan(0);
    expect(EDITOR_SESSION_RENEWAL_THRESHOLD_MS).toBeLessThan(EDITOR_SESSION_ABSOLUTE_LIFETIME_MS);
  });

  test("viewports are the contract-mandated standard devices at DPR 1", () => {
    expect(DESKTOP_VIEWPORT).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 });
    expect(MOBILE_VIEWPORT).toEqual({ width: 390, height: 844, deviceScaleFactor: 1 });
  });

  test("capture budgets nest inside each other and the provider session cap", () => {
    // The lazy scroll can always reach the bottom of a maximum-height page.
    expect(LAZY_SCROLL_STEP_PX * LAZY_SCROLL_MAX_STEPS).toBeGreaterThanOrEqual(
      MAX_DOCUMENT_HEIGHT_PX,
    );
    // The pixel cap admits a maximum-height desktop capture.
    expect(MAX_DOCUMENT_PIXELS).toBeGreaterThanOrEqual(
      MAX_DOCUMENT_HEIGHT_PX * DESKTOP_VIEWPORT.width,
    );
    // Each phase budget fits inside the total, and the total fits inside the
    // Browserless two-minute session limit.
    const lazyBudget = LAZY_SCROLL_MAX_STEPS * LAZY_SCROLL_STEP_DELAY_MS;
    expect(NAVIGATION_TIMEOUT_MS + NETWORK_IDLE_TIMEOUT_MS + lazyBudget).toBeLessThan(
      TOTAL_CAPTURE_TIMEOUT_MS,
    );
    expect(TOTAL_CAPTURE_TIMEOUT_MS).toBeLessThan(120_000);
    // Stale is strictly older than the worst-case healthy capture.
    expect(STALE_CAPTURE_AGE_MS).toBeGreaterThan(TOTAL_CAPTURE_TIMEOUT_MS);
  });

  test("the whole admission preflight fits inside the capture deadline", () => {
    // Worst case before the provider is even called: one DNS round per hop
    // plus one probe per hop.
    const perHop = DNS_TIMEOUT_MS + REDIRECT_PROBE_TIMEOUT_MS;
    expect(perHop * (MAX_REDIRECT_HOPS + 1)).toBeLessThan(TOTAL_CAPTURE_TIMEOUT_MS);
    expect(MAX_CNAME_HOPS).toBeGreaterThan(0);
  });

  test("the non-public address catalog is unique and canonical", () => {
    const cidrs = NON_PUBLIC_ADDRESS_RANGES.map((range) => range.cidr);
    expect(new Set(cidrs).size).toBe(cidrs.length);
    for (const range of NON_PUBLIC_ADDRESS_RANGES) {
      expect(range.cidr, range.cidr).toMatch(/^[0-9a-f.:]+\/\d{1,3}$/);
      expect(range.label.length, range.cidr).toBeGreaterThan(0);
    }
  });

  test("attempt quota admits the initial attempts of a maximum-size project", () => {
    expect(MAX_CAPTURE_ATTEMPTS_PER_PROJECT).toBeGreaterThanOrEqual(MAX_UNIQUE_PAGE_URLS * 2);
    expect(MAX_SUBMITTED_URL_ROWS).toBeGreaterThanOrEqual(MAX_UNIQUE_PAGE_URLS);
  });

  test("the project request cap admits a maximum submission", () => {
    // Every row at its maximum length must fit, plus title and framing.
    expect(PROJECT_REQUEST_MAX_BYTES).toBeGreaterThan(MAX_SUBMITTED_URL_ROWS * MAX_URL_BYTES);
    expect(IDEMPOTENCY_KEY_MIN_CHARS).toBeLessThan(IDEMPOTENCY_KEY_MAX_CHARS);
    expect(PROJECT_TITLE_MAX_CHARS).toBeGreaterThan(0);
  });

  test("concurrency and manifest caps are the contract values", () => {
    expect(MAX_ACTIVE_CAPTURES).toBe(2);
    // One automatic retry, then a person decides (D076).
    expect(MAX_AUTOMATIC_CAPTURE_RETRIES).toBe(1);
    expect(MAX_MANIFEST_ELEMENTS).toBe(500);
    expect(MAX_MANIFEST_BYTES).toBe(256 * 1024);
  });

  test("capture polling backs off inside a deadline that outlives stale detection", () => {
    expect(CAPTURE_POLL_INITIAL_INTERVAL_MS).toBeGreaterThan(0);
    expect(CAPTURE_POLL_MAX_INTERVAL_MS).toBeGreaterThanOrEqual(
      CAPTURE_POLL_INITIAL_INTERVAL_MS,
    );
    // The poller must still be alive when an abandoned attempt crosses the
    // stale age, so the stop state a user sees is "stale", never a timeout.
    expect(CAPTURE_POLL_DEADLINE_MS).toBeGreaterThan(STALE_CAPTURE_AGE_MS);
  });

  test("hit targets and feedback bounds meet their floors", () => {
    // WCAG 2.2 AA target-size minimum.
    expect(MIN_HIT_TARGET_CSS_PX).toBeGreaterThanOrEqual(24);
    expect(FEEDBACK_BODY_MAX_CHARS).toBeGreaterThan(0);
    expect(MAX_ANNOTATIONS_PER_CAPTURE).toBeGreaterThanOrEqual(NEARBY_CANDIDATES_MAX);
    expect(NEARBY_CANDIDATES_MAX).toBeGreaterThan(0);
    expect(MIN_ARROW_LENGTH_PX).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE_PX);
    // The annotation request cap must comfortably hold a maximal comment
    // plus its tip, key, and JSON envelope.
    expect(ANNOTATION_REQUEST_MAX_BYTES).toBeGreaterThan(FEEDBACK_BODY_MAX_CHARS * 4);
  });

  test("the performance protocol matches the contract protocol", () => {
    expect(PERF_PAN_ZOOM_CYCLES).toBe(60);
    expect(PERF_SELECTION_CYCLES).toBe(100);
    expect(PERF_CAMERA_REQUEST_BUDGET).toBe(0);
    expect(PERFORMANCE_PROTOCOL.runs).toBeGreaterThanOrEqual(3);
  });

  test("the asset cache policy forbids retention and keys on authority", () => {
    // Private screenshots behind a revocable authority must never be stored
    // by a browser or intermediary, and any cache that saw a response must
    // key on the authority-carrying header.
    expect(ASSET_CACHE_CONTROL).toContain("private");
    expect(ASSET_CACHE_CONTROL).toContain("no-store");
    expect(ASSET_CACHE_CONTROL).toContain("max-age=0");
    expect(ASSET_VARY).toBe("Cookie");
    expect(ASSET_RANGE_UNIT).toBe("bytes");
  });
});

describe("URL normalization fixtures", () => {
  test("fixtures are well-formed and uniquely named", () => {
    expect(URL_NORMALIZATION_FIXTURES.length).toBeGreaterThanOrEqual(15);
    const names = URL_NORMALIZATION_FIXTURES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const f of URL_NORMALIZATION_FIXTURES) {
      if (f.type === "normalize") {
        expect(f.input.length).toBeGreaterThan(0);
      }
      if (f.type === "equivalent") {
        expect(f.inputs.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test("every normalized expectation already satisfies the published policy", () => {
    const normalized = URL_NORMALIZATION_FIXTURES.flatMap((f) =>
      f.type === "reject" ? [] : [f.url],
    );
    for (const url of normalized) {
      const parsed = new URL(url);
      expect(parsed.protocol).toBe("https:");
      expect(parsed.username).toBe("");
      expect(parsed.password).toBe("");
      expect(parsed.port).toBe("");
      expect(parsed.hash).toBe("");
      expect(parsed.hostname).not.toMatch(/\.$/);
      expect(parsed.pathname.startsWith("/")).toBe(true);
      // An empty query string is dropped rather than preserved as "?".
      expect(url.endsWith("?")).toBe(false);
    }
  });

  test("fixtures agree with WHATWG URL semantics where WHATWG owns the rule", () => {
    // IDNA hosts become punycode.
    expect(new URL("https://bücher.example/").hostname).toBe("xn--bcher-kva.example");
    // Dot segments resolve.
    expect(new URL("https://example.com/a/../b/./c").href).toBe("https://example.com/b/c");
    // Backslashes are path separators for special schemes.
    expect(new URL("https://example.com\\pricing").href).toBe("https://example.com/pricing");
    // WHATWG keeps the trailing dot, so the fixture's stripped form is a
    // deliberate policy step, not a parser accident.
    expect(new URL("https://example.com./pricing").hostname).toBe("example.com.");
    // WHATWG preserves percent-encoding, so %7E/~ stay distinct page identities.
    expect(new URL("https://example.com/%7Eme").href).toBe("https://example.com/%7Eme");
    // Numeric IPv4 spellings canonicalize to dotted-quad before range checks.
    expect(new URL("https://2130706433/").hostname).toBe("127.0.0.1");
  });

  test("fixtures cover the contract-required cases", () => {
    const names = new Set(URL_NORMALIZATION_FIXTURES.map((f) => f.name));
    for (const required of [
      "idna-host-becomes-punycode",
      "trailing-dot-stripped",
      "backslash-treated-as-slash",
      "encoded-slash-preserved",
      "encoded-tilde-preserved",
      "trailing-slash-is-distinct",
      "empty-query-dropped",
      "fragment-removed",
      "root-and-slash-are-one-page",
      "credentials-rejected",
      "numeric-ip-spelling-rejected",
    ]) {
      expect(names, required).toContain(required);
    }
  });
});

describe("capture outcome catalog", () => {
  test("every contract-required outcome case has exactly one entry", () => {
    const required = [
      "invalid-url",
      "dns-failed",
      "unsafe-redirect",
      "browserless-auth",
      "browserless-provider",
      "navigation-timeout",
      "total-timeout",
      "document-too-tall",
      "too-many-pixels",
      "provider-bytes-exceeded",
      "image-bytes-exceeded",
      "invalid-image",
      "quota-exceeded",
      "blob-failure",
      "finalization-failure",
      "stale-lease",
      "cleanup-pending",
      "manifest-truncated",
    ];
    const codes = CAPTURE_OUTCOMES.map((o) => o.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of required) expect(codes, code).toContain(code);
  });

  test("public messages stay inside the shared byte bound and carry remediation", () => {
    for (const outcome of CAPTURE_OUTCOMES) {
      expect(
        Buffer.byteLength(outcome.publicMessage, "utf8"),
        outcome.code,
      ).toBeLessThanOrEqual(MAX_PUBLIC_MESSAGE_BYTES);
      expect(outcome.remediation.length, outcome.code).toBeGreaterThan(0);
      expect(["ready", "failed"], outcome.code).toContain(outcome.captureStatus);
      // HTTP status applies to request/response outcomes; computed states
      // (stale lease, ready-with-warning) have none.
      if (outcome.httpStatus === null) {
        expect(["stale-lease", "cleanup-pending", "manifest-truncated"]).toContain(outcome.code);
      }
      // Warnings only ride on ready captures.
      if (outcome.warn) expect(outcome.captureStatus).toBe("ready");
    }
  });

  test("boundary rejections happen before an attempt exists", () => {
    const byCode = new Map(CAPTURE_OUTCOMES.map((o) => [o.code, o]));
    expect(byCode.get("invalid-url")?.consumesAttempt).toBe(false);
    expect(byCode.get("quota-exceeded")?.consumesAttempt).toBe(false);
    expect(byCode.get("quota-exceeded")?.retryable).toBe(true);
  });
});

describe("supported-motion matrix", () => {
  test("covers the contract cases with published policies", () => {
    const cases = new Map(SUPPORTED_MOTION.map((m) => [m.case, m.policy]));
    for (const required of [
      "css-animation",
      "css-transition",
      "caret",
      "web-animations",
      "video",
      "animated-image",
      "canvas-js",
      "sticky-parallax",
    ]) {
      expect(cases.has(required), required).toBe(true);
    }
    for (const m of SUPPORTED_MOTION) {
      expect(MOTION_POLICIES, m.case).toContain(m.policy);
    }
  });
});

describe("documentation publication", () => {
  const evalsDoc = read("docs/EVALS.md");
  const archDoc = read("docs/ARCHITECTURE.md");

  test("EVALS.md publishes every catalog constant with its exact value", () => {
    for (const row of EVALS_ROWS) {
      expect(evalsDoc, row.name).toContain(rowText(row));
    }
  });

  test("EVALS.md publishes the supported-motion policy enum", () => {
    for (const m of SUPPORTED_MOTION) {
      expect(evalsDoc, m.case).toContain(motionRow(m));
    }
  });

  test("EVALS.md publishes the full capture outcome catalog", () => {
    for (const o of CAPTURE_OUTCOMES) {
      expect(evalsDoc, o.code).toContain(outcomeRow(o));
    }
  });

  test("EVALS.md publishes every non-public address range", () => {
    for (const range of NON_PUBLIC_ADDRESS_RANGES) {
      expect(evalsDoc, range.cidr).toContain(`| \`${range.cidr}\` | ${range.label} |`);
    }
  });

  test("EVALS.md publishes every URL normalization fixture verbatim", () => {
    for (const f of URL_NORMALIZATION_FIXTURES) {
      expect(evalsDoc, f.name).toContain(fixtureRow(f));
    }
  });

  test("ARCHITECTURE.md publishes its boundary subset with exact values", () => {
    for (const row of ARCHITECTURE_ROWS) {
      expect(archDoc, row.name).toContain(rowText(row));
    }
  });

  test("the deployed /reqs routes render the same values from these sources", () => {
    // /reqs/evals and /reqs/architecture render exactly these documents
    // through renderMarkdown, so rendered HTML containing the values proves
    // route alignment without a server.
    const evalsHtml = renderMarkdown(evalsDoc).html;
    const archHtml = renderMarkdown(archDoc).html;
    expect(evalsHtml).toContain(POLICY_VERSION);
    expect(evalsHtml).toContain(fmtViewport(DESKTOP_VIEWPORT));
    expect(evalsHtml).toContain(fmtViewport(MOBILE_VIEWPORT));
    expect(evalsHtml).toContain("invalid-url");
    expect(evalsHtml).toContain("stale-lease");
    expect(archHtml).toContain(POLICY_VERSION);
    expect(archHtml).toContain(fmtMs(TOTAL_CAPTURE_TIMEOUT_MS));
    expect(archHtml).toContain(fmtBytes(MAX_MANIFEST_BYTES));
  });
});

describe("no duplicated runtime literals", () => {
  // Distinctive policy values that must exist only in src/lib/boundaries/.
  // If a future module hardcodes one instead of importing the constant, this
  // scan fails. Generic small numbers (2, 5, 8, ...) are not scanned.
  const watched = [
    DESKTOP_VIEWPORT.width,
    DESKTOP_VIEWPORT.height,
    MOBILE_VIEWPORT.width,
    MOBILE_VIEWPORT.height,
    MAX_DOCUMENT_HEIGHT_PX,
    MAX_DOCUMENT_PIXELS,
    MAX_IMAGE_BYTES,
    MAX_PROVIDER_RESPONSE_BYTES,
    MAX_MANIFEST_BYTES,
    EDITOR_SESSION_ABSOLUTE_LIFETIME_MS,
    EDITOR_SESSION_RENEWAL_THRESHOLD_MS,
    TOTAL_CAPTURE_TIMEOUT_MS,
    STALE_CAPTURE_AGE_MS,
    CAPTURE_POLL_DEADLINE_MS,
    CLIENT_REQUEST_TIMEOUT_MS,
    PERF_RETAINED_HEAP_MAX_BYTES,
  ];

  function numericForms(v: number): string[] {
    const plain = String(v);
    const underscored = plain.replace(/\B(?=(\d{3})+(?!\d))/g, "_");
    const grouped = v.toLocaleString("en-US");
    return [...new Set([plain, underscored, grouped])];
  }

  function* sourceFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path.includes(join("src", "lib", "boundaries"))) continue;
        yield* sourceFiles(path);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        yield path;
      }
    }
  }

  test("policy literals appear only in the boundaries catalog", () => {
    const offenders: string[] = [];
    for (const base of ["src", "app"]) {
      for (const file of sourceFiles(join(ROOT, base))) {
        const content = readFileSync(file, "utf8");
        for (const value of watched) {
          for (const form of numericForms(value)) {
            if (content.includes(form)) {
              offenders.push(`${file}: ${form}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
