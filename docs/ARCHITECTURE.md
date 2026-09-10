# Pinata architecture

This is the product architecture source, rendered live at
`/reqs/architecture`. It summarizes the authoritative mission architecture;
[Requirements](/reqs) covers scope, [Decisions](/reqs/decisions) records why
each choice was made.

Build status (2026-09-10): every section describes the current build except
the rectangle, circle, and arrow nodes under "Canvas and coordinates", which
stay deferred (D051) with the schema already carrying their `kind` column. The
founder role and threads shipped on 2026-09-10 (D073), and the deployment is
publicly reachable rather than behind Vercel SSO (D074).

## System shape

Pinata is a Next.js web application with two roles and three external
services. The browser never receives infrastructure credentials; server route
handlers and data-access functions authorize every operation.

```text
Lucas browser ─┐
               ├─> Next.js on Vercel ──> Turso/libSQL (metadata)
Founder browser┘          │
                          ├─────────────> private Vercel Blob (screenshots)
                          └─────────────> Browserless Function API
                                            └─> public HTTPS target
```

## Technology stack

| Concern | Choice |
| --- | --- |
| Runtime | Node 24 everywhere (local, CI, Vercel) |
| Application | Next.js App Router, React, TypeScript |
| Canvas | `@xyflow/react` (React Flow, MIT) |
| Metadata database | Turso/libSQL via `@libsql/client`, Drizzle schema and migrations |
| Screenshot storage | Private Vercel Blob |
| Capture | Browserless Function API, one fresh session per URL and viewport |
| Boundary validation | Zod plus dedicated URL/IP validation |
| Tests | Vitest + jsdom + React Testing Library; Playwright Chromium e2e |
| Runtime AI | None |

The single quality gate is `npm run validate`: lint and repository integrity,
typecheck, Vitest suites, deterministic docs check, production build, then
Playwright e2e — in that order, locally and in GitHub Actions.

## Roles and authorization

- **Editor.** Lucas logs in with one password prompt. The server compares the
  submission against `EDITOR_PASSWORD` with a timing-safe comparison and
  issues a session signed with `SESSION_SECRET`: `HttpOnly`, `Secure` when
  deployed, `SameSite=Strict`, path `/`, short-lived but renewable. Every
  editor mutation rechecks the session close to the data access.
- **Founder.** A high-entropy project capability (at least 256 random bits)
  arrives in the URL fragment, is exchanged once through a same-origin POST,
  and lives on as a secure capability-session cookie. Turso stores only its
  SHA-256 digest. The link persists until Lucas rotates or revokes it; the
  founder display label is always the literal `founder`.
- **Threads.** The editor owns the one editable original comment per
  annotation. Everything after that is an append-only `thread_entries` row
  authored by `editor` or `founder`. Database triggers reject `UPDATE` and
  `DELETE`; tombstoning an annotation never mutates its entries.

## Core data model

Text UUID/ULID keys and UTC timestamps, with committed repeatable migrations:

| Table | Holds |
| --- | --- |
| `projects` | title, root URL, public ID, share-token digest/version/revocation |
| `pages` | requested and normalized URL, per-project order; unique `(project_id, normalized_url)` |
| `captures` | one row per page/viewport attempt: status, viewport, document dimensions, Blob path, hash, manifest, error fields |
| `annotations` | kind (pin/rectangle/circle/arrow), versioned geometry, original body, optional element snapshot |
| `thread_entries` | append-only replies with actor role, server label, idempotency key |

A successful capture is immutable. Retrying produces a new capture version;
old annotations stay bound to their original capture, image hash, and
dimensions, and are never silently remapped.

## Capture pipeline

Each capture handles exactly one URL and one viewport, with at most two
active captures at a time (the Browserless free-tier concurrency limit).
Status is persisted before provider work starts, so partial failures are
visible and retryable.

The server schedules nothing itself: the editor client drives committed
pending attempts through the scoped dispatch route — on load, after project
creation or retry, and on every poll tick that still finds pending work
(`D049`). The driver keeps at most `MAX_ACTIVE_CAPTURES` dispatches in
flight; a quota-exceeded answer leaves the attempt pending and defers it for
one re-drive delay, so the polling loop re-drives it as slots free, and a
terminal catalog outcome is surfaced by the next hierarchy read and never
re-driven.

1. Revalidate the normalized public HTTPS URL on the server: no credentials,
   no IP literals, no non-443 ports, no private, loopback, link-local,
   reserved, or metadata destinations — by parser and by DNS answers.
2. Call the fixed Browserless Function endpoint with the token in an
   authorization header — HTTP basic, the token as the username, because the
   provider gateway rejects a bearer credential and this project will not put
   a credential in a URL (`D036`). User input is context data, never
   interpolated code.
3. Configure viewport and reduced motion, navigate with bounded waits.
4. Incrementally scroll to trigger lazy content, return to top, wait for
   fonts and two animation frames.
5. Inject capture-only CSS that pauses animation and hides carets without
   altering layout.
6. Collect at most 500 useful visible semantic elements within a 256 KiB
   manifest — no HTML source, cookies, storage, form values, hidden text, or
   cross-origin iframe internals.
7. Capture one full-page image from the same stabilized state, enforcing
   height, pixel, byte, and timeout budgets.
8. Decode the returned bytes before believing them: an allowlisted declared
   content type, a container that really is that format, dimensions equal to
   the measured document, and a SHA-256 over the exact bytes to be stored.
9. Upload to private Blob, persist metadata, and mark the capture ready. On
   error, keep an actionable failed record and clean up orphaned objects.

Every redirect hop is revalidated under the same rules before following it.

Steps 1 through 9 all happen inside the dispatch request. An admitted attempt
is claimed, captured, and finalized before the response is written, so no
attempt is ever left as an open `capturing` claim waiting for a second call
(`D035`).

## Published runtime boundaries

The capture pipeline, session policy, and every other runtime limit are
exported once from `src/lib/boundaries/` (policy version
`2026-09-09.2`, constant `POLICY_VERSION`) and drift-checked against this
document and the [Evals catalog](/reqs/evals), which publishes the complete
set — URL fixtures, manifest bounds, motion matrix, outcome catalog, geometry
minimums, quotas, interaction limits, and performance budgets.

| Constant | Value | Policy |
| --- | --- | --- |
| `POLICY_VERSION` | 2026-09-09.2 | Dated catalog version; bumps on any boundary change. |
| `EDITOR_SESSION_ABSOLUTE_LIFETIME_MS` | 43,200,000 ms (12 hours) | Editor sessions are never valid past absolute expiry. |
| `EDITOR_SESSION_RENEWAL_THRESHOLD_MS` | 7,200,000 ms (2 hours) | Renewal only when remaining lifetime is inside this threshold. |
| `AUTH_REQUEST_MAX_BYTES` | 1,024 bytes | Auth request bodies larger than this are rejected before parsing. |
| `EDITOR_PASSWORD_MAX_CHARS` | 256 | Password field length cap. |
| `DESKTOP_VIEWPORT` | 1440 × 900 CSS px, DPR 1 | Standard desktop capture. |
| `MOBILE_VIEWPORT` | 390 × 844 CSS px, DPR 1 | Standard mobile capture with mobile UA and touch emulation. |
| `MAX_DOCUMENT_HEIGHT_PX` | 16,384 px | Taller documents fail boundedly. |
| `MAX_DOCUMENT_PIXELS` | 25,000,000 px | Larger documents fail boundedly. |
| `MAX_IMAGE_BYTES` | 8,388,608 bytes (8 MiB) | Maximum accepted screenshot size. |
| `ALLOWED_IMAGE_CONTENT_TYPES` | image/png, image/webp | Storable screenshot types; the first is what capture produces. |
| `MAX_PROVIDER_RESPONSE_BYTES` | 16,777,216 bytes (16 MiB) | Maximum accepted Browserless response size. |
| `NAVIGATION_TIMEOUT_MS` | 30,000 ms | Per-navigation budget. |
| `NETWORK_IDLE_TIMEOUT_MS` | 5,000 ms | Post-navigation network-idle budget. |
| `LAZY_SCROLL_STEP_PX` | 800 px | Lazy-loading scroll increment. |
| `LAZY_SCROLL_MAX_STEPS` | 24 | Reaches the bottom of a maximum-height page. |
| `LAZY_SCROLL_STEP_DELAY_MS` | 250 ms | Settle delay per scroll step. |
| `TOTAL_CAPTURE_TIMEOUT_MS` | 90,000 ms | Whole-capture deadline, inside the provider's 120-second session cap. |
| `MAX_REDIRECT_HOPS` | 5 | Redirect hops revalidated before failure. |
| `DNS_TIMEOUT_MS` | 3,000 ms | Per-query DNS budget; exceeding it fails closed. |
| `MAX_CNAME_HOPS` | 8 | CNAME hops followed before the chain is refused. |
| `REDIRECT_PROBE_TIMEOUT_MS` | 5,000 ms | Per-hop budget for the redirect preflight. |
| `MAX_CAPTURE_ATTEMPTS_PER_PROJECT` | 64 | Persisted attempts per project, initial plus retries. |
| `MAX_ACTIVE_CAPTURES` | 2 | The Browserless free-tier concurrency limit, enforced by durable lease slots in Turso. |
| `STALE_CAPTURE_AGE_MS` | 300,000 ms (5 minutes) | A `capturing` attempt older than this computes to stale; its concurrency lease expires at the same age. |
| `CAPTURE_CLEANUP_WINDOW_MS` | 3,600,000 ms (1 hour) | Orphan-cleanup retry window; the obligation to delete never expires. |
| `CAPTURE_REQUEST_MAX_BYTES` | 1,024 bytes | Hard cap on a capture mutation body, enforced before parsing. |
| `CAPTURE_POLL_INITIAL_INTERVAL_MS` | 2,000 ms | First capture-progress poll delay. |
| `CAPTURE_POLL_MAX_INTERVAL_MS` | 10,000 ms | Capture-progress poll backoff ceiling. |
| `CAPTURE_POLL_DEADLINE_MS` | 600,000 ms (10 minutes) | Polling stops here; longer than the stale age, so abandonment is observed as stale first. |
| `ASSET_CACHE_CONTROL` | private, no-store, max-age=0 | Every private-asset response; no browser or intermediary may retain bytes after authority ends. |
| `ASSET_VARY` | Cookie | Asset authorization rides on the Cookie header, so caches must key on it. |
| `ASSET_RANGE_UNIT` | bytes | The asset route serves one explicit-start byte range; suffix and multi-range requests are rejected. |
| `MANIFEST_SCHEMA_VERSION` | 1 | Persisted per capture as `dom_manifest_version`. |
| `MAX_MANIFEST_ELEMENTS` | 500 | Element cap; overflow truncates with a warning. |
| `MAX_MANIFEST_BYTES` | 262,144 bytes (256 KiB) | Exact persisted manifest size cap. |

## Canvas and coordinates

The React Flow instance is controlled; application domain records are
canonical and raw canvas state is never persisted. Each capture is its own
coordinate plane rendered at natural screenshot dimensions:

- pins are child nodes whose stored coordinate is the pin tip in
  screenshot-natural CSS pixels;
- rectangles and circles are resizable child nodes clamped to the frame
  (deferred, D051);
- arrows are straight edges between two draggable endpoint nodes (deferred,
  D051);
- desktop and mobile planes are fully independent;
- pan, zoom, and browser resizing never change persisted geometry.

When the editor places a mark, nearby manifest elements are ranked by
containment, distance, area, depth, and semantic value; the editor explicitly
chooses one candidate or "no element", and the chosen snapshot is stored with
the annotation.

## Security boundaries

- Server-only environment access; no `NEXT_PUBLIC_*` credentials.
- Strict CSP, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, and
  no indexing on founder capability pages.
- Source-site HTML is never rendered unsanitized; comments are plain text
  rendered through React escaping.
- Private Blob paths resolve only after editor or project-capability checks.
  The asset route (`GET`/`HEAD` `/api/captures/<captureId>/asset`) never
  redirects to or names the provider, revalidates stored bytes against the
  persisted type, length, and SHA-256 before serving, supports one explicit
  byte range plus `If-None-Match`/`If-Modified-Since` conditionals, and
  answers every unauthorized or unresolvable request with the same bounded
  generic denial carrying no bytes.
- Login and reply routes use durable throttling and generic error messages.
- These requirements pages render Markdown with raw HTML disabled and an
  allow-listed set of link schemes.

## Deployment

Vercel project `pinata` on Node 24, with `BROWSERLESS_TOKEN`,
`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BLOB_READ_WRITE_TOKEN`,
`EDITOR_PASSWORD`, and `SESSION_SECRET` set per environment. Local development
always runs on `127.0.0.1:3100`; port 3000 is off-limits. GitHub Actions runs
the same `npm run validate` gate.
