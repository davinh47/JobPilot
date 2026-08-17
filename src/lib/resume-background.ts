import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentRuns, appSettings, notifications, resumes, resumeVersions } from "@/db/schema";
import { queueSearchReindex } from "@/lib/background-queue";
import { createDefaultPlatformResume, createResumeEntry, isPlatformResume, normalizePlatformResume, parseResumeText, renderResumeText, type PlatformResume } from "@/lib/resume-format";
import { structureResumeTextWithAi } from "@/lib/resume-structure-ai";
import { hasAiProviderKey } from "@/lib/secrets";
import { appendResumeVersionTx, ResumeVersionConflictError } from "@/lib/resume-versions";
import { selectAiModel } from "@/lib/ai-models";
import { promptVersion } from "@/lib/prompt-registry";

type ResumeParsePayload = {
  userId: string;
  resumeId: string;
  sourceVersionId: string;
  locale: "zh" | "en";
  sectionTemplate?: PlatformResume["sections"];
};

const resumeSectionTemplateSchema = z.array(z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["experience_projects", "experience", "education", "skills", "projects", "certifications", "other"]),
  title: z.string().trim().min(1).max(200),
})).min(1).max(30);

function resumeParsePayload(payload: Record<string, unknown>): ResumeParsePayload {
  const locale = payload.locale === "en" ? "en" : "zh";
  if (typeof payload.userId !== "string" || typeof payload.resumeId !== "string" || typeof payload.sourceVersionId !== "string") {
    throw new Error("resume_parse requires userId, resumeId, and sourceVersionId.");
  }
  const sectionTemplate = payload.sectionTemplate === undefined
    ? undefined
    : resumeSectionTemplateSchema.parse(payload.sectionTemplate).map((section) => ({
      ...section,
      content: "",
      entries: [createResumeEntry(section.type)],
    }));
  return { userId: payload.userId, resumeId: payload.resumeId, sourceVersionId: payload.sourceVersionId, locale, sectionTemplate };
}

export async function runBackgroundResumeParse(payloadJson: Record<string, unknown>) {
  const payload = resumeParsePayload(payloadJson);
  const [resume, sourceVersion, settings] = await Promise.all([
    db.select().from(resumes).where(and(eq(resumes.id, payload.resumeId), eq(resumes.userId, payload.userId))).get(),
    db.select().from(resumeVersions).where(and(eq(resumeVersions.id, payload.sourceVersionId), eq(resumeVersions.resumeId, payload.resumeId))).get(),
    db.select().from(appSettings).where(eq(appSettings.userId, payload.userId)).get(),
  ]);
  if (!resume || !sourceVersion) throw new Error("The imported resume or its local source version no longer exists.");
  if (!settings?.aiEnabled || !await hasAiProviderKey(settings.aiProvider, payload.userId)) return { skipped: "AI assistance is disabled or its API key is unavailable." };

  const templateVersion = await db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, resume.id)).orderBy(desc(resumeVersions.versionNumber)).limit(1).get();
  if (!templateVersion) throw new Error("No editable resume version is available.");
  const fallback = isPlatformResume(templateVersion.structuredContentJson)
    ? normalizePlatformResume(templateVersion.structuredContentJson)
    : parseResumeText(resume.originalText ?? templateVersion.renderedText ?? "");
  const sectionTemplate = payload.sectionTemplate ?? (templateVersion.id === sourceVersion.id
    ? createDefaultPlatformResume(payload.locale).sections
    : fallback.sections);
  const sourceText = resume.originalText?.trim() || sourceVersion.renderedText?.trim() || "";
  if (!sourceText) throw new Error("The imported resume has no source text to organize.");

  const model = selectAiModel(settings, "complex");
  const versionName = promptVersion("resumeStructure");
  const run = await db.insert(agentRuns).values({
    userId: payload.userId,
    runType: "resume_parse",
    status: "running",
    entityType: "resume",
    entityId: resume.id,
    modelProvider: settings.aiProvider,
    modelName: model,
    promptVersion: versionName,
    inputRefsJson: [{ type: "resume", id: resume.id }, { type: "resume_version", id: templateVersion.id }],
    startedAt: new Date(),
  }).returning().get();

  try {
    const structured = await structureResumeTextWithAi({
      userId: payload.userId,
      sourceText,
      fallback,
      locale: payload.locale,
      provider: settings.aiProvider,
      apiBaseUrl: settings.aiBaseUrl,
      model,
      agentRunId: run.id,
      promptVersion: versionName,
      sectionTemplate,
    });
    const latest = await db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, resume.id)).orderBy(desc(resumeVersions.versionNumber)).limit(1).get();
    if (!latest || latest.id !== templateVersion.id || latest.versionNumber !== templateVersion.versionNumber) {
      await db.update(agentRuns).set({
        status: "succeeded",
        outputJson: { skipped: "newer_user_version", rejectedFieldCount: structured.rejectedFieldCount, rejectedEntryCount: structured.rejectedEntryCount, unmappedLineCount: structured.unmappedLineCount },
        finishedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(agentRuns.id, run.id)).run();
      if (settings.notificationsEnabled) {
        await db.insert(notifications).values({
          userId: payload.userId,
          notificationType: "system",
          titleZh: "简历 AI 整理未自动应用",
          titleEn: "AI resume organization was not applied",
          bodyZh: "你在 AI 整理期间保存了更新版本。为保护这些修改，JobPilot 没有加入较旧的 AI 结果；可在编辑页重新运行。",
          bodyEn: "You saved a newer version while AI was working. JobPilot kept your edits and did not add the older AI result; run it again from the editor.",
          entityType: "resume",
          entityId: resume.id,
        }).run();
      }
      return { skipped: "A newer user version was saved while AI was working." };
    }

    const fallbackTimedOut = structured.usedLocalFallback && /timed out|timeout|aborted/i.test(structured.fallbackReason);
    const version = await db.transaction(async (tx) => {
      const created = await appendResumeVersionTx(tx, {
        resumeId: resume.id,
        expectedVersionId: latest.id,
        versionType: latest.versionType === "tailored" ? "tailored" : "manual_edit",
        title: latest.title,
        structuredContentJson: structured.content,
        renderedText: renderResumeText(structured.content),
        changeSummary: structured.usedLocalFallback
          ? fallbackTimedOut
            ? payload.locale === "zh" ? "AI 请求超时，JobPilot 已保留当前本地结构和原文；请稍后重试或更换模型。" : "The AI request timed out, so JobPilot kept the current local structure and source text. Try again later or switch models."
            : payload.locale === "zh" ? "AI 输出不完整，JobPilot 已保留当前本地结构和原文；请稍后重试 AI 整理。" : "The AI output was incomplete, so JobPilot kept the current local structure and source text. Try AI organization again later."
          : payload.locale === "zh" ? "AI 已在后台依据原件和当前模块完成结构整理；未能归类的原文已保留。" : "AI organized the source in the background using the current sections; unclassified source text was preserved.",
        factCheckStatus: "needs_review",
        createdBy: "ai",
      });
      await tx.update(agentRuns).set({
        status: "succeeded",
        outputJson: { resumeVersionId: created.id, rejectedFieldCount: structured.rejectedFieldCount, rejectedEntryCount: structured.rejectedEntryCount, unmappedLineCount: structured.unmappedLineCount, usedLocalFallback: structured.usedLocalFallback, fallbackReason: structured.fallbackReason || undefined },
        finishedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(agentRuns.id, run.id)).run();
      if (settings.notificationsEnabled) {
        await tx.insert(notifications).values({
          userId: payload.userId,
          notificationType: "system",
          titleZh: structured.usedLocalFallback ? fallbackTimedOut ? "AI 整理请求超时，已保留本地内容" : "AI 整理未完成，已保留本地内容" : "简历 AI 整理完成",
          titleEn: structured.usedLocalFallback ? fallbackTimedOut ? "AI organization timed out; local content was kept" : "AI organization was incomplete; local content was kept" : "AI resume organization complete",
          bodyZh: structured.usedLocalFallback
            ? fallbackTimedOut
              ? `“${resume.title}”的 AI 请求超时，JobPilot 已保留当前本地结构和原文，没有丢失内容。你可以稍后重试，或更换模型。`
              : `“${resume.title}”的模型输出不完整，JobPilot 已保留当前本地结构和原文，没有丢失内容。你可以稍后重试，或更换模型。`
            : `“${resume.title}”的当前编辑版已完成结构整理，请检查后继续编辑。`,
          bodyEn: structured.usedLocalFallback
            ? fallbackTimedOut
              ? `The AI request for “${resume.title}” timed out. JobPilot kept the current local structure and source text without dropping content. Try again later or switch models.`
              : `The model output for “${resume.title}” was incomplete. JobPilot kept the current local structure and source text without dropping content. Try again later or switch models.`
            : `The current editable copy of “${resume.title}” has been organized and is ready for review.`,
          entityType: "resume",
          entityId: resume.id,
        }).run();
      }
      return created;
    });
    await queueSearchReindex(payload.userId);
    return { resumeVersionId: version.id, versionNumber: version.versionNumber };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown resume structure error";
    await db.update(agentRuns).set({
      status: error instanceof ResumeVersionConflictError ? "succeeded" : "failed",
      errorCode: error instanceof ResumeVersionConflictError ? null : "RESUME_PARSE_ERROR",
      errorMessage: error instanceof ResumeVersionConflictError ? null : message,
      outputJson: error instanceof ResumeVersionConflictError ? { skipped: "newer_user_version" } : undefined,
      finishedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(agentRuns.id, run.id)).run();
    if (error instanceof ResumeVersionConflictError) return { skipped: "A newer user version was saved while AI was working." };
    throw error;
  }
}
