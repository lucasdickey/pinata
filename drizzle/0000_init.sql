CREATE TABLE `annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`capture_id` text NOT NULL,
	`kind` text NOT NULL,
	`number` integer NOT NULL,
	`geometry_json` text NOT NULL,
	`geometry_version` integer DEFAULT 1 NOT NULL,
	`original_body` text NOT NULL,
	`element_snapshot_json` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "annotations_kind_check" CHECK("annotations"."kind" in ('pin', 'rectangle', 'circle', 'arrow'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `annotations_capture_number_unique` ON `annotations` (`capture_id`,`number`);--> statement-breakpoint
CREATE INDEX `annotations_capture_idx` ON `annotations` (`capture_id`);--> statement-breakpoint
CREATE TABLE `captures` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`variant` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`requested_url` text NOT NULL,
	`final_url` text,
	`viewport_width` integer NOT NULL,
	`viewport_height` integer NOT NULL,
	`device_scale_factor` integer NOT NULL,
	`document_width` integer,
	`document_height` integer,
	`blob_path` text,
	`blob_content_type` text,
	`blob_bytes` integer,
	`image_hash` text,
	`dom_manifest_json` text,
	`dom_manifest_version` integer,
	`warning_json` text,
	`error_code` text,
	`error_message` text,
	`captured_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "captures_variant_check" CHECK("captures"."variant" in ('desktop', 'mobile')),
	CONSTRAINT "captures_status_check" CHECK("captures"."status" in ('pending', 'capturing', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `captures_blob_path_unique` ON `captures` (`blob_path`);--> statement-breakpoint
CREATE UNIQUE INDEX `captures_page_variant_attempt_unique` ON `captures` (`page_id`,`variant`,`attempt`);--> statement-breakpoint
CREATE UNIQUE INDEX `captures_page_variant_idempotency_unique` ON `captures` (`page_id`,`variant`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `captures_page_variant_idx` ON `captures` (`page_id`,`variant`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`payload_digest` text NOT NULL,
	`result_json` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`requested_url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`title` text,
	`sort_index` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_project_normalized_url_unique` ON `pages` (`project_id`,`normalized_url`);--> statement-breakpoint
CREATE INDEX `pages_project_sort_idx` ON `pages` (`project_id`,`sort_index`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`title` text NOT NULL,
	`root_url` text NOT NULL,
	`share_token_digest` text,
	`share_token_version` integer DEFAULT 0 NOT NULL,
	`share_revoked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_public_id_unique` ON `projects` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_share_token_digest_unique` ON `projects` (`share_token_digest`);--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_started_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schema_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`annotation_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`author_label` text NOT NULL,
	`body` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "thread_entries_actor_role_check" CHECK("thread_entries"."actor_role" in ('editor', 'founder')),
	CONSTRAINT "thread_entries_author_label_check" CHECK("thread_entries"."author_label" in ('Lucas', 'founder'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_entries_annotation_idempotency_unique` ON `thread_entries` (`annotation_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `thread_entries_annotation_order_idx` ON `thread_entries` (`annotation_id`,`created_at`,`id`);