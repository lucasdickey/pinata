ALTER TABLE `projects` ADD `agent_token_digest` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `agent_token_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `agent_revoked_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_agent_token_digest_unique` ON `projects` (`agent_token_digest`);