ALTER TABLE `job_search_targets` ADD `location_preferences_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `job_search_targets`
SET `location_preferences_json` = (
  SELECT COALESCE(
    json_group_array(
      json_object(
        'location', `value`,
        'requiresVisaSponsorship', CASE WHEN `job_search_targets`.`requires_visa_sponsorship` THEN json('true') ELSE json('false') END,
        'workAuthorizationNotes', COALESCE(`job_search_targets`.`work_authorization_notes`, '')
      )
    ),
    '[]'
  )
  FROM json_each(`job_search_targets`.`locations_json`)
)
WHERE json_array_length(`job_search_targets`.`locations_json`) > 0;
