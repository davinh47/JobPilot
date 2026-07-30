"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { applicationEvents, applications, interviews, interviewQuestions } from "@/db/schema";
import { queueSearchReindex } from "@/lib/background-queue";
import { getCurrentUser } from "@/lib/current-user";

export async function scheduleInterview(formData: FormData) {
  const parsed = z.object({ applicationId: z.string().uuid(), jobId: z.string().uuid(), stage: z.string().trim().min(2).max(80), format: z.enum(["phone", "video", "onsite", "take_home", "other"]), scheduledAt: z.string().min(10), durationMinutes: z.coerce.number().int().min(5).max(1440), notes: z.string().trim().max(3000).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const application = await db.select().from(applications).where(and(eq(applications.id, parsed.data.applicationId), eq(applications.userId, user.id), eq(applications.jobId, parsed.data.jobId))).get();
  if (!application) return;
  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) return;
  await db.transaction(async (tx) => {
    const interview = await tx.insert(interviews).values({ applicationId: application.id, stage: parsed.data.stage, format: parsed.data.format, scheduledAt, durationMinutes: parsed.data.durationMinutes, notes: parsed.data.notes || null }).returning().get();
    await tx.insert(applicationEvents).values({ applicationId: application.id, eventType: "interview_scheduled", title: `Interview scheduled: ${parsed.data.stage}`, detailsJson: { interviewId: interview.id, scheduledAt: scheduledAt.toISOString() }, actorType: "user" }).run();
    if (application.status !== "interview_pending") await tx.update(applications).set({ status: "interview_pending", nextAction: `Prepare for ${parsed.data.stage}`, nextActionAt: scheduledAt, updatedAt: new Date() }).where(eq(applications.id, application.id)).run();
  });
  revalidatePath(`/jobs/${parsed.data.jobId}`);
  revalidatePath("/interviews");
  revalidatePath("/pipeline");
  await queueSearchReindex(application.userId);
}

export async function addInterviewQuestion(formData: FormData) {
  const parsed = z.object({ applicationId: z.string().uuid(), interviewId: z.union([z.literal(""), z.string().uuid()]), question: z.string().trim().min(5).max(500), answerFramework: z.string().trim().max(6000).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const application = await db.select().from(applications).where(and(eq(applications.id, parsed.data.applicationId), eq(applications.userId, user.id))).get();
  if (!application) return;
  if (parsed.data.interviewId) {
    const interview = await db.select().from(interviews).where(and(eq(interviews.id, parsed.data.interviewId), eq(interviews.applicationId, application.id))).get();
    if (!interview) return;
  }
  await db.insert(interviewQuestions).values({ applicationId: parsed.data.applicationId, interviewId: parsed.data.interviewId || null, question: parsed.data.question, answerFramework: parsed.data.answerFramework || null }).run();
  await queueSearchReindex(application.userId);
  revalidatePath("/interviews");
}
