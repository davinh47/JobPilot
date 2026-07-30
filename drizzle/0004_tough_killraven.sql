CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`notification_type` text NOT NULL,
	`title_zh` text NOT NULL,
	`title_en` text NOT NULL,
	`body_zh` text NOT NULL,
	`body_en` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `search_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`document_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`source_label` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_documents_type_entity_idx` ON `search_documents` (`document_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `search_documents_user_idx` ON `search_documents` (`user_id`,`document_type`);--> statement-breakpoint
CREATE TABLE `source_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`board_token` text NOT NULL,
	`region` text DEFAULT 'global' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_sync_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_connectors_user_provider_token_idx` ON `source_connectors` (`user_id`,`provider`,`board_token`);--> statement-breakpoint
CREATE INDEX `source_connectors_enabled_idx` ON `source_connectors` (`user_id`,`enabled`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `worker_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `notifications_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `missing_check_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_documents_fts` USING fts5(`title`, `content`, content=`search_documents`, content_rowid=`rowid`);
--> statement-breakpoint
CREATE TRIGGER `search_documents_ai` AFTER INSERT ON `search_documents` BEGIN
  INSERT INTO `search_documents_fts`(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `search_documents_ad` AFTER DELETE ON `search_documents` BEGIN
  INSERT INTO `search_documents_fts`(`search_documents_fts`, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER `search_documents_au` AFTER UPDATE ON `search_documents` BEGIN
  INSERT INTO `search_documents_fts`(`search_documents_fts`, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
  INSERT INTO `search_documents_fts`(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;
