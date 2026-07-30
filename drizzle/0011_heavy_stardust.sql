CREATE TABLE `job_search_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_title` text NOT NULL,
	`seniority_level` text DEFAULT 'any' NOT NULL,
	`employment_type` text DEFAULT 'any' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `job_search_targets` (`id`, `user_id`, `target_title`, `seniority_level`, `employment_type`, `position`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	preferences.`user_id`,
	trim(targets.`value`),
	CASE
		WHEN json_array_length(preferences.`seniority_levels_json`) != 1 THEN 'any'
		WHEN lower(json_extract(preferences.`seniority_levels_json`, '$[0]')) LIKE '%intern%' OR json_extract(preferences.`seniority_levels_json`, '$[0]') LIKE '%实习%' THEN 'internship'
		WHEN lower(json_extract(preferences.`seniority_levels_json`, '$[0]')) LIKE '%junior%' OR lower(json_extract(preferences.`seniority_levels_json`, '$[0]')) LIKE '%entry%' OR lower(json_extract(preferences.`seniority_levels_json`, '$[0]')) LIKE '%graduate%' OR json_extract(preferences.`seniority_levels_json`, '$[0]') LIKE '%初级%' OR json_extract(preferences.`seniority_levels_json`, '$[0]') LIKE '%入门%' THEN 'entry'
		WHEN lower(json_extract(preferences.`seniority_levels_json`, '$[0]')) LIKE '%mid%' OR lower(json_extract(preferences.`seniority_levels_json`, '$[0]')) LIKE '%intermediate%' OR json_extract(preferences.`seniority_levels_json`, '$[0]') LIKE '%中级%' THEN 'mid'
		WHEN lower(json_extract(preferences.`seniority_levels_json`, '$[0]')) LIKE '%lead%' OR lower(json_extract(preferences.`seniority_levels_json`, '$[0]')) LIKE '%principal%' OR json_extract(preferences.`seniority_levels_json`, '$[0]') LIKE '%负责人%' OR json_extract(preferences.`seniority_levels_json`, '$[0]') LIKE '%主管%' THEN 'lead'
		WHEN lower(json_extract(preferences.`seniority_levels_json`, '$[0]')) LIKE '%director%' OR lower(json_extract(preferences.`seniority_levels_json`, '$[0]')) LIKE '%executive%' OR lower(json_extract(preferences.`seniority_levels_json`, '$[0]')) LIKE '%chief%' OR json_extract(preferences.`seniority_levels_json`, '$[0]') LIKE '%总监%' OR json_extract(preferences.`seniority_levels_json`, '$[0]') LIKE '%首席%' THEN 'executive'
		WHEN lower(json_extract(preferences.`seniority_levels_json`, '$[0]')) LIKE '%senior%' OR json_extract(preferences.`seniority_levels_json`, '$[0]') LIKE '%高级%' OR json_extract(preferences.`seniority_levels_json`, '$[0]') LIKE '%资深%' THEN 'senior'
		ELSE 'any'
	END,
	CASE
		WHEN json_array_length(preferences.`employment_types_json`) != 1 THEN 'any'
		WHEN lower(json_extract(preferences.`employment_types_json`, '$[0]')) LIKE '%full%' OR json_extract(preferences.`employment_types_json`, '$[0]') LIKE '%全职%' THEN 'full_time'
		WHEN lower(json_extract(preferences.`employment_types_json`, '$[0]')) LIKE '%part%' OR json_extract(preferences.`employment_types_json`, '$[0]') LIKE '%兼职%' THEN 'part_time'
		WHEN lower(json_extract(preferences.`employment_types_json`, '$[0]')) LIKE '%contract%' OR json_extract(preferences.`employment_types_json`, '$[0]') LIKE '%合同%' THEN 'contract'
		WHEN lower(json_extract(preferences.`employment_types_json`, '$[0]')) LIKE '%temporary%' OR json_extract(preferences.`employment_types_json`, '$[0]') LIKE '%临时%' THEN 'temporary'
		WHEN lower(json_extract(preferences.`employment_types_json`, '$[0]')) LIKE '%intern%' OR json_extract(preferences.`employment_types_json`, '$[0]') LIKE '%实习%' THEN 'internship'
		ELSE 'any'
	END,
	CAST(targets.`key` AS integer),
	CAST(strftime('%s', 'now') AS integer) * 1000,
	CAST(strftime('%s', 'now') AS integer) * 1000
FROM `career_preferences` preferences, json_each(CASE WHEN json_valid(preferences.`target_titles_json`) THEN preferences.`target_titles_json` ELSE '[]' END) targets
WHERE trim(targets.`value`) != '';
--> statement-breakpoint
CREATE INDEX `job_search_targets_user_position_idx` ON `job_search_targets` (`user_id`,`position`);--> statement-breakpoint
ALTER TABLE `job_matches` ADD `matched_target_id` text REFERENCES job_search_targets(id);
