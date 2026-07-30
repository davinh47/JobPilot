CREATE TABLE `search_checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`search_plan_id` text NOT NULL,
	`user_id` text NOT NULL,
	`matrix_item_id` text NOT NULL,
	`label` text NOT NULL,
	`query` text NOT NULL,
	`location` text,
	`platform` text NOT NULL,
	`search_url` text,
	`priority` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`checked_at` integer,
	`result_count` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`search_plan_id`) REFERENCES `search_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_checklist_plan_matrix_platform_idx` ON `search_checklist_items` (`search_plan_id`,`matrix_item_id`,`platform`,`location`);--> statement-breakpoint
CREATE INDEX `search_checklist_user_status_idx` ON `search_checklist_items` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `search_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`strategy_summary` text NOT NULL,
	`matrix_json` text NOT NULL,
	`model_name` text,
	`prompt_version` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `search_plans_user_created_idx` ON `search_plans` (`user_id`,`created_at`);