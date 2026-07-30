ALTER TABLE `resume_versions` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `resumes` ADD `current_version_id` text;--> statement-breakpoint
UPDATE `resumes`
SET `current_version_id` = (
  SELECT `version`.`id`
  FROM `resume_versions` AS `version`
  WHERE `version`.`resume_id` = `resumes`.`id`
  ORDER BY `version`.`version_number` DESC, `version`.`created_at` DESC
  LIMIT 1
);
