CREATE TABLE `ai_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`agent_run_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`task_type` text NOT NULL,
	`prompt_version` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`tool_call_count` integer DEFAULT 0 NOT NULL,
	`estimated_cost_micros` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`retry_index` integer DEFAULT 0 NOT NULL,
	`usage_estimated` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_usage_events_user_created_idx` ON `ai_usage_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_events_agent_run_idx` ON `ai_usage_events` (`agent_run_id`);--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `output_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `cached_input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `tool_call_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `estimated_cost_micros` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `latency_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `retry_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `ai_model_strategy` text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `ai_daily_token_budget` integer DEFAULT 250000 NOT NULL;