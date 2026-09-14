ALTER TABLE `captures` ADD `origin` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `captures` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `captures` ADD `finished_at` integer;