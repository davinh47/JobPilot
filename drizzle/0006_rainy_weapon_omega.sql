CREATE TABLE `company_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company_name` text NOT NULL,
	`reason` text NOT NULL,
	`role_families_json` text DEFAULT '[]' NOT NULL,
	`locations_json` text DEFAULT '[]' NOT NULL,
	`confidence` real NOT NULL,
	`uncertainties_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`official_website` text,
	`careers_url` text,
	`ats_provider` text,
	`board_token` text,
	`verification_evidence_json` text DEFAULT '[]' NOT NULL,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_recommendations_user_company_idx` ON `company_recommendations` (`user_id`,`company_name`);--> statement-breakpoint
CREATE INDEX `company_recommendations_user_status_idx` ON `company_recommendations` (`user_id`,`status`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `web_search_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `web_search_max_queries` integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `web_ai_match_limit` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `candidate_profiles` ADD `user_context` text;--> statement-breakpoint
ALTER TABLE `candidate_profiles` ADD `analyzed_at` integer;