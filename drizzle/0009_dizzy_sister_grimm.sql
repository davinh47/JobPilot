CREATE TABLE `ignored_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`canonical_key` text NOT NULL,
	`canonical_url` text,
	`company_name` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ignored_jobs_user_key_idx` ON `ignored_jobs` (`user_id`,`canonical_key`);--> statement-breakpoint
CREATE INDEX `ignored_jobs_user_created_idx` ON `ignored_jobs` (`user_id`,`created_at`);