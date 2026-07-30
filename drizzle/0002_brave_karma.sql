CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ai_enabled` integer DEFAULT false NOT NULL,
	`ai_provider` text DEFAULT 'deepseek' NOT NULL,
	`ai_model` text DEFAULT 'deepseek-chat' NOT NULL,
	`ai_base_url` text DEFAULT 'https://api.deepseek.com' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_settings_user_idx` ON `app_settings` (`user_id`);