CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`model_provider` text DEFAULT 'deepseek' NOT NULL,
	`model_name` text,
	`prompt_version` text,
	`input_refs_json` text DEFAULT '[]' NOT NULL,
	`output_json` text,
	`error_code` text,
	`error_message` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_runs_status_idx` ON `agent_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `application_events` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`event_type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`title` text NOT NULL,
	`details_json` text,
	`actor_type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `application_events_application_idx` ON `application_events` (`application_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`status` text DEFAULT 'discovered' NOT NULL,
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
CREATE UNIQUE INDEX `applications_user_job_idx` ON `applications` (`user_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `applications_status_idx` ON `applications` (`status`);--> statement-breakpoint
CREATE TABLE `background_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload_json` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer NOT NULL,
	`locked_at` integer,
	`locked_by` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `background_jobs_queue_idx` ON `background_jobs` (`status`,`run_after`,`priority`);--> statement-breakpoint
CREATE TABLE `candidate_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`headline` text,
	`summary` text,
	`current_location` text,
	`years_of_experience` real,
	`work_authorization` text,
	`profile_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_profiles_user_idx` ON `candidate_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `career_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_titles_json` text DEFAULT '[]' NOT NULL,
	`locations_json` text DEFAULT '[]' NOT NULL,
	`remote_preference` text DEFAULT 'any' NOT NULL,
	`minimum_salary` integer,
	`salary_currency` text DEFAULT 'USD' NOT NULL,
	`industries_json` text DEFAULT '[]' NOT NULL,
	`company_allowlist_json` text DEFAULT '[]' NOT NULL,
	`company_blocklist_json` text DEFAULT '[]' NOT NULL,
	`requires_visa_sponsorship` integer DEFAULT false NOT NULL,
	`hard_requirements_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `career_preferences_user_idx` ON `career_preferences` (`user_id`);--> statement-breakpoint
CREATE TABLE `experience_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`resume_id` text,
	`evidence_type` text NOT NULL,
	`title` text NOT NULL,
	`organization` text,
	`start_date` text,
	`end_date` text,
	`description` text NOT NULL,
	`facts_json` text,
	`source_locator` text,
	`user_confirmed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `experience_evidence_user_idx` ON `experience_evidence` (`user_id`);--> statement-breakpoint
CREATE TABLE `interview_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text,
	`application_id` text NOT NULL,
	`question` text NOT NULL,
	`category` text,
	`answer_framework` text,
	`answer_draft` text,
	`evidence_ids_json` text DEFAULT '[]' NOT NULL,
	`missing_information_json` text DEFAULT '[]' NOT NULL,
	`user_confirmed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`interview_id`) REFERENCES `interviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `interviews` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`stage` text NOT NULL,
	`format` text,
	`scheduled_at` integer,
	`duration_minutes` integer,
	`interviewers_json` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`outcome` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`resume_version_id` text,
	`overall_score` integer NOT NULL,
	`skills_score` integer NOT NULL,
	`responsibilities_score` integer NOT NULL,
	`seniority_score` integer NOT NULL,
	`location_score` integer NOT NULL,
	`salary_score` integer,
	`industry_score` integer,
	`authorization_score` integer,
	`hard_filter_passed` integer NOT NULL,
	`evidence_json` text NOT NULL,
	`gaps_json` text NOT NULL,
	`uncertainties_json` text NOT NULL,
	`model_name` text,
	`prompt_version` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_version_id`) REFERENCES `resume_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `job_matches_job_user_idx` ON `job_matches` (`job_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `job_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`source_id` text,
	`content_hash` text NOT NULL,
	`raw_text` text NOT NULL,
	`raw_html_storage_path` text,
	`http_status` integer,
	`listing_evidence` text,
	`captured_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `job_sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `job_snapshots_job_idx` ON `job_snapshots` (`job_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `job_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_name` text NOT NULL,
	`source_url` text,
	`external_id` text,
	`discovered_at` integer NOT NULL,
	`last_checked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_sources_job_idx` ON `job_sources` (`job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
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
	`published_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_canonical_key_idx` ON `jobs` (`canonical_key`);--> statement-breakpoint
CREATE INDEX `jobs_listing_status_idx` ON `jobs` (`listing_status`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`material_type` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'needed' NOT NULL,
	`resume_version_id` text,
	`storage_path` text,
	`due_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_version_id`) REFERENCES `resume_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`memory_type` text NOT NULL,
	`content` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`confidence` real NOT NULL,
	`user_confirmed` integer DEFAULT false NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memories_user_type_idx` ON `memories` (`user_id`,`memory_type`);--> statement-breakpoint
CREATE TABLE `resume_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`resume_id` text NOT NULL,
	`job_id` text,
	`parent_version_id` text,
	`version_number` integer NOT NULL,
	`version_type` text NOT NULL,
	`title` text NOT NULL,
	`structured_content_json` text NOT NULL,
	`rendered_text` text,
	`change_summary` text,
	`fact_check_status` text DEFAULT 'pending' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resume_versions_number_idx` ON `resume_versions` (`resume_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `resume_versions_job_idx` ON `resume_versions` (`job_id`);--> statement-breakpoint
CREATE TABLE `resumes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`original_filename` text,
	`original_storage_path` text,
	`original_text` text,
	`content_hash` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`imported_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`proficiency` text,
	`years_used` real,
	`user_confirmed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_user_name_idx` ON `skills` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT 'JobPilot User' NOT NULL,
	`email` text,
	`locale` text DEFAULT 'zh-CN' NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `watch_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`keywords_json` text DEFAULT '[]' NOT NULL,
	`locations_json` text DEFAULT '[]' NOT NULL,
	`remote_preference` text DEFAULT 'any' NOT NULL,
	`minimum_salary` integer,
	`industries_json` text DEFAULT '[]' NOT NULL,
	`company_allowlist_json` text DEFAULT '[]' NOT NULL,
	`company_blocklist_json` text DEFAULT '[]' NOT NULL,
	`frequency_minutes` integer DEFAULT 1440 NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
