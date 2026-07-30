import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, applications, appSettings, backgroundJobs, careerPreferences, interviews, jobs, notifications, sourceConnectors, users } from "@/db/schema";
import { syncAllEnabledConnectors, syncConnector } from "@/lib/job-discovery";
import { ensureSearchIndex } from "@/lib/search-index";
import { checkListing, isListingCheckDue, listingCheckPriority } from "@/lib/listing-check";
import { runWebJobSearch } from "@/lib/web-job-search";
import { shouldScheduleWebSearch } from "@/lib/web-search-schedule";
import { providerSupportsAutomaticDiscovery } from "@/lib/ai-provider-config";
import { friendlyAgentError } from "@/lib/agent-errors";
import { processAccountDeletion } from "@/lib/account-deletion";
import { runBackgroundResumeParse } from "@/lib/resume-background";
import { runBackgroundResumeOptimization } from "@/lib/resume-optimization";
import { runBackgroundResumeTranslation } from "@/lib/resume-translation";
import { enqueueBackgroundJob } from "@/lib/background-queue";

const workerId = `worker-${randomUUID().slice(0, 8)}`;
const staleJobAgeMs = 6 * 60_000;
const staleAgentRunAgeMs = 10 * 60_000;

export function pickFairBackgroundJob<T extends { userId: string; priority: number; createdAt: Date }>(
  due: T[],
  lastClaim: ReadonlyMap<string, number>,
) {
  const bestPerUser = new Map<string, T>();
  for (const job of due) {
    const current = bestPerUser.get(job.userId);
    if (!current || job.priority > current.priority || (job.priority === current.priority && job.createdAt < current.createdAt)) bestPerUser.set(job.userId, job);
  }
  return [...bestPerUser.values()].sort((left, right) =>
    (lastClaim.get(left.userId) ?? 0) - (lastClaim.get(right.userId) ?? 0)
    || right.priority - left.priority
    || left.createdAt.getTime() - right.createdAt.getTime()
  )[0];
}

export function backgroundQueueRetryDelay(
  pending: ReadonlyArray<{ status: string; runAfter: Date | null }>,
  now = Date.now(),
) {
  if (!pending.length) return null;
  const nextQueuedAt = pending
    .filter((job) => job.status === "queued")
    .map((job) => job.runAfter?.getTime() ?? now)
    .sort((left, right) => left - right)[0];
  return nextQueuedAt == null
    ? 3_000
    : Math.min(30_000, Math.max(1_000, nextQueuedAt - now));
}

async function claimJob(userId?: string) {
  const now = new Date();
  const due = await db.select().from(backgroundJobs)
    .where(and(
      eq(backgroundJobs.status, "queued"),
      or(isNull(backgroundJobs.runAfter), lte(backgroundJobs.runAfter, now)),
      userId ? eq(backgroundJobs.userId, userId) : undefined,
    ))
    .orderBy(asc(backgroundJobs.createdAt))
    .limit(500)
    .all();
  const recentClaims = await db.select({ userId: backgroundJobs.userId, claimedAt: backgroundJobs.claimedAt })
    .from(backgroundJobs)
    .where(and(
      isNotNull(backgroundJobs.claimedAt),
      userId ? eq(backgroundJobs.userId, userId) : undefined,
    ))
    .orderBy(desc(backgroundJobs.claimedAt))
    .limit(1000)
    .all();
  const lastClaim = new Map<string, number>();
  for (const row of recentClaims) if (!lastClaim.has(row.userId)) lastClaim.set(row.userId, row.claimedAt?.getTime() ?? 0);
  const candidate = pickFairBackgroundJob(due, lastClaim);
  if (!candidate) return null;
  const claimed = await db.update(backgroundJobs).set({ status: "running", lockedAt: now, claimedAt: now, lockedBy: workerId, attempts: candidate.attempts + 1, updatedAt: now }).where(and(eq(backgroundJobs.id, candidate.id), eq(backgroundJobs.status, "queued"))).returning().get();
  return claimed ?? null;
}

export async function getBackgroundQueueState(userId: string) {
  const pending = await db.select({
    status: backgroundJobs.status,
    runAfter: backgroundJobs.runAfter,
  }).from(backgroundJobs).where(and(
    eq(backgroundJobs.userId, userId),
    or(eq(backgroundJobs.status, "queued"), eq(backgroundJobs.status, "running")),
  )).limit(100).all();
  const retryAfterMs = backgroundQueueRetryDelay(pending);
  return { pending: retryAfterMs != null, retryAfterMs };
}

async function scanInterviewReminders(userId: string) {
  const now = Date.now();
  const horizon = now + 24 * 60 * 60 * 1000;
  const rows = await db.select({ interview: interviews, application: applications, job: jobs }).from(interviews).innerJoin(applications, eq(interviews.applicationId, applications.id)).innerJoin(jobs, eq(applications.jobId, jobs.id)).where(eq(applications.userId, userId)).all();
  let created = 0;
  for (const row of rows) {
    const time = row.interview.scheduledAt?.getTime();
    if (!time || time < now || time > horizon) continue;
    const existing = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.notificationType, "interview_reminder"), eq(notifications.entityId, row.interview.id))).get();
    if (existing) continue;
    await db.insert(notifications).values({ userId: row.application.userId, notificationType: "interview_reminder", titleZh: "面试提醒", titleEn: "Interview reminder", bodyZh: `${row.job.companyName} · ${row.job.title} 的 ${row.interview.stage} 将在 24 小时内开始。`, bodyEn: `${row.interview.stage} for ${row.job.companyName} · ${row.job.title} starts within 24 hours.`, entityType: "interview", entityId: row.interview.id }).run();
    created += 1;
  }
  return created;
}

async function executeJob(job: typeof backgroundJobs.$inferSelect) {
  const payloadUserId = typeof job.payloadJson.userId === "string" ? job.payloadJson.userId : null;
  if (payloadUserId && payloadUserId !== job.userId) throw new Error("Background job tenant metadata does not match its payload.");
  if (job.jobType === "account_deletion") {
    return processAccountDeletion(job.userId);
  }
  const connectorId = typeof job.payloadJson.connectorId === "string" ? job.payloadJson.connectorId : null;
  if (job.jobType === "watch_refresh") {
    return connectorId ? syncConnector(connectorId, job.userId) : syncAllEnabledConnectors(job.userId);
  }
  if (job.jobType === "web_job_search") {
    return runWebJobSearch(job.userId);
  }
  if (job.jobType === "listing_check") {
    return typeof job.payloadJson.jobId === "string" ? checkListing(job.payloadJson.jobId, job.userId) : connectorId ? syncConnector(connectorId, job.userId) : syncAllEnabledConnectors(job.userId);
  }
  if (job.jobType === "reminder_scan") return scanInterviewReminders(job.userId);
  if (job.jobType === "search_reindex") return ensureSearchIndex(job.userId);
  if (job.jobType === "resume_parse") return runBackgroundResumeParse(job.payloadJson);
  if (job.jobType === "resume_translate") return runBackgroundResumeTranslation(job.payloadJson);
  if (job.jobType === "resume_optimize") return runBackgroundResumeOptimization(job.payloadJson);
  throw new Error("AI job execution is unavailable until a validated model-provider workflow is configured.");
}

function completedPayload(job: typeof backgroundJobs.$inferSelect) {
  if (job.jobType !== "resume_optimize") return job.payloadJson;
  const { content: _content, ...payload } = job.payloadJson;
  void _content;
  return payload;
}

export async function runWorkerOnce(userId?: string) {
  if (userId) await recoverStaleWorkForUser(userId);
  const job = await claimJob(userId);
  if (!job) return null;
  const heartbeat = setInterval(() => {
    void db.update(backgroundJobs)
      .set({ lockedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(backgroundJobs.id, job.id), eq(backgroundJobs.status, "running"), eq(backgroundJobs.lockedBy, workerId)))
      .run()
      .catch(() => undefined);
  }, 60_000);
  try {
    const result = await executeJob(job);
    await db.update(backgroundJobs).set({ status: "succeeded", payloadJson: completedPayload(job), lockedAt: null, lockedBy: null, lastError: null, updatedAt: new Date() }).where(eq(backgroundJobs.id, job.id)).run();
    return { id: job.id, status: "succeeded", result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    const retry = job.attempts < job.maxAttempts;
    await db.update(backgroundJobs).set({
      status: retry ? "queued" : "failed",
      payloadJson: retry ? job.payloadJson : completedPayload(job),
      runAfter: retry ? new Date(Date.now() + 60_000 * job.attempts) : job.runAfter,
      lockedAt: null,
      lockedBy: null,
      lastError: message,
      updatedAt: new Date(),
    }).where(eq(backgroundJobs.id, job.id)).run();
    if (!retry) {
      const user = await db.select().from(users).where(eq(users.id, job.userId)).get();
      if (user) {
        const isResumeOptimization = job.jobType === "resume_optimize";
        const isResumeTranslation = job.jobType === "resume_translate";
        await db.insert(notifications).values({
          userId: user.id,
          notificationType: "worker_failed",
          titleZh: isResumeOptimization ? "简历优化任务未完成" : isResumeTranslation ? "双语简历生成未完成" : "后台任务失败",
          titleEn: isResumeOptimization ? "Resume optimization did not finish" : isResumeTranslation ? "Bilingual resume generation did not finish" : "Background task failed",
          bodyZh: isResumeOptimization || isResumeTranslation ? friendlyAgentError(message, "zh") : message,
          bodyEn: isResumeOptimization || isResumeTranslation ? friendlyAgentError(message, "en") : message,
          entityType: isResumeOptimization || isResumeTranslation ? "resume" : "background_job",
          entityId: (isResumeOptimization || isResumeTranslation) && typeof job.payloadJson.resumeId === "string" ? job.payloadJson.resumeId : job.id,
        }).run();
      }
    }
    return { id: job.id, status: retry ? "queued" : "failed", error: message };
  } finally {
    clearInterval(heartbeat);
  }
}

export async function recoverStaleWorkForUser(userId: string) {
  const settings = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).get();
  const staleBefore = new Date(Date.now() - staleJobAgeMs);
  const staleAgentBefore = new Date(Date.now() - staleAgentRunAgeMs);
  await db.update(agentRuns).set({
    status: "failed",
    errorCode: "INTERRUPTED",
    errorMessage: "Recovered after JobPilot stopped before completing this AI task.",
    finishedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(agentRuns.userId, userId), eq(agentRuns.status, "running"), lte(agentRuns.startedAt, staleAgentBefore))).run();
  const staleJobs = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.userId, userId), eq(backgroundJobs.status, "running"), lte(backgroundJobs.lockedAt, staleBefore))).all();
  for (const staleJob of staleJobs) {
    const retry = staleJob.attempts < staleJob.maxAttempts;
    const message = "Recovered after the background worker stopped before completing this task.";
    await db.update(backgroundJobs).set({ status: retry ? "queued" : "failed", runAfter: retry ? new Date() : staleJob.runAfter, lockedAt: null, lockedBy: null, lastError: message, updatedAt: new Date() }).where(and(eq(backgroundJobs.id, staleJob.id), eq(backgroundJobs.status, "running"))).run();
    if (!retry && settings?.notificationsEnabled !== false) {
      const existing = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.notificationType, "worker_failed"), eq(notifications.entityId, staleJob.id))).get();
      if (!existing) await db.insert(notifications).values({ userId, notificationType: "worker_failed", titleZh: "后台任务中断", titleEn: "Background task interrupted", bodyZh: "任务在后台中断后已停止，请在自动化页面重新运行。", bodyEn: message, entityType: "background_job", entityId: staleJob.id }).run();
    }
  }
}

export async function scheduleDueJobs() {
  const userRows = await db.select().from(users).all();
  for (const user of userRows) await scheduleDueJobsForUser(user);
}

async function scheduleDueJobsForUser(user: typeof users.$inferSelect) {
  const settings = await db.select().from(appSettings).where(eq(appSettings.userId, user.id)).get();
  if (settings && !settings.workerEnabled) return;
  await recoverStaleWorkForUser(user.id);
  const preference = await db.select().from(careerPreferences).where(eq(careerPreferences.userId, user.id)).get();
  const pendingListingChecks = await db.select({ payloadJson: backgroundJobs.payloadJson }).from(backgroundJobs).where(and(eq(backgroundJobs.userId, user.id), eq(backgroundJobs.jobType, "listing_check"), or(eq(backgroundJobs.status, "queued"), eq(backgroundJobs.status, "running")))).all();
  const listingCheckCapacity = Math.max(0, 10 - pendingListingChecks.length);
  if (listingCheckCapacity) {
    const pendingJobIds = new Set(pendingListingChecks.map((item) => item.payloadJson.jobId).filter((id): id is string => typeof id === "string"));
    const now = new Date();
    const candidates = await db.select({
      id: jobs.id,
      listingStatus: jobs.listingStatus,
      listingCheckedAt: jobs.listingCheckedAt,
      applicationDeadline: jobs.applicationDeadline,
      applicationId: applications.id,
    }).from(jobs)
      .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, user.id)))
      .where(and(eq(jobs.ownerUserId, user.id), ne(jobs.listingStatus, "expired"), isNotNull(jobs.canonicalUrl)))
      .orderBy(asc(jobs.listingCheckedAt))
      .limit(250)
      .all();
    const dueListings = candidates
      .filter((item) => !pendingJobIds.has(item.id) && isListingCheckDue({ ...item, hasApplication: Boolean(item.applicationId) }, now))
      .sort((a, b) => listingCheckPriority({ ...a, hasApplication: Boolean(a.applicationId) }, now) - listingCheckPriority({ ...b, hasApplication: Boolean(b.applicationId) }, now));
    for (const listing of dueListings.slice(0, listingCheckCapacity)) {
      await enqueueBackgroundJob({ userId: user.id, jobType: "listing_check", dedupeKey: listing.id, payloadJson: { jobId: listing.id }, priority: 3 });
    }
  }
  const queuedRefresh = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.userId, user.id), eq(backgroundJobs.jobType, "watch_refresh"), or(eq(backgroundJobs.status, "queued"), eq(backgroundJobs.status, "running")))).get();
  const latestWebSearch = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.userId, user.id), eq(backgroundJobs.jobType, "web_job_search"))).orderBy(desc(backgroundJobs.createdAt)).get();
  const dueSources = await db.select().from(sourceConnectors).where(and(eq(sourceConnectors.userId, user.id), eq(sourceConnectors.enabled, true))).all();
  const refreshDueAt = Date.now() - (preference?.searchFrequencyMinutes ?? 1440) * 60_000;
  const refreshDue = dueSources.some((source) => !source.lastSyncAt || source.lastSyncAt.getTime() <= refreshDueAt);
  if (preference?.searchEnabled && refreshDue && !queuedRefresh) await enqueueBackgroundJob({ userId: user.id, jobType: "watch_refresh", dedupeKey: "scheduled", payloadJson: {}, priority: 5 });
  const webSearchDue = shouldScheduleWebSearch({
    now: new Date(),
    frequencyMinutes: preference?.searchFrequencyMinutes ?? 1440,
    lastSearchAt: preference?.lastSearchAt,
    latestJob: latestWebSearch,
  });
  if (preference?.searchEnabled && settings?.aiEnabled && settings.webSearchEnabled && providerSupportsAutomaticDiscovery(settings.aiProvider) && webSearchDue) await enqueueBackgroundJob({ userId: user.id, jobType: "web_job_search", dedupeKey: "scheduled", payloadJson: {}, priority: 4 });
  const latestReminder = await db.select().from(backgroundJobs).where(and(eq(backgroundJobs.userId, user.id), eq(backgroundJobs.jobType, "reminder_scan"))).orderBy(desc(backgroundJobs.updatedAt)).get();
  if (!latestReminder || latestReminder.updatedAt.getTime() < Date.now() - 15 * 60_000) await enqueueBackgroundJob({ userId: user.id, jobType: "reminder_scan", dedupeKey: "scheduled", payloadJson: {}, priority: 2 });
}
