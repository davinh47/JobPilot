PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ai_enabled` integer DEFAULT false NOT NULL,
	`ai_provider` text DEFAULT 'deepseek' NOT NULL,
	`ai_model` text DEFAULT 'deepseek-v4-flash' NOT NULL,
	`ai_base_url` text DEFAULT 'https://api.deepseek.com' NOT NULL,
	`worker_enabled` integer DEFAULT true NOT NULL,
	`notifications_enabled` integer DEFAULT true NOT NULL,
	`web_search_enabled` integer DEFAULT false NOT NULL,
	`web_search_max_queries` integer DEFAULT 4 NOT NULL,
	`web_ai_match_limit` integer DEFAULT 5 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_app_settings`("id", "user_id", "ai_enabled", "ai_provider", "ai_model", "ai_base_url", "worker_enabled", "notifications_enabled", "web_search_enabled", "web_search_max_queries", "web_ai_match_limit", "created_at", "updated_at") SELECT "id", "user_id", "ai_enabled", "ai_provider", "ai_model", "ai_base_url", "worker_enabled", "notifications_enabled", "web_search_enabled", "web_search_max_queries", "web_ai_match_limit", "created_at", "updated_at" FROM `app_settings`;--> statement-breakpoint
DROP TABLE `app_settings`;--> statement-breakpoint
ALTER TABLE `__new_app_settings` RENAME TO `app_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `app_settings_user_idx` ON `app_settings` (`user_id`);--> statement-breakpoint
UPDATE `app_settings` SET `ai_model` = 'deepseek-v4-flash' WHERE `ai_provider` = 'deepseek' AND `ai_model` IN ('deepseek-chat', 'deepseek-reasoner');
