import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { backgroundJobs } from "@/db/schema";
import type { PlatformResume } from "@/lib/resume-format";

type BackgroundJobType = typeof backgroundJobs.$inferInsert.jobType;

export async function enqueueBackgroundJob(input: {
  userId: string;
  jobType: BackgroundJobType;
  payloadJson: Record<string, unknown>;
  dedupeKey?: string;
  priority?: number;
  runAfter?: Date;
  maxAttempts?: number;
}) {
  const payloadJson = { ...input.payloadJson, userId: input.userId };
  if (input.dedupeKey) {
    const existing = await db.select({ id: backgroundJobs.id, status: backgroundJobs.status })
      .from(backgroundJobs)
      .where(and(
        eq(backgroundJobs.userId, input.userId),
        eq(backgroundJobs.jobType, input.jobType),
        eq(backgroundJobs.dedupeKey, input.dedupeKey),
      ))
      .get();
    if (existing?.status === "running") return { queued: false, jobId: existing.id };
    if (existing?.status === "queued") {
      await db.update(backgroundJobs).set({
        payloadJson,
        priority: input.priority ?? 0,
        maxAttempts: input.maxAttempts ?? 3,
        runAfter: input.runAfter ?? new Date(),
        lastError: null,
        updatedAt: new Date(),
      }).where(and(eq(backgroundJobs.id, existing.id), eq(backgroundJobs.status, "queued"))).run();
      return { queued: true, jobId: existing.id };
    }
    if (existing) {
      await db.update(backgroundJobs).set({
        status: "queued",
        payloadJson,
        priority: input.priority ?? 0,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 3,
        runAfter: input.runAfter ?? new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        updatedAt: new Date(),
      }).where(and(eq(backgroundJobs.id, existing.id), or(
        eq(backgroundJobs.status, "succeeded"),
        eq(backgroundJobs.status, "failed"),
        eq(backgroundJobs.status, "cancelled"),
      ))).run();
      return { queued: true, jobId: existing.id };
    }
  }
  const inserted = await db.insert(backgroundJobs).values({
    userId: input.userId,
    jobType: input.jobType,
    dedupeKey: input.dedupeKey,
    payloadJson,
    priority: input.priority ?? 0,
    maxAttempts: input.maxAttempts ?? 3,
    runAfter: input.runAfter ?? new Date(),
  }).onConflictDoNothing().returning({ id: backgroundJobs.id }).get();
  if (inserted) return { queued: true, jobId: inserted.id };
  const raced = input.dedupeKey
    ? await db.select({ id: backgroundJobs.id }).from(backgroundJobs).where(and(
      eq(backgroundJobs.userId, input.userId),
      eq(backgroundJobs.jobType, input.jobType),
      eq(backgroundJobs.dedupeKey, input.dedupeKey),
    )).get()
    : undefined;
  return { queued: false, jobId: raced?.id };
}

export async function queueSearchReindex(userId: string) {
  await enqueueBackgroundJob({
    userId,
    jobType: "search_reindex",
    dedupeKey: "current",
    payloadJson: {},
    priority: 1,
  });
}

export async function queueResumeParse(input: { userId: string; resumeId: string; sourceVersionId: string; locale: "zh" | "en"; sectionTemplate?: PlatformResume["sections"] }) {
  return enqueueBackgroundJob({
    userId: input.userId,
    jobType: "resume_parse",
    dedupeKey: `${input.resumeId}:${input.sourceVersionId}`,
    payloadJson: input,
    priority: 6,
  });
}

export async function queueJobMatch(input: { userId: string; jobId: string; locale: "zh" | "en" }) {
  return enqueueBackgroundJob({
    userId: input.userId,
    jobType: "job_match",
    dedupeKey: input.jobId,
    payloadJson: input,
    priority: 5,
    maxAttempts: 2,
  });
}

export async function queueSmartJobImport(input: { userId: string; jobId: string; pageUrl: string }) {
  return enqueueBackgroundJob({
    userId: input.userId,
    jobType: "smart_job_import",
    dedupeKey: input.jobId,
    payloadJson: input,
    priority: 8,
    maxAttempts: 2,
  });
}

export async function queueProfileAnalysis(userId: string, locale: "zh" | "en") {
  return enqueueBackgroundJob({
    userId,
    jobType: "profile_analysis",
    dedupeKey: "current",
    payloadJson: { locale },
    priority: 6,
    maxAttempts: 2,
  });
}

export async function queueConnectorRefresh(input: { userId: string; connectorId?: string }) {
  const connectorId = input.connectorId ?? null;
  return enqueueBackgroundJob({
    userId: input.userId,
    jobType: "watch_refresh",
    dedupeKey: `manual:${connectorId ?? "all"}`,
    payloadJson: connectorId ? { connectorId } : {},
    priority: 5,
    maxAttempts: 2,
  });
}

export async function queueCoverLetter(input: { userId: string; jobId: string; tone: "professional" | "concise" | "warm"; outputLanguage: "zh" | "en" }) {
  return enqueueBackgroundJob({
    userId: input.userId,
    jobType: "cover_letter",
    dedupeKey: `${input.jobId}:${input.outputLanguage}`,
    payloadJson: { jobId: input.jobId, tone: input.tone, outputLanguage: input.outputLanguage },
    priority: 5,
    maxAttempts: 2,
  });
}

export async function queueResumeTranslation(input: { userId: string; resumeId: string; targetLanguage: "zh" | "en" }) {
  const result = await enqueueBackgroundJob({
    userId: input.userId,
    jobType: "resume_translate",
    dedupeKey: `${input.resumeId}:${input.targetLanguage}`,
    payloadJson: input,
    priority: 6,
  });
  return result.queued;
}
