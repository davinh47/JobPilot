"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, jobs } from "@/db/schema";
import { getCurrentUser } from "@/lib/current-user";
import { queueJobMatch } from "@/lib/background-queue";
import { hasAiProviderKey } from "@/lib/secrets";

export async function analyzeJobMatch(input: { jobId: string; locale: "zh" | "en" }) {
  const checked = z.object({ jobId: z.string().uuid(), locale: z.enum(["zh", "en"]) }).safeParse(input);
  if (!checked.success) return { ok: false as const, error: input.locale === "en" ? "Invalid job." : "岗位信息无效。" };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: checked.data.locale === "en" ? "Please sign in first." : "请先登录。" };
  const [job, settings] = await Promise.all([
    db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, checked.data.jobId), eq(jobs.ownerUserId, user.id))).get(),
    db.select().from(appSettings).where(eq(appSettings.userId, user.id)).get(),
  ]);
  if (!job) return { ok: false as const, error: checked.data.locale === "en" ? "Job not found." : "找不到这个岗位。" };
  if (!settings?.aiEnabled || !await hasAiProviderKey(settings.aiProvider, user.id)) {
    return { ok: false as const, error: checked.data.locale === "en" ? "Enable AI and configure the selected provider key first." : "请先开启 AI 并配置当前提供商的 API Key。" };
  }
  if (settings.workerEnabled === false) {
    return { ok: false as const, error: checked.data.locale === "en" ? "Background jobs are disabled. Enable them in Sources & automation first." : "后台任务已关闭，请先在“岗位来源与自动化”中开启。" };
  }
  const queued = await queueJobMatch({ userId: user.id, jobId: checked.data.jobId, locale: checked.data.locale });
  revalidatePath(`/jobs/${checked.data.jobId}`);
  revalidatePath("/matches");
  return { ok: true as const, queued: true as const, jobId: checked.data.jobId, backgroundJobId: queued.jobId };
}
