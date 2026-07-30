PRAGMA foreign_keys=OFF;--> statement-breakpoint
UPDATE `jobs`
SET `owner_user_id` = COALESCE(
  (SELECT `applications`.`user_id` FROM `applications` WHERE `applications`.`job_id` = `jobs`.`id` LIMIT 1),
  (SELECT `users`.`id` FROM `users` ORDER BY `users`.`created_at` LIMIT 1)
)
WHERE `owner_user_id` IS NULL;--> statement-breakpoint
DELETE FROM `jobs` WHERE `owner_user_id` IS NULL;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`company_name` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`workplace_type` text DEFAULT 'unknown' NOT NULL,
	`employment_type` text,
	`salary_min` integer,
	`salary_max` integer,
	`salary_currency` text,
	`description_text` text NOT NULL,
	`canonical_url` text,
	`canonical_key` text NOT NULL,
	`listing_status` text DEFAULT 'unknown' NOT NULL,
	`listing_checked_at` integer,
	`missing_check_count` integer DEFAULT 0 NOT NULL,
	`application_deadline` integer,
	`published_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "owner_user_id", "company_name", "title", "location", "workplace_type", "employment_type", "salary_min", "salary_max", "salary_currency", "description_text", "canonical_url", "canonical_key", "listing_status", "listing_checked_at", "missing_check_count", "application_deadline", "published_at", "first_seen_at", "last_seen_at", "created_at", "updated_at") SELECT "id", "owner_user_id", "company_name", "title", "location", "workplace_type", "employment_type", "salary_min", "salary_max", "salary_currency", "description_text", "canonical_url", "canonical_key", "listing_status", "listing_checked_at", "missing_check_count", "application_deadline", "published_at", "first_seen_at", "last_seen_at", "created_at", "updated_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_owner_canonical_key_idx` ON `jobs` (`owner_user_id`,`canonical_key`);--> statement-breakpoint
CREATE INDEX `jobs_owner_created_idx` ON `jobs` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_listing_status_idx` ON `jobs` (`listing_status`);--> statement-breakpoint
CREATE TABLE `__new_background_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_type` text NOT NULL,
	`dedupe_key` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload_json` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer,
	`locked_at` integer,
	`claimed_at` integer,
	`locked_by` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_background_jobs`(
	`id`, `user_id`, `job_type`, `dedupe_key`, `status`, `payload_json`, `priority`,
	`attempts`, `max_attempts`, `run_after`, `locked_at`, `claimed_at`, `locked_by`,
	`last_error`, `created_at`, `updated_at`
)
SELECT
	`id`,
	COALESCE(
		json_extract(`payload_json`, '$.userId'),
		(SELECT `users`.`id` FROM `users` ORDER BY `users`.`created_at` LIMIT 1)
	),
	`job_type`, NULL, `status`, `payload_json`, `priority`, `attempts`, `max_attempts`,
	`run_after`, `locked_at`, NULL, `locked_by`, `last_error`, `created_at`, `updated_at`
FROM `background_jobs`
WHERE COALESCE(
	json_extract(`payload_json`, '$.userId'),
	(SELECT `users`.`id` FROM `users` ORDER BY `users`.`created_at` LIMIT 1)
) IS NOT NULL;--> statement-breakpoint
DROP TABLE `background_jobs`;--> statement-breakpoint
ALTER TABLE `__new_background_jobs` RENAME TO `background_jobs`;--> statement-breakpoint
CREATE INDEX `background_jobs_queue_idx` ON `background_jobs` (`status`,`run_after`,`priority`);--> statement-breakpoint
CREATE INDEX `background_jobs_user_status_idx` ON `background_jobs` (`user_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `background_jobs_user_dedupe_idx` ON `background_jobs` (`user_id`,`job_type`,`dedupe_key`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
