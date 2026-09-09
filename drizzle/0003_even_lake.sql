CREATE TABLE `capture_leases` (
	`slot` integer PRIMARY KEY NOT NULL,
	`capture_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capture_leases_capture_id_unique` ON `capture_leases` (`capture_id`);--> statement-breakpoint
CREATE INDEX `capture_leases_expiry_idx` ON `capture_leases` (`expires_at`);