import { randomUUID } from "node:crypto";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey().$defaultFn(() => randomUUID());
const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date());
const createdAt = () => timestamp("created_at");
const updatedAt = () => timestamp("updated_at");

export type JobSearchLocationPreference = {
  location: string;
  requiresVisaSponsorship: boolean;
  workAuthorizationNotes: string;
};

export const users = sqliteTable("users", {
  id: id(),
  displayName: text("display_name").notNull().default("JobPilot User"),
  email: text("email"),
  locale: text("locale").notNull().default("zh-CN"),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const applicationStatuses = sqliteTable("application_statuses", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  labelZh: text("label_zh").notNull(),
  labelEn: text("label_en").notNull(),
  color: text("color").notNull().default("gray"),
  position: integer("position").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  isTerminal: integer("is_terminal", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("application_statuses_user_slug_idx").on(table.userId, table.slug),
  index("application_statuses_user_position_idx").on(table.userId, table.position),
]);

export const appSettings = sqliteTable("app_settings", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  aiEnabled: integer("ai_enabled", { mode: "boolean" }).notNull().default(false),
  aiProvider: text("ai_provider").notNull().default("deepseek"),
  aiModel: text("ai_model").notNull().default("deepseek-v4-flash"),
  aiBaseUrl: text("ai_base_url").notNull().default("https://api.deepseek.com"),
  aiModelStrategy: text("ai_model_strategy", { enum: ["economy", "balanced", "quality", "fixed"] }).notNull().default("balanced"),
  aiDailyTokenBudget: integer("ai_daily_token_budget").notNull().default(250000),
  workerEnabled: integer("worker_enabled", { mode: "boolean" }).notNull().default(true),
  notificationsEnabled: integer("notifications_enabled", { mode: "boolean" }).notNull().default(true),
  webSearchEnabled: integer("web_search_enabled", { mode: "boolean" }).notNull().default(false),
  webSearchMaxQueries: integer("web_search_max_queries").notNull().default(4),
  webAiMatchLimit: integer("web_ai_match_limit").notNull().default(5),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("app_settings_user_idx").on(table.userId)]);

export const userSecrets = sqliteTable("user_secrets", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  encryptedPayload: text("encrypted_payload").notNull(),
  initializationVector: text("initialization_vector").notNull(),
  authenticationTag: text("authentication_tag").notNull(),
  encryptionKeyVersion: text("encryption_key_version").notNull().default("v1"),
  encryptionEnvelopeVersion: integer("encryption_envelope_version").notNull().default(1),
  extensionPairingTokenHash: text("extension_pairing_token_hash"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("user_secrets_user_idx").on(table.userId),
  uniqueIndex("user_secrets_extension_token_hash_idx").on(table.extensionPairingTokenHash),
]);

export const apiRateLimits = sqliteTable("api_rate_limits", {
  id: id(),
  scope: text("scope").notNull(),
  keyHash: text("key_hash").notNull(),
  windowStartedAt: integer("window_started_at", { mode: "timestamp_ms" }).notNull(),
  requestCount: integer("request_count").notNull().default(0),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("api_rate_limits_scope_key_idx").on(table.scope, table.keyHash),
  index("api_rate_limits_expiry_idx").on(table.expiresAt),
]);

export const accountDeletionRequests = sqliteTable("account_deletion_requests", {
  id: id(),
  userId: text("user_id").notNull(),
  status: text("status", { enum: ["requested", "deleting", "failed", "completed"] }).notNull().default("requested"),
  currentStep: text("current_step", { enum: ["requested", "storage", "auth", "database", "completed"] }).notNull().default("requested"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  requestedAt: timestamp("requested_at"),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("account_deletion_requests_user_idx").on(table.userId),
  index("account_deletion_requests_status_idx").on(table.status, table.updatedAt),
]);

export const candidateProfiles = sqliteTable("candidate_profiles", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  headline: text("headline"),
  summary: text("summary"),
  currentLocation: text("current_location"),
  yearsOfExperience: real("years_of_experience"),
  workAuthorization: text("work_authorization"),
  userContext: text("user_context"),
  profileJson: text("profile_json", { mode: "json" }).$type<Record<string, unknown>>(),
  analyzedAt: integer("analyzed_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("candidate_profiles_user_idx").on(table.userId)]);

export const careerPreferences = sqliteTable("career_preferences", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetTitlesJson: text("target_titles_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  seniorityLevelsJson: text("seniority_levels_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  employmentTypesJson: text("employment_types_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  locationsJson: text("locations_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  remotePreference: text("remote_preference", { enum: ["any", "remote", "hybrid", "onsite"] }).notNull().default("any"),
  minimumSalary: integer("minimum_salary"),
  salaryCurrency: text("salary_currency").notNull().default("USD"),
  industriesJson: text("industries_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  companyAllowlistJson: text("company_allowlist_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  companyBlocklistJson: text("company_blocklist_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  excludedKeywordsJson: text("excluded_keywords_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  requiresVisaSponsorship: integer("requires_visa_sponsorship", { mode: "boolean" }).notNull().default(false),
  workAuthorizationNotes: text("work_authorization_notes"),
  hardRequirementsJson: text("hard_requirements_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  searchEnabled: integer("search_enabled", { mode: "boolean" }).notNull().default(false),
  searchFrequencyMinutes: integer("search_frequency_minutes").notNull().default(1440),
  lastSearchAt: integer("last_search_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("career_preferences_user_idx").on(table.userId)]);

export const jobSearchTargets = sqliteTable("job_search_targets", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetTitle: text("target_title").notNull(),
  seniorityLevel: text("seniority_level", { enum: ["any", "internship", "entry", "mid", "senior", "lead", "executive"] }).notNull().default("any"),
  employmentType: text("employment_type", { enum: ["any", "full_time", "part_time", "contract", "temporary", "internship"] }).notNull().default("any"),
  locationsJson: text("locations_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  locationPreferencesJson: text("location_preferences_json", { mode: "json" }).$type<JobSearchLocationPreference[]>().notNull().default([]),
  remotePreference: text("remote_preference", { enum: ["any", "remote", "hybrid", "onsite"] }).notNull().default("any"),
  minimumSalary: integer("minimum_salary"),
  salaryCurrency: text("salary_currency").notNull().default("USD"),
  industriesJson: text("industries_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  companyAllowlistJson: text("company_allowlist_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  companyBlocklistJson: text("company_blocklist_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  excludedKeywordsJson: text("excluded_keywords_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  requiresVisaSponsorship: integer("requires_visa_sponsorship", { mode: "boolean" }).notNull().default(false),
  workAuthorizationNotes: text("work_authorization_notes"),
  hardRequirementsJson: text("hard_requirements_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index("job_search_targets_user_position_idx").on(table.userId, table.position),
]);

export const skills = sqliteTable("skills", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category"),
  proficiency: text("proficiency", { enum: ["beginner", "intermediate", "advanced", "expert"] }),
  yearsUsed: real("years_used"),
  userConfirmed: integer("user_confirmed", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("skills_user_name_idx").on(table.userId, table.name)]);

export const resumes = sqliteTable("resumes", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  currentVersionId: text("current_version_id"),
  title: text("title").notNull(),
  language: text("language", { enum: ["zh", "en"] }),
  resumeGroupId: text("resume_group_id"),
  sourceType: text("source_type", { enum: ["pdf", "docx", "txt", "editor"] }).notNull(),
  originalFilename: text("original_filename"),
  originalStoragePath: text("original_storage_path"),
  originalText: text("original_text"),
  contentHash: text("content_hash"),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  importedAt: timestamp("imported_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index("resumes_user_group_language_idx").on(table.userId, table.resumeGroupId, table.language),
]);

export const jobs = sqliteTable("jobs", {
  id: id(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull(),
  title: text("title").notNull(),
  location: text("location"),
  workplaceType: text("workplace_type", { enum: ["remote", "hybrid", "onsite", "unknown"] }).notNull().default("unknown"),
  employmentType: text("employment_type"),
  salaryMin: integer("salary_min"),
  salaryMax: integer("salary_max"),
  salaryCurrency: text("salary_currency"),
  descriptionText: text("description_text").notNull(),
  canonicalUrl: text("canonical_url"),
  canonicalKey: text("canonical_key").notNull(),
  listingStatus: text("listing_status", { enum: ["unknown", "active", "possibly_expired", "expired"] }).notNull().default("unknown"),
  listingCheckedAt: integer("listing_checked_at", { mode: "timestamp_ms" }),
  missingCheckCount: integer("missing_check_count").notNull().default(0),
  applicationDeadline: integer("application_deadline", { mode: "timestamp_ms" }),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  firstSeenAt: timestamp("first_seen_at"),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("jobs_owner_canonical_key_idx").on(table.ownerUserId, table.canonicalKey),
  index("jobs_owner_created_idx").on(table.ownerUserId, table.createdAt),
  index("jobs_listing_status_idx").on(table.listingStatus),
]);

export const ignoredJobs = sqliteTable("ignored_jobs", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  canonicalKey: text("canonical_key").notNull(),
  canonicalUrl: text("canonical_url"),
  companyName: text("company_name").notNull(),
  title: text("title").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("ignored_jobs_user_key_idx").on(table.userId, table.canonicalKey),
  index("ignored_jobs_user_created_idx").on(table.userId, table.createdAt),
]);

export const jobSources = sqliteTable("job_sources", {
  id: id(),
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  sourceType: text("source_type", { enum: ["manual", "extension", "company_site", "greenhouse", "lever", "ashby", "search", "other"] }).notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  externalId: text("external_id"),
  discoveredAt: timestamp("discovered_at"),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (table) => [index("job_sources_job_idx").on(table.jobId)]);

export const jobSnapshots = sqliteTable("job_snapshots", {
  id: id(),
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  sourceId: text("source_id").references(() => jobSources.id, { onDelete: "set null" }),
  contentHash: text("content_hash").notNull(),
  rawText: text("raw_text").notNull(),
  rawHtmlStoragePath: text("raw_html_storage_path"),
  httpStatus: integer("http_status"),
  listingEvidence: text("listing_evidence"),
  capturedAt: timestamp("captured_at"),
  createdAt: createdAt(),
}, (table) => [index("job_snapshots_job_idx").on(table.jobId, table.capturedAt)]);

export const experienceEvidence = sqliteTable("experience_evidence", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  resumeId: text("resume_id").references(() => resumes.id, { onDelete: "set null" }),
  evidenceType: text("evidence_type", { enum: ["experience", "project", "education", "achievement", "skill"] }).notNull(),
  title: text("title").notNull(),
  organization: text("organization"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  description: text("description").notNull(),
  factsJson: text("facts_json", { mode: "json" }).$type<Record<string, unknown>>(),
  sourceLocator: text("source_locator"),
  userConfirmed: integer("user_confirmed", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("experience_evidence_user_idx").on(table.userId)]);

export const resumeVersions = sqliteTable("resume_versions", {
  id: id(),
  resumeId: text("resume_id").notNull().references(() => resumes.id, { onDelete: "cascade" }),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
  parentVersionId: text("parent_version_id"),
  versionNumber: integer("version_number").notNull(),
  versionType: text("version_type", { enum: ["base", "tailored", "manual_edit"] }).notNull(),
  title: text("title").notNull(),
  structuredContentJson: text("structured_content_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  renderedText: text("rendered_text"),
  contentHash: text("content_hash"),
  changeSummary: text("change_summary"),
  factCheckStatus: text("fact_check_status", { enum: ["pending", "passed", "needs_review", "failed"] }).notNull().default("pending"),
  createdBy: text("created_by", { enum: ["user", "ai"] }).notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("resume_versions_number_idx").on(table.resumeId, table.versionNumber),
  index("resume_versions_job_idx").on(table.jobId),
]);

export const applications = sqliteTable("applications", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("to_apply"),
  selectedResumeVersionId: text("selected_resume_version_id").references(() => resumeVersions.id, { onDelete: "set null" }),
  nextAction: text("next_action"),
  nextActionAt: integer("next_action_at", { mode: "timestamp_ms" }),
  appliedAt: integer("applied_at", { mode: "timestamp_ms" }),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("applications_user_job_idx").on(table.userId, table.jobId),
  index("applications_status_idx").on(table.status),
]);

export const applicationEvents = sqliteTable("application_events", {
  id: id(),
  applicationId: text("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  eventType: text("event_type", { enum: ["created", "status_changed", "note_added", "material_added", "interview_scheduled", "reminder_set", "ai_run_completed"] }).notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  title: text("title").notNull(),
  detailsJson: text("details_json", { mode: "json" }).$type<Record<string, unknown>>(),
  actorType: text("actor_type", { enum: ["user", "system", "ai"] }).notNull(),
  occurredAt: timestamp("occurred_at"),
  createdAt: createdAt(),
}, (table) => [index("application_events_application_idx").on(table.applicationId, table.occurredAt)]);

export const jobMatches = sqliteTable("job_matches", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  resumeVersionId: text("resume_version_id").references(() => resumeVersions.id, { onDelete: "set null" }),
  matchedTargetId: text("matched_target_id").references(() => jobSearchTargets.id, { onDelete: "set null" }),
  overallScore: integer("overall_score").notNull(),
  skillsScore: integer("skills_score").notNull(),
  responsibilitiesScore: integer("responsibilities_score").notNull(),
  seniorityScore: integer("seniority_score").notNull(),
  locationScore: integer("location_score").notNull(),
  salaryScore: integer("salary_score"),
  industryScore: integer("industry_score"),
  authorizationScore: integer("authorization_score"),
  hardFilterPassed: integer("hard_filter_passed", { mode: "boolean" }).notNull(),
  evidenceJson: text("evidence_json", { mode: "json" }).$type<Array<{ evidenceId?: string; claim: string; source: string }>>().notNull(),
  gapsJson: text("gaps_json", { mode: "json" }).$type<string[]>().notNull(),
  uncertaintiesJson: text("uncertainties_json", { mode: "json" }).$type<string[]>().notNull(),
  modelName: text("model_name"),
  promptVersion: text("prompt_version"),
  createdAt: createdAt(),
}, (table) => [index("job_matches_job_user_idx").on(table.jobId, table.userId)]);

export const materials = sqliteTable("materials", {
  id: id(),
  applicationId: text("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  materialType: text("material_type", { enum: ["resume", "cover_letter", "portfolio", "assessment", "other"] }).notNull(),
  title: text("title").notNull(),
  status: text("status", { enum: ["needed", "draft", "ready", "submitted"] }).notNull().default("needed"),
  resumeVersionId: text("resume_version_id").references(() => resumeVersions.id, { onDelete: "set null" }),
  storagePath: text("storage_path"),
  contentText: text("content_text"),
  sourceRefsJson: text("source_refs_json", { mode: "json" }).$type<Array<{ type: string; id: string; quote?: string }>>().notNull().default([]),
  createdBy: text("created_by", { enum: ["user", "ai", "system"] }).notNull().default("user"),
  modelName: text("model_name"),
  promptVersion: text("prompt_version"),
  factCheckStatus: text("fact_check_status", { enum: ["pending", "passed", "needs_review", "failed"] }).notNull().default("pending"),
  dueAt: integer("due_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const interviews = sqliteTable("interviews", {
  id: id(),
  applicationId: text("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  format: text("format", { enum: ["phone", "video", "onsite", "take_home", "other"] }),
  scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }),
  durationMinutes: integer("duration_minutes"),
  interviewersJson: text("interviewers_json", { mode: "json" }).$type<Array<{ name?: string; title?: string }>>().notNull().default([]),
  notes: text("notes"),
  outcome: text("outcome"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const interviewQuestions = sqliteTable("interview_questions", {
  id: id(),
  interviewId: text("interview_id").references(() => interviews.id, { onDelete: "cascade" }),
  applicationId: text("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  category: text("category"),
  answerFramework: text("answer_framework"),
  answerDraft: text("answer_draft"),
  evidenceIdsJson: text("evidence_ids_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  missingInformationJson: text("missing_information_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  userConfirmed: integer("user_confirmed", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memories = sqliteTable("memories", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  memoryType: text("memory_type", { enum: ["capability_evidence", "preference", "star_story", "weakness", "goal"] }).notNull(),
  content: text("content").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  confidence: real("confidence").notNull(),
  userConfirmed: integer("user_confirmed", { mode: "boolean" }).notNull().default(false),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("memories_user_type_idx").on(table.userId, table.memoryType)]);

export const agentRuns = sqliteTable("agent_runs", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  runType: text("run_type", { enum: ["resume_parse", "resume_translate", "profile_analysis", "search_strategy", "smart_job_import", "job_match", "resume_tailor", "cover_letter", "company_research", "web_job_search", "interview_prep", "assistant"] }).notNull(),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed", "cancelled"] }).notNull().default("queued"),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  modelProvider: text("model_provider").notNull().default("deepseek"),
  modelName: text("model_name"),
  promptVersion: text("prompt_version"),
  inputRefsJson: text("input_refs_json", { mode: "json" }).$type<Array<{ type: string; id: string }>>().notNull().default([]),
  outputJson: text("output_json", { mode: "json" }).$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  toolCallCount: integer("tool_call_count").notNull().default(0),
  estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  retryCount: integer("retry_count").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("agent_runs_status_idx").on(table.status, table.createdAt)]);

export const aiUsageEvents = sqliteTable("ai_usage_events", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentRunId: text("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  taskType: text("task_type").notNull(),
  promptVersion: text("prompt_version"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  toolCallCount: integer("tool_call_count").notNull().default(0),
  estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  retryIndex: integer("retry_index").notNull().default(0),
  usageEstimated: integer("usage_estimated", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
}, (table) => [
  index("ai_usage_events_user_created_idx").on(table.userId, table.createdAt),
  index("ai_usage_events_agent_run_idx").on(table.agentRunId),
]);

export const backgroundJobs = sqliteTable("background_jobs", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  jobType: text("job_type", { enum: ["account_deletion", "agent_run", "listing_check", "watch_refresh", "web_job_search", "job_match", "smart_job_import", "profile_analysis", "company_recommendations", "company_source_setup", "cover_letter", "resume_parse", "resume_translate", "resume_optimize", "reminder_scan", "search_reindex"] }).notNull(),
  dedupeKey: text("dedupe_key"),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed", "cancelled"] }).notNull().default("queued"),
  payloadJson: text("payload_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  priority: integer("priority").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  runAfter: timestamp("run_after"),
  lockedAt: integer("locked_at", { mode: "timestamp_ms" }),
  claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
  lockedBy: text("locked_by"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  index("background_jobs_queue_idx").on(table.status, table.runAfter, table.priority),
  index("background_jobs_user_status_idx").on(table.userId, table.status, table.createdAt),
  uniqueIndex("background_jobs_user_dedupe_idx").on(table.userId, table.jobType, table.dedupeKey),
]);

export const watchRules = sqliteTable("watch_rules", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  keywordsJson: text("keywords_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  locationsJson: text("locations_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  remotePreference: text("remote_preference", { enum: ["any", "remote", "hybrid", "onsite"] }).notNull().default("any"),
  minimumSalary: integer("minimum_salary"),
  industriesJson: text("industries_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  companyAllowlistJson: text("company_allowlist_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  companyBlocklistJson: text("company_blocklist_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  frequencyMinutes: integer("frequency_minutes").notNull().default(1440),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sourceConnectors = sqliteTable("source_connectors", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["greenhouse", "lever", "ashby"] }).notNull(),
  name: text("name").notNull(),
  boardToken: text("board_token").notNull(),
  region: text("region", { enum: ["global", "eu"] }).notNull().default("global"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("source_connectors_user_provider_token_idx").on(table.userId, table.provider, table.boardToken),
  index("source_connectors_enabled_idx").on(table.userId, table.enabled),
]);

export const companyRecommendations = sqliteTable("company_recommendations", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull(),
  reason: text("reason").notNull(),
  roleFamiliesJson: text("role_families_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  locationsJson: text("locations_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  confidence: real("confidence").notNull(),
  uncertaintiesJson: text("uncertainties_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  status: text("status", { enum: ["suggested", "verified", "connected", "dismissed"] }).notNull().default("suggested"),
  officialWebsite: text("official_website"),
  careersUrl: text("careers_url"),
  atsProvider: text("ats_provider", { enum: ["greenhouse", "lever", "ashby"] }),
  boardToken: text("board_token"),
  verificationEvidenceJson: text("verification_evidence_json", { mode: "json" }).$type<Array<{ url: string; note: string }>>().notNull().default([]),
  verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("company_recommendations_user_company_idx").on(table.userId, table.companyName),
  index("company_recommendations_user_status_idx").on(table.userId, table.status),
]);

export type SearchMatrixItem = {
  id: string;
  targetId?: string;
  label: string;
  query: string;
  rationale: string;
  priority: "high" | "medium" | "low";
  locations: string[];
  platforms: Array<"public_web" | "linkedin" | "seek" | "zhipin" | "zhaopin" | "51job" | "liepin">;
};

export const searchPlans = sqliteTable("search_plans", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  strategySummary: text("strategy_summary").notNull(),
  matrixJson: text("matrix_json", { mode: "json" }).$type<SearchMatrixItem[]>().notNull(),
  modelName: text("model_name"),
  promptVersion: text("prompt_version"),
  createdAt: createdAt(),
}, (table) => [index("search_plans_user_created_idx").on(table.userId, table.createdAt)]);

export const searchChecklistItems = sqliteTable("search_checklist_items", {
  id: id(),
  searchPlanId: text("search_plan_id").notNull().references(() => searchPlans.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  matrixItemId: text("matrix_item_id").notNull(),
  label: text("label").notNull(),
  query: text("query").notNull(),
  location: text("location"),
  platform: text("platform", { enum: ["public_web", "linkedin", "seek", "zhipin", "zhaopin", "51job", "liepin"] }).notNull(),
  searchUrl: text("search_url"),
  priority: text("priority", { enum: ["high", "medium", "low"] }).notNull(),
  status: text("status", { enum: ["pending", "checked", "skipped"] }).notNull().default("pending"),
  checkedAt: integer("checked_at", { mode: "timestamp_ms" }),
  resultCount: integer("result_count"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("search_checklist_plan_matrix_platform_idx").on(table.searchPlanId, table.matrixItemId, table.platform, table.location),
  index("search_checklist_user_status_idx").on(table.userId, table.status),
]);

export const notifications = sqliteTable("notifications", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  notificationType: text("notification_type", { enum: ["new_matches", "listing_expired", "interview_reminder", "worker_failed", "ai_task_complete", "system"] }).notNull(),
  titleZh: text("title_zh").notNull(),
  titleEn: text("title_en").notNull(),
  bodyZh: text("body_zh").notNull(),
  bodyEn: text("body_en").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (table) => [index("notifications_user_read_idx").on(table.userId, table.readAt, table.createdAt)]);

export type AssistantContextMessage = {
  role: "user" | "assistant";
  content: string;
  contextContent?: string;
  intent?: "guide" | "resume_advice" | "resume_project" | "resume_sync" | "needs_information" | "out_of_scope";
  awaitingReply?: boolean;
};

export const assistantContexts = sqliteTable("assistant_contexts", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  messagesJson: text("messages_json", { mode: "json" }).$type<AssistantContextMessage[]>().notNull().default([]),
  summarizedMessageCount: integer("summarized_message_count").notNull().default(0),
  hasUnread: integer("has_unread", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("assistant_contexts_user_idx").on(table.userId)]);

export const searchDocuments = sqliteTable("search_documents", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentType: text("document_type", { enum: ["resume", "evidence", "memory", "job", "material", "interview"] }).notNull(),
  entityId: text("entity_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sourceLabel: text("source_label"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("search_documents_type_entity_idx").on(table.documentType, table.entityId),
  index("search_documents_user_idx").on(table.userId, table.documentType),
]);
