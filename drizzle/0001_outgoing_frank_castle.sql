CREATE TABLE `application_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slug` text NOT NULL,
	`label_zh` text NOT NULL,
	`label_en` text NOT NULL,
	`color` text DEFAULT 'gray' NOT NULL,
	`position` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_terminal` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_statuses_user_slug_idx` ON `application_statuses` (`user_id`,`slug`);--> statement-breakpoint
CREATE INDEX `application_statuses_user_position_idx` ON `application_statuses` (`user_id`,`position`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`status` text DEFAULT 'to_apply' NOT NULL,
	`selected_resume_version_id` text,
	`next_action` text,
	`next_action_at` integer,
	`applied_at` integer,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`selected_resume_version_id`) REFERENCES `resume_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_applications`("id", "user_id", "job_id", "status", "selected_resume_version_id", "next_action", "next_action_at", "applied_at", "closed_at", "created_at", "updated_at") SELECT "id", "user_id", "job_id", "status", "selected_resume_version_id", "next_action", "next_action_at", "applied_at", "closed_at", "created_at", "updated_at" FROM `applications`;--> statement-breakpoint
DROP TABLE `applications`;--> statement-breakpoint
ALTER TABLE `__new_applications` RENAME TO `applications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `applications_user_job_idx` ON `applications` (`user_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `applications_status_idx` ON `applications` (`status`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `application_deadline` integer;