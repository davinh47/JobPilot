CREATE TABLE `user_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	`initialization_vector` text NOT NULL,
	`authentication_tag` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_secrets_user_idx` ON `user_secrets` (`user_id`);--> statement-breakpoint
DROP INDEX `jobs_canonical_key_idx`;--> statement-breakpoint
ALTER TABLE `jobs` ADD `owner_user_id` text REFERENCES users(id) ON DELETE CASCADE;--> statement-breakpoint
UPDATE `jobs` SET `owner_user_id` = (SELECT `id` FROM `users` ORDER BY `created_at` LIMIT 1) WHERE `owner_user_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_owner_canonical_key_idx` ON `jobs` (`owner_user_id`,`canonical_key`);--> statement-breakpoint
CREATE INDEX `jobs_owner_created_idx` ON `jobs` (`owner_user_id`,`created_at`);
