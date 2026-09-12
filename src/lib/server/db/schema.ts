// Server-only Drizzle/libSQL schema (architecture.md section 5). This is the
// canonical persistence model: text UUID/ULID primary keys, UTC epoch-ms
// integer timestamps, explicit foreign keys, unique constraints, and checks.
//
// Migrations are committed under drizzle/ and applied with `npm run
// db:migrate`; never mutate the schema manually or via ORM push. The
// append-only `thread_entries` UPDATE/DELETE triggers live in a committed
// custom migration because Drizzle does not model triggers.
//
// Security invariants encoded here:
// - projects.share_token_digest stores only a SHA-256 digest, never a raw
//   capability token;
// - rate_limit_buckets.bucket_key is a SHA-256 digest of scope + identifier,
//   never a plaintext password or raw capability;
// - thread_entries has no updated_at/delete columns and database triggers
//   reject UPDATE and DELETE (VAL-THREAD-002).

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    /** Non-secret public locator used in stable founder routes. */
    publicId: text("public_id").notNull().unique(),
    title: text("title").notNull(),
    rootUrl: text("root_url").notNull(),
    /** SHA-256 hex digest of the active founder capability, never the token. */
    shareTokenDigest: text("share_token_digest").unique(),
    /** Monotonic capability version; rotation increments, sessions bind to it. */
    shareTokenVersion: integer("share_token_version").notNull().default(0),
    shareRevokedAt: integer("share_revoked_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
);

export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    requestedUrl: text("requested_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    /** Null until a capture completes. */
    title: text("title"),
    sortIndex: integer("sort_index").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    // URL fragments never create duplicate pages; explicit URL-array order is
    // preserved via sort_index.
    uniqueIndex("pages_project_normalized_url_unique").on(t.projectId, t.normalizedUrl),
    index("pages_project_sort_idx").on(t.projectId, t.sortIndex),
  ],
);

export const CAPTURE_VARIANTS = ["desktop", "mobile"] as const;
export type CaptureVariant = (typeof CAPTURE_VARIANTS)[number];

export const CAPTURE_STATUSES = ["pending", "capturing", "ready", "failed"] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

/**
 * Who asked for an attempt: `manual` for the initial attempts a project
 * submission commits and for a retry the editor pressed; `automatic` for the
 * one retry the server creates on its own after a retryable failure or a
 * stale attempt. An automatic attempt is never retried automatically again.
 */
export const CAPTURE_ORIGINS = ["manual", "automatic"] as const;
export type CaptureOrigin = (typeof CAPTURE_ORIGINS)[number];

export const captures = sqliteTable(
  "captures",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id),
    variant: text("variant").notNull(),
    /**
     * Monotonic per (page, variant) attempt number. A retry/recapture is a
     * new row, never a rewrite: a successful capture is immutable.
     */
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(),
    /** Mutation idempotency key, unique per (page, variant). */
    idempotencyKey: text("idempotency_key").notNull(),
    requestedUrl: text("requested_url").notNull(),
    finalUrl: text("final_url"),
    viewportWidth: integer("viewport_width").notNull(),
    viewportHeight: integer("viewport_height").notNull(),
    deviceScaleFactor: integer("device_scale_factor").notNull(),
    /** Null until ready. */
    documentWidth: integer("document_width"),
    documentHeight: integer("document_height"),
    /** Internal private-Blob reference; null until ready. Unique per attempt. */
    blobPath: text("blob_path").unique(),
    blobContentType: text("blob_content_type"),
    blobBytes: integer("blob_bytes"),
    /** SHA-256 hex of the exact stored image bytes. */
    imageHash: text("image_hash"),
    domManifestJson: text("dom_manifest_json"),
    domManifestVersion: integer("dom_manifest_version"),
    warningJson: text("warning_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    capturedAt: integer("captured_at"),
    /** `manual` or `automatic` (see CAPTURE_ORIGINS). */
    origin: text("origin").notNull().default("manual"),
    /** When the attempt was claimed (pending → capturing); null before that. */
    startedAt: integer("started_at"),
    /** When the attempt reached ready or failed; null while it is open. */
    finishedAt: integer("finished_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("captures_page_variant_attempt_unique").on(t.pageId, t.variant, t.attempt),
    uniqueIndex("captures_page_variant_idempotency_unique").on(
      t.pageId,
      t.variant,
      t.idempotencyKey,
    ),
    index("captures_page_variant_idx").on(t.pageId, t.variant),
    check("captures_variant_check", sql`${t.variant} in ('desktop', 'mobile')`),
    check(
      "captures_status_check",
      sql`${t.status} in ('pending', 'capturing', 'ready', 'failed')`,
    ),
  ],
);

export const ANNOTATION_KINDS = ["pin", "rectangle", "circle", "arrow"] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export const annotations = sqliteTable(
  "annotations",
  {
    id: text("id").primaryKey(),
    captureId: text("capture_id")
      .notNull()
      .references(() => captures.id),
    kind: text("kind").notNull(),
    /** Server-determined, monotonically increasing per capture; never reused. */
    number: integer("number").notNull(),
    /** Natural-pixel geometry, validated by kind before write. */
    geometryJson: text("geometry_json").notNull(),
    /** Schema version of geometry_json. */
    geometryVersion: integer("geometry_version").notNull().default(1),
    /** Lucas's editable original comment (the only mutable body). */
    originalBody: text("original_body").notNull(),
    /** Descriptive capture-time DOM context snapshot; never executable. */
    elementSnapshotJson: text("element_snapshot_json"),
    /** Optimistic-concurrency revision; stale writes lose. */
    revision: integer("revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    /** Tombstone; deleting an annotation never mutates its thread entries. */
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    uniqueIndex("annotations_capture_number_unique").on(t.captureId, t.number),
    index("annotations_capture_idx").on(t.captureId),
    check(
      "annotations_kind_check",
      sql`${t.kind} in ('pin', 'rectangle', 'circle', 'arrow')`,
    ),
  ],
);

export const THREAD_ACTOR_ROLES = ["editor", "founder"] as const;
export type ThreadActorRole = (typeof THREAD_ACTOR_ROLES)[number];

/** Author labels are assigned server-side; founders are always "founder". */
export const THREAD_AUTHOR_LABELS = ["Lucas", "founder"] as const;
export type ThreadAuthorLabel = (typeof THREAD_AUTHOR_LABELS)[number];

export const threadEntries = sqliteTable(
  "thread_entries",
  {
    id: text("id").primaryKey(),
    annotationId: text("annotation_id")
      .notNull()
      .references(() => annotations.id),
    actorRole: text("actor_role").notNull(),
    authorLabel: text("author_label").notNull(),
    body: text("body").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: integer("created_at").notNull(),
    // No updated_at / deleted_at: entries are append-only. The committed
    // thread_entries_immutable migration installs triggers rejecting UPDATE
    // and DELETE at the database boundary (VAL-THREAD-002).
  },
  (t) => [
    uniqueIndex("thread_entries_annotation_idempotency_unique").on(
      t.annotationId,
      t.idempotencyKey,
    ),
    // One documented total server order: created_at with id tie-break.
    index("thread_entries_annotation_order_idx").on(t.annotationId, t.createdAt, t.id),
    check("thread_entries_actor_role_check", sql`${t.actorRole} in ('editor', 'founder')`),
    check("thread_entries_author_label_check", sql`${t.authorLabel} in ('Lucas', 'founder')`),
  ],
);

/**
 * Generic mutation idempotency records (e.g. project creation): same actor
 * scope + key + payload digest returns the original result; same key with a
 * different digest conflicts.
 */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    /** SHA-256 hex digest of the canonical normalized payload. */
    payloadDigest: text("payload_digest").notNull(),
    resultJson: text("result_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

/**
 * Durable rate-limit buckets (VAL-AUTH-006 login throttling, VAL-THREAD-006
 * reply quotas). bucket_key is a SHA-256 digest of scope + identifier so no
 * plaintext password or raw capability is ever persisted as a key. Updates
 * must be atomic so the limit holds across application instances.
 */
export const rateLimitBuckets = sqliteTable("rate_limit_buckets", {
  bucketKey: text("bucket_key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStartedAt: integer("window_started_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Application schema/policy metadata for explicit versioning. */
export const schemaMeta = sqliteTable("schema_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Durable Browserless concurrency admission (VAL-CAPTURE-007): exactly
 * MAX_ACTIVE_CAPTURES slot rows, one per provider slot the whole deployment
 * may hold at once. An in-process counter cannot enforce the limit across
 * clients and application instances; this table can, because claiming a slot
 * is one atomic conditional write in the durable store.
 *
 * A lease expires at STALE_CAPTURE_AGE_MS, the same published age at which
 * the claimed `capturing` attempt computes to stale: an abandoned claim frees
 * its slot exactly when the attempt becomes retryable. Expired leases are
 * reclaimed in place by the next claim; a release is conditional on the
 * capture id, so a late release can never free a slot another attempt already
 * reclaimed. Lease rows name no URL, credential, or provider detail.
 */
export const captureLeases = sqliteTable(
  "capture_leases",
  {
    /** Slot number, 0 .. MAX_ACTIVE_CAPTURES - 1. */
    slot: integer("slot").primaryKey(),
    /** The capture attempt holding this slot; unique so one attempt holds one slot. */
    captureId: text("capture_id").notNull().unique(),
    /** UTC instant after which any worker may reclaim this slot. */
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("capture_leases_expiry_idx").on(t.expiresAt)],
);

/**
 * Bounded, retryable cleanup state for a known orphan object (VAL-CAPTURE-009).
 *
 * Turso and Blob are not transactional, so a capture can upload a private
 * object and then lose its finalization fence: the row is already terminal
 * and can never reference the object. The object must be deleted. When that
 * deletion itself fails, this row is the durable record that a specific,
 * known object still needs cleanup — the alternative to an untracked orphan.
 *
 * A row here never names credentials, provider URLs, or target URLs: the
 * pathname is an internal, non-secret store reference. `attempts` and the
 * published cleanup deadline bound the retry work; a row past its deadline is
 * still deleted by the cleanup path, never silently kept.
 */
export const captureCleanups = sqliteTable(
  "capture_cleanups",
  {
    /** Internal private-Blob pathname of the orphaned object. */
    blobPath: text("blob_path").primaryKey(),
    /** Capture attempt that uploaded the object, for correlation only. */
    captureId: text("capture_id").notNull(),
    /** Bounded delete attempts so far. */
    attempts: integer("attempts").notNull().default(0),
    /** No cleanup work may continue after this UTC instant. */
    deadlineAt: integer("deadline_at").notNull(),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("capture_cleanups_deadline_idx").on(t.deadlineAt)],
);
