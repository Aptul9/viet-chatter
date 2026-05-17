-- Idempotent guards added by hand: agent_commands and its indexes already
-- exist on every live DB via src/db/client.ts ensureAdditiveSchema (Spec D2
-- shipped before this migration generation). Drizzle's diff doesn't know
-- about that out-of-band table; without IF NOT EXISTS the migration would
-- fail on every existing install.
CREATE TABLE IF NOT EXISTS `agent_commands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`prompt` text NOT NULL,
	`action_type` text NOT NULL,
	`action_payload` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`error_msg` text,
	`proposed_at` integer NOT NULL,
	`executed_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ac_session` ON `agent_commands` (`session_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ac_proposed` ON `agent_commands` (`proposed_at`);--> statement-breakpoint
ALTER TABLE `manual_jobs` ADD `attempt_count` integer;
