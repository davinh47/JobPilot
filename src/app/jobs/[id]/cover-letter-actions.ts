"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { applications, appSettings, jobs } from "@/db/schema";
import { getCurrentUser } from "@/lib/current-user";
import { findResumeVersionForLanguage } from "@/lib/resume-version-language";
import { queueCoverLetter } from "@/lib/background-queue";

export async function generateCoverLetter(formData: FormData) {
  const parsed = z.object({
    jobId: z.string().uuid(),
    tone: z.enum(["professional", "concise", "warm"]),
    outputLanguage: z.enum(["zh", "en"]),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const [job, application, settings] = await Promise.all([
    db.select().from(jobs).where(and(eq(jobs.id, parsed.data.jobId), eq(jobs.ownerUserId, user.id))).get(),
    db.select().from(applications).where(and(eq(applications.userId, user.id), eq(applications.jobId, parsed.data.jobId))).get(),
    db.select().from(appSettings).where(eq(appSettings.userId, user.id)).get(),
  ]);
  if (!job || !application || !settings?.aiEnabled) redirect(`/jobs/${parsed.data.jobId}?coverLetter=unavailable`);
  const resumeSource = await findResumeVersionForLanguage(user.id, parsed.data.outputLanguage, {
    preferredVersionId: application.selectedResumeVersionId,
    jobId: job.id,
  });
  if (!resumeSource?.version?.renderedText?.trim()) redirect(`/jobs/${job.id}?coverLetter=language-missing&outputLanguage=${parsed.data.outputLanguage}`);

  await queueCoverLetter({
    userId: user.id,
    jobId: job.id,
    tone: parsed.data.tone,
    outputLanguage: parsed.data.outputLanguage,
  });
  redirect(`/jobs/${job.id}?coverLetter=queued&outputLanguage=${parsed.data.outputLanguage}`);
}
