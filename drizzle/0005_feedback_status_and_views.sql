CREATE TABLE `annotation_views` (
	`annotation_id` text NOT NULL,
	`role` text NOT NULL,
	`viewer_key` text NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`annotation_id`, `role`, `viewer_key`),
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "annotation_views_role_check" CHECK("annotation_views"."role" in ('editor', 'founder'))
);
--> statement-breakpoint
ALTER TABLE `annotations` ADD `status` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `thread_entries` ADD `kind` text DEFAULT 'message' NOT NULL;