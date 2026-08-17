ALTER TABLE `materials` ADD `content_text` text;--> statement-breakpoint
ALTER TABLE `materials` ADD `source_refs_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `materials` ADD `created_by` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `materials` ADD `model_name` text;--> statement-breakpoint
ALTER TABLE `materials` ADD `prompt_version` text;--> statement-breakpoint
ALTER TABLE `materials` ADD `fact_check_status` text DEFAULT 'pending' NOT NULL;