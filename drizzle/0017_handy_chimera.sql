CREATE TABLE `account_deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`current_step` text DEFAULT 'requested' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_deletion_requests_user_idx` ON `account_deletion_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `account_deletion_requests_status_idx` ON `account_deletion_requests` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `api_rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`key_hash` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_rate_limits_scope_key_idx` ON `api_rate_limits` (`scope`,`key_hash`);--> statement-breakpoint
CREATE INDEX `api_rate_limits_expiry_idx` ON `api_rate_limits` (`expires_at`);--> statement-breakpoint
ALTER TABLE `user_secrets` ADD `encryption_key_version` text DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_secrets` ADD `encryption_envelope_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_secrets` ADD `extension_pairing_token_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_secrets_extension_token_hash_idx` ON `user_secrets` (`extension_pairing_token_hash`);