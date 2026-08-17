ALTER TABLE `job_search_targets` ADD `locations_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_search_targets` ADD `remote_preference` text DEFAULT 'any' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_search_targets` ADD `minimum_salary` integer;--> statement-breakpoint
ALTER TABLE `job_search_targets` ADD `salary_currency` text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_search_targets` ADD `industries_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_search_targets` ADD `company_allowlist_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_search_targets` ADD `company_blocklist_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_search_targets` ADD `excluded_keywords_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_search_targets` ADD `requires_visa_sponsorship` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `job_search_targets` ADD `work_authorization_notes` text;--> statement-breakpoint
ALTER TABLE `job_search_targets` ADD `hard_requirements_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `job_search_targets`
SET
  `locations_json` = COALESCE((SELECT `locations_json` FROM `career_preferences` WHERE `career_preferences`.`user_id` = `job_search_targets`.`user_id`), '[]'),
  `remote_preference` = COALESCE((SELECT `remote_preference` FROM `career_preferences` WHERE `career_preferences`.`user_id` = `job_search_targets`.`user_id`), 'any'),
  `minimum_salary` = (SELECT `minimum_salary` FROM `career_preferences` WHERE `career_preferences`.`user_id` = `job_search_targets`.`user_id`),
  `salary_currency` = COALESCE((SELECT `salary_currency` FROM `career_preferences` WHERE `career_preferences`.`user_id` = `job_search_targets`.`user_id`), 'USD'),
  `industries_json` = COALESCE((SELECT `industries_json` FROM `career_preferences` WHERE `career_preferences`.`user_id` = `job_search_targets`.`user_id`), '[]'),
  `company_allowlist_json` = COALESCE((SELECT `company_allowlist_json` FROM `career_preferences` WHERE `career_preferences`.`user_id` = `job_search_targets`.`user_id`), '[]'),
  `company_blocklist_json` = COALESCE((SELECT `company_blocklist_json` FROM `career_preferences` WHERE `career_preferences`.`user_id` = `job_search_targets`.`user_id`), '[]'),
  `excluded_keywords_json` = COALESCE((SELECT `excluded_keywords_json` FROM `career_preferences` WHERE `career_preferences`.`user_id` = `job_search_targets`.`user_id`), '[]'),
  `requires_visa_sponsorship` = COALESCE((SELECT `requires_visa_sponsorship` FROM `career_preferences` WHERE `career_preferences`.`user_id` = `job_search_targets`.`user_id`), false),
  `work_authorization_notes` = (SELECT `work_authorization_notes` FROM `career_preferences` WHERE `career_preferences`.`user_id` = `job_search_targets`.`user_id`),
  `hard_requirements_json` = COALESCE((SELECT `hard_requirements_json` FROM `career_preferences` WHERE `career_preferences`.`user_id` = `job_search_targets`.`user_id`), '[]');
