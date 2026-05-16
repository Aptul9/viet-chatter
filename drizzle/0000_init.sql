CREATE TABLE `chat_state` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'IDLE' NOT NULL,
	`first_msg_at` integer,
	`debounce_deadline` integer,
	`fire_at` integer,
	`attempt` integer DEFAULT 0 NOT NULL,
	`last_event_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cs_state` ON `chat_state` (`state`);--> statement-breakpoint
CREATE INDEX `idx_cs_fire` ON `chat_state` (`fire_at`);--> statement-breakpoint
CREATE TABLE `escalations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` text NOT NULL,
	`trigger_msg_id` text NOT NULL,
	`reason` text NOT NULL,
	`urgency` text NOT NULL,
	`summary` text NOT NULL,
	`holding_reply_sent` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`notified_channels` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_esc_chat_status` ON `escalations` (`chat_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_esc_created` ON `escalations` (`created_at`);--> statement-breakpoint
CREATE TABLE `facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` text NOT NULL,
	`tier` text NOT NULL,
	`content` text NOT NULL,
	`source_msg_id` text,
	`confidence` real DEFAULT 0.8 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`superseded_by` integer
);
--> statement-breakpoint
CREATE INDEX `idx_facts_person_tier` ON `facts` (`person_id`,`tier`);--> statement-breakpoint
CREATE INDEX `idx_facts_expires` ON `facts` (`expires_at`);--> statement-breakpoint
CREATE TABLE `manual_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` text NOT NULL,
	`kind` text NOT NULL,
	`fire_at` integer NOT NULL,
	`payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`fired_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mj_chat_status_fire` ON `manual_jobs` (`chat_id`,`status`,`fire_at`);--> statement-breakpoint
CREATE TABLE `person_profile` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`languages` text DEFAULT '["en"]' NOT NULL,
	`tone_summary` text,
	`re_engage_threshold_days` integer DEFAULT 14 NOT NULL,
	`engagement_state` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `processed_messages` (
	`whatsapp_msg_id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`direction` text NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pm_chat_ts` ON `processed_messages` (`chat_id`,`ts`);--> statement-breakpoint
CREATE TABLE `turn_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` text NOT NULL,
	`ts` integer NOT NULL,
	`status` text NOT NULL,
	`language_used` text,
	`facts_extracted` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`error_msg` text,
	`triggered_by` text DEFAULT 'reactive' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tl_chat_ts` ON `turn_log` (`chat_id`,`ts`);--> statement-breakpoint
CREATE VIRTUAL TABLE facts_vec USING vec0(
	fact_id   INTEGER PRIMARY KEY,
	embedding FLOAT[384]
);
