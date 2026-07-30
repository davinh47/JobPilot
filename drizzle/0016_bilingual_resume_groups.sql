ALTER TABLE `resumes` ADD `language` text;--> statement-breakpoint
ALTER TABLE `resumes` ADD `resume_group_id` text;--> statement-breakpoint
UPDATE `resumes` SET `resume_group_id` = `id`;--> statement-breakpoint
CREATE INDEX `resumes_user_group_language_idx` ON `resumes` (`user_id`,`resume_group_id`,`language`);
