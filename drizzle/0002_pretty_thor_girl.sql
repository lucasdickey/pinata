CREATE TABLE `capture_cleanups` (
	`blob_path` text PRIMARY KEY NOT NULL,
	`capture_id` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`deadline_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `capture_cleanups_deadline_idx` ON `capture_cleanups` (`deadline_at`);