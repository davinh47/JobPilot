CREATE TABLE `assistant_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`messages_json` text DEFAULT '[]' NOT NULL,
	`summarized_message_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_contexts_user_idx` ON `assistant_contexts` (`user_id`);--> statement-breakpoint
DELETE FROM `resume_versions`
WHERE `id` IN (
	SELECT `id`
	FROM (
		SELECT
			`id`,
			`version_number`,
			ROW_NUMBER() OVER (
				PARTITION BY `resume_id`
				ORDER BY `version_number` DESC, `created_at` DESC
			) AS `newest_rank`,
			MIN(`version_number`) OVER (PARTITION BY `resume_id`) AS `first_version_number`
		FROM `resume_versions`
	) AS `ranked_versions`
	WHERE `newest_rank` > 9
		AND `version_number` <> `first_version_number`
)
AND NOT EXISTS (
	SELECT 1 FROM `applications`
	WHERE `applications`.`selected_resume_version_id` = `resume_versions`.`id`
)
AND NOT EXISTS (
	SELECT 1 FROM `materials`
	WHERE `materials`.`resume_version_id` = `resume_versions`.`id`
);
