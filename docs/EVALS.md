# Pinata evals

This is the human-readable catalog of how Pinata is evaluated, rendered live
at `/reqs/evals`. The formal, executable definition of done is the mission
validation contract (`validation-contract.md`, assertion IDs `VAL-*`); this
catalog explains the same intent in plain language so anyone can add
scenarios. When the two disagree, the contract wins.

## How evaluation works

- **One gate.** `npm run validate` runs lint and integrity, typecheck, unit
  and component tests, the deterministic docs check, the production build,
  and Chromium end-to-end tests — the same command locally and in CI.
- **Real integrations.** Milestone validation exercises the real Browserless,
  Turso, private Blob, and Vercel surfaces. Mocks support focused unit tests;
  they are never the definition of done.
- **Live checkpoints.** After each milestone's automated validation passes,
  the owner drives a headed shared-browser session while the agent inspects
  the same DOM, console, network, and persisted state.
- **Escapes become assertions.** Any issue the owner reports is written down
  as a `given / when / expected / observed` contract assertion before a fix
  is implemented.

## Chickpea scenarios

The primary real-world target is [Chickpea](https://chickpea.co/) plus its
explicit `/pricing`, `/about`, and `/privacy` URLs, captured on desktop and
mobile. Representative scenarios:

1. Full-page captures include lazy-loaded content near the bottom of the
   page, on both viewports.
2. Deep zoom on a dense pricing-table cell stays readable, and a pin dropped
   on that cell persists to the exact natural pixel after reload.
3. Choosing the right nearby element from a dense table ranks the cell ahead
   of its row and table wrappers.
4. The closed mobile menu's hidden descendants never appear as selectable
   metadata, while a visible header element does.
5. Desktop and mobile annotations of the same page stay fully independent.
6. The explicit URL array preserves its submitted order in the page tree.
7. A failed viewport capture does not discard its successful sibling, and
   retry replaces only the failed attempt.

## Dogfood scenarios

Pinata captures and annotates its own requirements hub. The dogfood URL
array, in order:

1. `/reqs`
2. `/reqs/architecture`
3. `/reqs/milestones`
4. `/reqs/decisions`
5. `/reqs/evals`

Representative scenarios:

1. Navigate the hub from the landing page without typing a URL; every route
   refreshes cleanly; an unknown `/reqs/*` address lands on a bounded 404
   with a working link home.
2. Decision cards match `docs/decisions/decisions.json` exactly, including
   provenance quotes and supersession links — there is no second decision
   dataset.
3. Capture the five routes above as a Pinata project and annotate a
   requirement from inside Pinata itself.
4. Hostile markup or unsafe links in a document render inert; external links
   identify their destination and withhold the referrer.
5. The hub stays usable at phone width, at 320 CSS pixels with 200% zoom, and
   with reduced motion preferred, with no horizontal scrolling of the page.

## Role and thread scenarios

1. A founder link opens a read/reply-only view; editing controls are absent
   visually and to assistive technology.
2. Founder replies and editor follow-ups interleave chronologically and
   cannot be edited or deleted by anyone, enforced below the application by
   database triggers.
3. Rotating a link invalidates the old link and every old session; revoking
   ends access without deleting project history.
4. A stale reply composed before logout, rotation, or revocation is rejected
   and adds nothing.

## Published boundaries

Every runtime boundary is exported exactly once from `src/lib/boundaries/`
(policy version `2026-09-08.4`, constant `POLICY_VERSION`). Unit tests import
the same constants and compare them against this page, `docs/ARCHITECTURE.md`,
and the deployed `/reqs` routes; any drift between code, docs, and deployed
content fails the gate, and duplicating one of these literals anywhere else in
the application is a defect.

| Constant | Value | Policy |
| --- | --- | --- |
| `POLICY_VERSION` | 2026-09-08.4 | Dated catalog version; bumps on any boundary change. |

### Editor session

| Constant | Value | Policy |
| --- | --- | --- |
| `EDITOR_SESSION_ABSOLUTE_LIFETIME_MS` | 43,200,000 ms (12 hours) | A session is never valid past its absolute expiry. |
| `EDITOR_SESSION_RENEWAL_THRESHOLD_MS` | 7,200,000 ms (2 hours) | Renewal is allowed only when the remaining lifetime is inside this threshold; a renewal sets a fresh absolute expiry. |
| `AUTH_REQUEST_MAX_BYTES` | 1,024 bytes | Login/logout request bodies larger than this are rejected before parsing. |
| `EDITOR_PASSWORD_MAX_CHARS` | 256 | The password field accepts at most this many characters. |

### URL and input limits

| Constant | Value | Policy |
| --- | --- | --- |
| `MAX_SUBMITTED_URL_ROWS` | 32 | Rows beyond the limit are rejected before any normalization or persistence. |
| `MAX_UNIQUE_PAGE_URLS` | 16 | Unique normalized page URLs retained per project. |
| `MAX_URL_BYTES` | 2,048 bytes | Per submitted row, measured as UTF-8. |
| `BLANK_URL_ROW_POLICY` | ignore | Blank optional array rows are ignored; the root URL is always required. |
| `PROJECT_REQUEST_MAX_BYTES` | 69,632 bytes | Project-create bodies larger than this are rejected before parsing. |
| `PROJECT_TITLE_MAX_CHARS` | 120 | Longest accepted project title; blank defaults to the root host. |
| `IDEMPOTENCY_KEY_MIN_CHARS` | 8 | Shortest accepted mutation idempotency key. |
| `IDEMPOTENCY_KEY_MAX_CHARS` | 128 | Longest accepted mutation idempotency key. |

### URL normalization fixtures

Normalization trims surrounding whitespace, rejects rows over
`MAX_URL_BYTES`, then parses once with WHATWG `URL`, lowercases scheme and
host, converts IDNA hosts to punycode, strips a single trailing host dot,
removes the default `:443` port and the fragment, resolves dot segments,
treats backslashes as path separators, drops an empty query, and turns an
empty path into `/`. Path case, percent-encoding (so `%7E` and `~`, and
encoded separators such as `%2F`, stay distinct), and query order/duplicates
are preserved. Canonicalization happens before any address check, so every IP
literal — including numeric spellings and private, link-local, carrier-grade,
multicast, and metadata addresses — is rejected as `ip-literal`, while hosts
that cannot exist publicly (single-label names and the reserved `localhost`,
`local`, `internal`, `intranet`, `home.arpa`, `invalid`, `test`, and `onion`
suffixes) are rejected as `not-public`. Public cross-origin HTTPS rows are
allowed. These exact fixtures pin the behavior:

| Fixture | Input | Expected |
| --- | --- | --- |
| scheme-and-host-are-lowercased | `HTTPS://EXAMPLE.COM/Pricing` | `https://example.com/Pricing` |
| empty-path-becomes-root | `https://example.com` | `https://example.com/` |
| default-port-443-removed | `https://example.com:443/pricing` | `https://example.com/pricing` |
| non-443-port-rejected | `https://example.com:8443/` | `reject: port` |
| fragment-removed | `https://example.com/pricing#team` | `https://example.com/pricing` |
| query-order-and-duplicates-preserved | `https://example.com/pricing?ref=a&ref=b` | `https://example.com/pricing?ref=a&ref=b` |
| empty-query-dropped | `https://example.com/pricing?` | `https://example.com/pricing` |
| encoded-tilde-preserved | `https://example.com/%7Eme` | `https://example.com/%7Eme` |
| encoded-slash-preserved | `https://example.com/a%2fb` | `https://example.com/a%2fb` |
| idna-host-becomes-punycode | `https://bücher.example/` | `https://xn--bcher-kva.example/` |
| trailing-dot-stripped | `https://example.com./pricing` | `https://example.com/pricing` |
| backslash-treated-as-slash | `https://example.com\pricing` | `https://example.com/pricing` |
| dot-segments-resolved | `https://example.com/a/../b/./c` | `https://example.com/b/c` |
| trailing-slash-is-distinct | `https://example.com/pricing/` | `https://example.com/pricing/` |
| credentials-rejected | `https://user:pass@example.com/` | `reject: credentials` |
| http-scheme-rejected | `http://example.com/` | `reject: scheme` |
| ip-literal-rejected | `https://127.0.0.1/` | `reject: ip-literal` |
| numeric-ip-spelling-rejected | `https://2130706433/` | `reject: ip-literal` |
| ipv6-loopback-rejected | `https://[::1]/` | `reject: ip-literal` |
| relative-input-rejected | `/pricing` | `reject: relative` |
| blank-input-rejected | (blank) | `reject: blank` |
| surrounding-whitespace-trimmed | `  https://example.com/pricing  ` | `https://example.com/pricing` |
| cross-origin-https-allowed | `https://docs.example.org/guide` | `https://docs.example.org/guide` |
| unsupported-scheme-rejected | `javascript:alert(1)` | `reject: scheme` |
| localhost-rejected | `https://localhost/` | `reject: not-public` |
| single-label-host-rejected | `https://intranet/` | `reject: not-public` |
| private-range-literal-rejected | `https://10.0.0.5/` | `reject: ip-literal` |
| metadata-address-rejected | `https://169.254.169.254/latest/meta-data/` | `reject: ip-literal` |
| root-and-slash-are-one-page | `https://example.com` or `https://example.com/` | `https://example.com/` (same page) |

`/pricing` and `/pricing/` normalize to different pages; `https://example.com`
and `https://example.com/` normalize to the same page. Rejections happen
before any capture attempt or project row exists.

### Capture dimensions, time, and bytes

| Constant | Value | Policy |
| --- | --- | --- |
| `DESKTOP_VIEWPORT` | 1440 × 900 CSS px, DPR 1 | Desktop captures render at natural CSS-pixel dimensions. |
| `MOBILE_VIEWPORT` | 390 × 844 CSS px, DPR 1 | Mobile captures add a mobile user agent and touch emulation. |
| `MAX_DOCUMENT_HEIGHT_PX` | 16,384 px | Taller documents fail as `document-too-tall`. |
| `MAX_DOCUMENT_PIXELS` | 25,000,000 px | Larger documents fail as `too-many-pixels`. |
| `MAX_IMAGE_BYTES` | 8,388,608 bytes (8 MiB) | Larger screenshots fail as `image-bytes-exceeded`. |
| `MAX_PROVIDER_RESPONSE_BYTES` | 16,777,216 bytes (16 MiB) | Larger provider responses fail as `provider-bytes-exceeded`. |
| `NAVIGATION_TIMEOUT_MS` | 30,000 ms | Per-navigation budget; exceeding it fails as `navigation-timeout`. |
| `NETWORK_IDLE_TIMEOUT_MS` | 5,000 ms | Post-navigation network-idle budget. |
| `LAZY_SCROLL_STEP_PX` | 800 px | Lazy-loading scroll increment. |
| `LAZY_SCROLL_MAX_STEPS` | 24 | Enough steps to reach the bottom of a maximum-height page. |
| `LAZY_SCROLL_STEP_DELAY_MS` | 250 ms | Settle delay per scroll step. |
| `TOTAL_CAPTURE_TIMEOUT_MS` | 90,000 ms | Whole-capture deadline, inside the provider's 120-second session cap; exceeding it fails as `total-timeout`. |
| `MAX_REDIRECT_HOPS` | 5 | Every hop is revalidated under the same public-HTTPS rules. |

### Capture attempts, concurrency, and staleness

| Constant | Value | Policy |
| --- | --- | --- |
| `MAX_CAPTURE_ATTEMPTS_PER_PROJECT` | 64 | Initial attempts plus retries; a maximum-size project starts with 32. |
| `MAX_ACTIVE_CAPTURES` | 2 | Matches the Browserless free-tier concurrency limit; dispatch beyond it fails as `quota-exceeded`. |
| `STALE_CAPTURE_AGE_MS` | 300,000 ms (5 minutes) | A `capturing` attempt older than this computes to stale and becomes retryable. |
| `CAPTURE_REQUEST_MAX_BYTES` | 1,024 bytes | Hard cap on a capture mutation body, enforced before parsing. |

### DOM manifest schema

| Constant | Value | Policy |
| --- | --- | --- |
| `MANIFEST_SCHEMA_VERSION` | 1 | Persisted per capture as `dom_manifest_version`. |
| `MAX_MANIFEST_ELEMENTS` | 500 | Overflow keeps the capture ready with a `manifest-truncated` warning. |
| `MAX_MANIFEST_BYTES` | 262,144 bytes (256 KiB) | Exact persisted UTF-8 JSON size; never exceeded. |
| `MANIFEST_TEXT_MAX_CHARS` | 120 | Short visible text per element. |
| `MANIFEST_ACCESSIBLE_NAME_MAX_CHARS` | 120 | Accessible name per element. |
| `MANIFEST_MAX_CLASSES` | 8 | Bounded class hints per element. |
| `MANIFEST_PATH_MAX_DEPTH` | 12 | Structural-path segments per element. |
| `MANIFEST_RECT_DECIMALS` | 2 | Decimal places on document-space rectangle coordinates. |
| `MANIFEST_ELEMENT_KEYS` | id, kind, tag, role, text, accessibleName, hints, path, rect | The exact element key set; no other keys may appear. |
| `MANIFEST_HINT_KEYS` | id, classes, alt, title, testId | The exact hint key set. |
| `MANIFEST_ELEMENT_KINDS` | landmark, heading, link, control, image, table-cell, details, summary, text | The bounded element-kind enum. |

### Supported motion and tolerances

Capture freezes or pauses what it safely can from the same stabilized layout
state as the screenshot, and warns on the rest:

| Case | Policy |
| --- | --- |
| CSS animations | frozen |
| CSS transitions | frozen |
| Text carets | hidden |
| Web Animations API | paused |
| Video elements | paused |
| Animated images (GIF/APNG/WebP) | first-frame |
| Canvas/JS-driven animation | unsupported-warn |
| Sticky/parallax layers | as-rendered |

| Constant | Value | Policy |
| --- | --- | --- |
| `MOTION_ANCHOR_TOLERANCE_CSS_PX` | 1 px | Anchor geometry must survive stabilization within one CSS pixel. |
| `MOTION_MASKED_MAX_DIFF_RATIO` | 0.001 | At most 0.1% of pixels in a masked deterministic region may differ. |

### Capture outcome catalog

Every capture outcome maps to exactly one row: its persisted status, whether
retry is offered, the HTTP status of the API response (`—` marks a computed
or persisted state rather than a response), whether it consumes a persisted
attempt, and whether it surfaces as a warning on a ready capture. Public
messages and remediation text live in the catalog and are bounded by
`MAX_PUBLIC_MESSAGE_BYTES` | 256 bytes.

| Code | Status | Retryable | HTTP | Consumes attempt | Warning |
| --- | --- | --- | --- | --- | --- |
| invalid-url | failed | no | 422 | no | no |
| dns-failed | failed | yes | 502 | yes | no |
| unsafe-redirect | failed | no | 422 | yes | no |
| browserless-auth | failed | no | 502 | yes | no |
| browserless-provider | failed | yes | 502 | yes | no |
| navigation-timeout | failed | yes | 504 | yes | no |
| total-timeout | failed | yes | 504 | yes | no |
| document-too-tall | failed | no | 422 | yes | no |
| too-many-pixels | failed | no | 422 | yes | no |
| provider-bytes-exceeded | failed | yes | 502 | yes | no |
| image-bytes-exceeded | failed | no | 422 | yes | no |
| invalid-image | failed | yes | 502 | yes | no |
| quota-exceeded | failed | yes | 429 | no | no |
| blob-failure | failed | yes | 502 | yes | no |
| finalization-failure | failed | yes | 502 | yes | no |
| stale-lease | failed | yes | — | yes | no |
| cleanup-pending | ready | no | — | yes | yes |
| manifest-truncated | ready | no | — | yes | yes |

### Geometry minimums

| Constant | Value | Policy |
| --- | --- | --- |
| `MIN_SHAPE_SIZE_PX` | 8 px | Minimum rectangle/circle extent in screenshot-natural pixels; circles stay square. |
| `MIN_ARROW_LENGTH_PX` | 16 px | Minimum arrow start-to-end distance in screenshot-natural pixels. |

### Login and reply quotas

Both quotas are enforced in the durable store, so they hold across tabs and
application instances, and both recover after exactly the published window.

| Constant | Value | Policy |
| --- | --- | --- |
| `LOGIN_MAX_FAILURES` | 5 | Failed editor logins allowed per window before generic throttling. |
| `LOGIN_WINDOW_MS` | 900,000 ms (15 minutes) | Login throttle window and recovery interval. |
| `REPLY_MAX_PER_WINDOW` | 30 | Founder replies accepted per window. |
| `REPLY_WINDOW_MS` | 3,600,000 ms (1 hour) | Reply rate-limit window and recovery interval. |

Login enforcement semantics: failed editor logins are counted in one shared
`rate_limit_buckets` row keyed by the SHA-256 digest of the `editor-login`
scope — never a password, secret, or client identifier — so the threshold
holds for the single editor credential across tabs and application instances.
The window is fixed at the first failure in the window; throttled attempts
receive the same generic `429` with a bounded `Retry-After` header and never
extend the window. A correct attempt succeeds immediately once
`window_started_at + LOGIN_WINDOW_MS` has passed, and a successful login
clears the bucket.

### Feedback, annotation, and interaction limits

| Constant | Value | Policy |
| --- | --- | --- |
| `FEEDBACK_BODY_MAX_CHARS` | 2,000 | Shared maximum length of an original comment or a thread reply. |
| `MAX_ANNOTATIONS_PER_CAPTURE` | 200 | Persisted annotations per capture, across all kinds. |
| `NEARBY_CANDIDATES_MAX` | 8 | Nearby DOM candidates offered when placing a mark. |
| `CLIENT_REQUEST_TIMEOUT_MS` | 15,000 ms | Every client request reaches a terminal state within this budget. |
| `MIN_HIT_TARGET_CSS_PX` | 24 px | Shared minimum pointer/touch hit target (WCAG 2.2 AA, 2.5.8). |

### Performance protocol and budgets

| Constant | Value | Policy |
| --- | --- | --- |
| `PERFORMANCE_PROTOCOL` | 3 measured runs, Chromium, desktop viewport, 16 GB RAM / 10 logical cores, maximum-dimension fixture annotated to the per-capture annotation maximum, evenly by kind and height | The fixed measurement protocol; every run must pass every budget. |
| `PERF_IMAGE_TO_USABLE_P95_MS` | 3,000 ms | p95 from image response to a usable canvas. |
| `PERF_PAN_ZOOM_CYCLES` | 60 | Pan/zoom cycles per run. |
| `PERF_SELECTION_CYCLES` | 100 | Selection cycles per run. |
| `PERF_INPUT_TO_PAINT_P95_MS` | 100 ms | p95 input-to-paint latency during the cycles. |
| `PERF_LONGEST_TASK_MS` | 200 ms | Longest allowed main-thread task. |
| `PERF_RETAINED_HEAP_MAX_BYTES` | 268,435,456 bytes (256 MiB) | Post-GC retained heap ceiling. |
| `PERF_DETACHED_NODES_MAX` | 25 | Detached DOM nodes tolerated after GC. |
| `PERF_CAMERA_REQUEST_BUDGET` | 0 | Camera cycles issue zero annotation writes and no increasing reads. |

## Quality attributes under test

- Warm, playful, focused design; the whole product demos live in under a
  minute.
- No horizontal page overflow, clipped controls, or hover-only content at any
  supported width.
- Keyboard-operable controls with visible focus; reduced-motion preference
  respected.
- Bounded, actionable error states that never leave silent partial project
  state.
- No application secret or founder capability in any public response, asset,
  log, or committed file.
