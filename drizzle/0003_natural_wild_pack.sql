ALTER TABLE `career_preferences` ADD `seniority_levels_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `career_preferences` ADD `employment_types_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `career_preferences` ADD `excluded_keywords_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `career_preferences` ADD `work_authorization_notes` text;--> statement-breakpoint
ALTER TABLE `career_preferences` ADD `search_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `career_preferences` ADD `search_frequency_minutes` integer DEFAULT 1440 NOT NULL;--> statement-breakpoint
ALTER TABLE `career_preferences` ADD `last_search_at` integer;