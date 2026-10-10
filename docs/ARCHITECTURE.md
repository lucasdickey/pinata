# Pinata architecture

This is the product architecture source, rendered live at
`/reqs/architecture`. It summarizes the authoritative mission architecture;
[Requirements](/reqs) covers scope, [Decisions](/reqs/decisions) records why
each choice was made.

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
  deployed, `SameSite=Strict`, path `/`. It lasts 7 days and renews once a
  day old, so the editor signs in again only after a week away (D130). Every
  editor mutation rechecks the session close to the data access.
- **Chrome extension (D132).** The extension signs in with the same password
  through `POST /api/extension/session`, behind the login route's throttle,
  and gets a bearer token instead of a cookie: the same HMAC over
  `SESSION_SECRET` with its own version prefix and audience, so it never
  verifies as a cookie session and a cookie never verifies as it. It lives
  in the extension's storage, rides in the `Authorization` header (which no
  browser attaches on its own, so it needs no CSRF proof), follows the
  session's 7-day policy, and comes back renewed in the `x-pinata-token`
  response header. It opens only the extension's routes: its sign-in check,
  the projects list, and the capture import.
- **Founder.** A high-entropy project capability (at least 256 random bits)
  arrives in the URL fragment, is exchanged once through a same-origin POST,
  and lives on as a secure capability-session cookie. Turso stores only its
  SHA-256 digest. The link persists until Lucas rotates or revokes it; the
  founder display label is always the literal `founder`.
- **Agent link (D121).** A second, separate project secret with the same
  shape (256 random bits, only the SHA-256 digest stored, rotate and revoke)
  that opens a read-only Markdown brief of the project's open marks at
  `/a/<token>`, with each screenshot at `/a/<token>/captures/<captureId>`.
  The token is in the path because an agent fetches a plain URL and cannot
  read a fragment; in exchange, the link can only read, and every answer is
  `no-store`, `noindex`, and `no-referrer`. It never touches the founder
  link.
- **Threads.** The editor owns the one editable original comment per
  annotation. Everything after that is an append-only `thread_entries` row
  authored by `editor` or `founder`. Database triggers reject `UPDATE` and
  `DELETE`; tombstoning an annotation never mutates its entries.

## Core data model

Text UUID/ULID keys and UTC timestamps, with committed repeatable migrations:

| Table | Holds |
| --- | --- |
| `projects` | title, root URL, public ID, share-token and agent-token digest/version/revocation |
| `pages` | requested and normalized URL, per-project order; unique `(project_id, normalized_url)` |
| `captures` | one row per page/viewport attempt: status, origin (`manual`, `automatic`, or `upload`), viewport, document dimensions, Blob path, hash, manifest, error fields |
| `annotations` | kind (pin/rectangle/circle/arrow), versioned geometry, original body, optional element snapshot, and for a box or circle up to four more element snapshots |
| `thread_entries` | append-only replies with actor role, server label, idempotency key |

A successful capture is immutable. Retrying produces a new capture version;
old annotations stay bound to their original capture, image hash, and
dimensions, and are never silently remapped.

## Capture pipeline

Each capture handles exactly one URL and one viewport, with at most two
active captures at a time (the Browserless free-tier concurrency limit).
Status is persisted before provider work starts, so partial failures are
visible and retryable.

The server drives capture itself (`D076`). Project creation and the scoped
retry commit pending attempts, answer, and then continue after the response
is written (Next.js `after()`): `driveProject` hands the project's next
pending attempts — at most `MAX_ACTIVE_CAPTURES` — to `driveCapture`, which
runs the admit, claim, execute, finalize, release sequence below, and every
finalization schedules the project's next pending attempt the same way, so a
project chains to completion with no browser open. The durable lease table
stays the only concurrency authority: a claim that finds every slot held
leaves the attempt pending and stops.

Two things follow a finalization. When the attempt failed with an outcome
the catalog marks retryable, or the sweep found it stale, exactly one
automatic retry is created through the same path a manual retry uses,
recorded as a new attempt with `origin = automatic` and never retried
automatically again (`MAX_AUTOMATIC_CAPTURE_RETRIES`, inside the project-wide
attempt cap); a second failure surfaces its catalog reason and a
project-level Retry control. And the hierarchy read reports per-project
progress from the same rows — devices done, failed, and in progress, the page
capturing now, and an estimate from the median duration of this project's
finished attempts (`started_at`/`finished_at` on the attempt row) — which the
workspace shows as one line above the selected capture.

Two backstops cover a continuation that never ran or died mid-way. The
editor client keeps its dispatch driver (`D049`) as a fallback re-driver: on
load and on every poll tick it dispatches whatever is still pending through
the scoped dispatch route, and when it races the server on the same attempt
the fenced claim answers one of them 409, which the driver treats as a
conflict (one re-read, one deferral, no retry storm). And
`/api/captures/sweep`, protected by a shared secret (`CAPTURE_SWEEP_SECRET`
header or the Vercel cron bearer `CRON_SECRET`; 404 when neither is set),
re-drives every project with pending or stale attempts and creates the
automatic retry for stale ones; `vercel.json` calls it once a day as a cron
backstop. Function duration on the deployment must cover one capture plus
its preflight and the continuation that follows: the dispatch, create, retry,
and sweep routes export `maxDuration = 300`. For local and test use only,
`PINATA_SERVER_CAPTURE=off` turns the continuation and the sweep's re-drive
off while the dispatch route keeps working, so the client fallback driver is
the only thing dispatching; the Playwright server runs that way, and the
variable is never set on a deployment.

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

Steps 1 through 9 all happen inside one `driveCapture` run, whether a
dispatch request or a server continuation started it. An admitted attempt is
claimed, captured, and finalized before that run ends, so no attempt is ever
left as an open `capturing` claim waiting for a second call (`D035`).

## Uploaded captures

Pinata's own capture only visits public pages. A screen behind a sign-in, on
a staging host, or on the editor's own machine arrives as an upload instead
(D131): the Chrome extension in `extension/` captures the page in the
editor's own, signed-in browser, or the editor uploads a plain image.

The extension drives the tab through the Chrome DevTools Protocol
(`chrome.debugger`), the way the provider drives its browser: it emulates
the Desktop and Mobile viewports at DPR 1, scrolls once for lazy content,
disables animation, runs the provider's own element pass
(`MANIFEST_INSPECT_SOURCE` with the same limits, copied into
`extension/shared.generated.js` and drift-checked by a test), and takes one
full-page WebP screenshot of exactly the document that pass measured. Then
it restores the tab. It either sends each device to Pinata ("Send to
Pinata") or saves a `.pinata.json` capture file ("Download file") for the
upload form; a failed send saves the file instead.

`POST /api/imports` files one device per request: a `multipart/form-data`
body with a `meta` JSON part and an `image` part, capped at
`UPLOAD_REQUEST_MAX_BYTES` while it is read, from the editor's page (session,
CSRF proof, same origin) or the extension's bearer token. The image passes
the same structural decode as a provider screenshot and its pixels must
equal the document size the upload names; the element list goes through the
provider envelope's schema and the same server-side bounding. The image is
stored privately first, then one transaction writes the idempotency record,
a new project or page if the upload makes one, and the capture as the next
ready attempt with `origin = upload`. An upload's address only files it
under a page (D134); nothing fetches it, and an uploaded capture is never
offered a provider retry — its next version is another upload.

## Published runtime boundaries

The capture pipeline, session policy, and every other runtime limit are
exported once from `src/lib/boundaries/` (policy version
`2026-10-10.1`, constant `POLICY_VERSION`) and drift-checked against this
document and the [Evals catalog](/reqs/evals), which publishes the complete
set — URL fixtures, manifest bounds, motion matrix, outcome catalog, geometry
minimums, quotas, interaction limits, and performance budgets.

| Constant | Value | Policy |
| --- | --- | --- |
| `POLICY_VERSION` | 2026-10-10.1 | Dated catalog version; bumps on any boundary change. |
| `EDITOR_SESSION_ABSOLUTE_LIFETIME_MS` | 604,800,000 ms (7 days) | Editor and extension sessions are never valid past absolute expiry. |
| `EDITOR_SESSION_RENEWAL_THRESHOLD_MS` | 518,400,000 ms (6 days) | Renewal only when remaining lifetime is inside this threshold; a session a day old renews. |
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
| `CAPTURE_INVOCATION_MAX_DURATION_MS` | 300,000 ms (5 minutes) | One capture-running invocation's lifetime; equals every capture route's `maxDuration`. |
| `CAPTURE_CONTINUATION_MARGIN_MS` | 60,000 ms | Reserve beyond one capture an invocation needs to start another; below it the chain hands off to a fresh invocation. |
| `MAX_REDIRECT_HOPS` | 5 | Redirect hops revalidated before failure. |
| `DNS_TIMEOUT_MS` | 3,000 ms | Per-query DNS budget; exceeding it fails closed. |
| `MAX_CNAME_HOPS` | 8 | CNAME hops followed before the chain is refused. |
| `REDIRECT_PROBE_TIMEOUT_MS` | 5,000 ms | Per-hop budget for the redirect preflight. |
| `MAX_CAPTURE_ATTEMPTS_PER_PROJECT` | 64 | Persisted attempts per project, initial plus retries. |
| `MAX_ACTIVE_CAPTURES` | 2 | The Browserless free-tier concurrency limit, enforced by durable lease slots in Turso. |
| `MAX_AUTOMATIC_CAPTURE_RETRIES` | 1 | Automatic retries in a row per page device after a retryable failure or a stale attempt; after that a person retries. |
| `STALE_CAPTURE_AGE_MS` | 300,000 ms (5 minutes) | A `capturing` attempt older than this computes to stale; its concurrency lease expires at the same age. |
| `CAPTURE_CLEANUP_WINDOW_MS` | 3,600,000 ms (1 hour) | Orphan-cleanup retry window; the obligation to delete never expires. |
| `CAPTURE_REQUEST_MAX_BYTES` | 1,024 bytes | Hard cap on a capture mutation body, enforced before parsing. |
| `CAPTURE_POLL_INITIAL_INTERVAL_MS` | 2,000 ms | First capture-progress poll delay. |
| `CAPTURE_POLL_MAX_INTERVAL_MS` | 10,000 ms | Capture-progress poll backoff ceiling. |
| `CAPTURE_POLL_DEADLINE_MS` | 600,000 ms (10 minutes) | Polling stops here; longer than the stale age, so abandonment is observed as stale first. |
| `ASSET_CACHE_CONTROL` | private, no-store, max-age=0 | Every private-asset response; no browser or intermediary may retain bytes after authority ends. |
| `ASSET_VARY` | Cookie | Asset authorization rides on the Cookie header, so caches must key on it. |
| `ASSET_RANGE_UNIT` | bytes | The asset route serves one explicit-start byte range; suffix and multi-range requests are rejected. |
| `UPLOAD_IMAGE_MAX_BYTES` | 4,000,000 bytes | Largest uploaded screenshot (D131). |
| `UPLOAD_REQUEST_MAX_BYTES` | 4,450,000 bytes | Hard cap on one upload request body, inside a Vercel Function's 4.5 MB. |
| `CAPTURE_PACKAGE_FORMAT` | pinata-capture | The `format` field of an extension capture file. |
| `CAPTURE_PACKAGE_VERSION` | 1 | The capture file version this build reads and writes. |
| `MANIFEST_SCHEMA_VERSION` | 1 | Persisted per capture as `dom_manifest_version`. |
| `MAX_MANIFEST_ELEMENTS` | 500 | Element cap; overflow truncates with a warning. |
| `MAX_MANIFEST_BYTES` | 262,144 bytes (256 KiB) | Exact persisted manifest size cap. |

## Canvas and coordinates

The React Flow instance is controlled; application domain records are
canonical and raw canvas state is never persisted. Each capture is its own
coordinate plane rendered at natural screenshot dimensions:

- pins are child nodes whose stored coordinate is the pin tip in
  screenshot-natural CSS pixels; a click on the screenshot drops one and a
  drag pans;
- rectangles are child nodes placed at exactly their persisted box
  (`{x, y, width, height}` in natural pixels, `geometry_version` 1). A drag
  with Shift held, or the next drag after the Box tool is armed, draws one
  from press to release; a saved box moves by its stroke or badge and
  resizes by eight handles, each gesture committing one revisioned write.
  Boxes are clamped to the frame and never smaller than `MIN_SHAPE_SIZE_PX`;
  the server rejects anything else;
- circles are the same child node under a square constraint
  (`{x, y, size}` in natural pixels, `geometry_version` 1, `size` both the
  width and the height of the bounding square): the renderer is an ellipse
  inscribed in that square, the drag's larger dimension sets the size so an
  off-square drag still yields a circle, and one drag governs both
  dimensions, so a circle offers its four corner handles and no edge
  handles. Everything else is the rectangle's: the badge at the bounding
  square's top-left, a pointer-transparent interior so a click inside still
  drops a pin, move by the stroke, one revisioned write per gesture, and the
  same minimum and frame clamp;
- every kind shares one number sequence per capture, and the founder's
  read-only plane renders them all with no handles, no drag, and no tools;
- arrows are the one mark with no area (`{start, end}` in natural pixels,
  `geometry_version` 1, at least `MIN_ARROW_LENGTH_PX` apart, both endpoints
  clamped inside the frame). The head is at `end`: that is where the arrow
  points, so that is what the mark is about. The press sets the tail and the
  release sets the head, and the two are never reordered. After a save each
  endpoint drags on its own and the shaft drags the whole arrow, each gesture
  committing one revisioned write. Because an arrow has no interior,
  selecting and moving it is a distance-to-segment test at
  `ARROW_HIT_TOLERANCE_CSS_PX` rather than a box test: a click near but off
  the line falls through to the screenshot and drops a pin. The badge rides
  at the tail so it never covers what is being pointed at, and the stroke and
  head scale with the zoom without the stored endpoints changing;
- desktop and mobile planes are fully independent;
- pan, zoom, and browser resizing never change persisted geometry.

The mark tools sit in one group under the camera controls: Box, Circle, and
Arrow, each arming exactly the next drag and disarming after it or on Escape,
with `B`, `C`, and `A` as their keys. A tool is a one-gesture arming, never a
mode, and Shift-drag stays the pointer shortcut for a box.

When the editor places a mark, nearby manifest elements are ranked and the
top result is pre-selected; the editor keeps or changes that choice, or picks
"no element", and the chosen snapshot is stored with the annotation. For a pin
the ranking is by containment of the tip, distance, area, depth, and semantic
value, and an arrow asks the same way from its head, so "move this into the
header" is filed under the header rather than under whatever the arrow
happened to start on top of. For a region — a rectangle's box, or a circle's
bounding square — it is by overlap: the share of each element inside the
region first (an enclosed element beats a partly covered one), then the
overlap area (the enclosed card beats its caption), then the same
tie-breakers. The caller picks the ranking by mark kind; the context route
serves both.

## Security boundaries

- Server-only environment access; no `NEXT_PUBLIC_*` credentials.
- Strict CSP, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, and
  no indexing on founder capability pages and on the agent link (`/a/`).
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
`EDITOR_PASSWORD`, and `SESSION_SECRET` set per environment, plus
`CRON_SECRET` (what Vercel cron sends the sweep) and optionally
`CAPTURE_SWEEP_SECRET` (for any other scheduler). Local development
always runs on `127.0.0.1:3100`; port 3000 is off-limits. GitHub Actions runs
the same `npm run validate` gate.
