import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentRuns, appSettings, notifications, resumes, resumeVersions } from "@/db/schema";
import { requestStructuredAiJson } from "@/lib/ai-provider";
import { createResumeEntry, isPlatformResume, normalizePlatformResume, renderResumeText, type PlatformResume, type ResumeEntry } from "@/lib/resume-format";
import { assistantResumeSyncEntrySchema } from "@/lib/jobpilot-assistant";
import { appendResumeVersionTx, ResumeVersionConflictError } from "@/lib/resume-versions";
import { selectAiModel } from "@/lib/ai-models";
import { promptVersion } from "@/lib/prompt-registry";

const translationHeaderSchema = z.object({
  headline: z.string().max(300),
  location: z.string().max(300),
  additionalInfo: z.string().max(3000),
  summary: z.string().max(20_000),
});

const sectionTranslationSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(80_000),
});

const entryTranslationBatchSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1).max(100),
    entry: assistantResumeSyncEntrySchema,
  })).min(1).max(3),
});

function numericClaims(value: string) {
  return new Set(value.match(/\b\d+(?:[.,]\d+)*(?:%|k|m|b)?\b/gi) ?? []);
}

export function translationIntroducedNumbers(source: unknown, translated: unknown) {
  const sourceNumbers = numericClaims(JSON.stringify(source));
  return [...numericClaims(JSON.stringify(translated))].filter((value) => !sourceNumbers.has(value));
}

function translatedTitle(title: string, targetLanguage: "zh" | "en") {
  const base = title
    .replace(/\s*[（(](?:中文|英文|Chinese|English)(?:版| version)?[)）]\s*$/i, "")
    .trim();
  return targetLanguage === "zh" ? `${base}（中文版）` : `${base} (English)`;
}

function compactEntry(entry: ResumeEntry) {
  const { id, kind, ...fields } = entry;
  return { id, kind, fields };
}

function entryWithTranslatedFields(source: ResumeEntry, translated: z.infer<typeof assistantResumeSyncEntrySchema>): ResumeEntry {
  return {
    ...createResumeEntry(source.kind),
    ...translated,
    id: source.id,
    kind: source.kind,
    category: source.category,
  };
}

export async function runBackgroundResumeTranslation(payload: Record<string, unknown>) {
  const input = z.object({
    userId: z.string().uuid(),
    resumeId: z.string().uuid(),
    targetLanguage: z.enum(["zh", "en"]),
  }).parse(payload);
  const [sourceResume, settings] = await Promise.all([
    db.select().from(resumes).where(and(eq(resumes.id, input.resumeId), eq(resumes.userId, input.userId))).get(),
    db.select().from(appSettings).where(eq(appSettings.userId, input.userId)).get(),
  ]);
  if (!sourceResume) throw new Error("The source resume no longer exists.");
  if (!settings?.aiEnabled) throw new Error("AI assistance is disabled.");
  if (sourceResume.language === input.targetLanguage) throw new Error("The requested resume language already matches the source.");
  const groupId = sourceResume.resumeGroupId || sourceResume.id;
  const existingTarget = await db.select().from(resumes).where(and(
    eq(resumes.userId, input.userId),
    eq(resumes.resumeGroupId, groupId),
    eq(resumes.language, input.targetLanguage),
  )).get();
  if (existingTarget) throw new Error("This resume group already has the requested language version.");
  const sourceVersion = await db.select().from(resumeVersions)
    .where(eq(resumeVersions.resumeId, sourceResume.id))
    .orderBy(desc(resumeVersions.versionNumber))
    .limit(1)
    .get();
  if (!sourceVersion || !isPlatformResume(sourceVersion.structuredContentJson)) throw new Error("The source resume has no editable JobPilot version.");
  if (sourceVersion.versionType === "tailored") throw new Error("Only base resumes can create a paired language version.");
  const source = normalizePlatformResume(sourceVersion.structuredContentJson as PlatformResume);
  const languageName = input.targetLanguage === "zh" ? "professional resume Chinese" : "professional resume English";
  const model = selectAiModel(settings, "complex");
  const versionName = promptVersion("resumeTranslation");
  const run = await db.insert(agentRuns).values({
    userId: input.userId,
    runType: "resume_translate",
    status: "running",
    entityType: "resume",
    entityId: sourceResume.id,
    modelProvider: settings.aiProvider,
    modelName: model,
    promptVersion: versionName,
    inputRefsJson: [{ type: "resume", id: sourceResume.id }, { type: "resume_version", id: sourceVersion.id }],
    startedAt: new Date(),
  }).returning().get();

  const request = <T>(schema: z.ZodType<T>, system: string, user: string, maxOutputTokens = 8000) => requestStructuredAiJson({
    userId: input.userId,
    provider: settings.aiProvider,
    apiBaseUrl: settings.aiBaseUrl,
    model,
    agentRunId: run.id,
    taskType: "resume_translation",
    promptVersion: versionName,
    schema,
    system,
    user,
    maxOutputTokens,
  });

  try {
    const headerSource = {
      headline: source.basics.headline,
      location: source.basics.location,
      additionalInfo: source.basics.additionalInfo,
      summary: source.summary,
    };
    const header = await request(
      translationHeaderSchema,
      `Translate supplied resume text into ${languageName}. Preserve factual meaning, proper nouns, technologies, dates, numbers, work authorization, and location details. Never invent or omit facts. Return only the requested fields.`,
      JSON.stringify(headerSource),
    );
    const headerUnsupported = translationIntroducedNumbers(headerSource, header);
    if (headerUnsupported.length) throw new Error(`Resume translation introduced unsupported numbers: ${headerUnsupported.join(", ")}`);

    const translatedSections: PlatformResume["sections"] = [];
    for (const section of source.sections) {
      const sectionTextSource = { title: section.title, content: section.content };
      const sectionText = await request(
        sectionTranslationSchema,
        `Translate this resume section title and any unmapped section text into ${languageName}. Preserve every fact, line boundary where useful, proper noun, date, number, URL, and technology. Do not summarize or add content.`,
        JSON.stringify(sectionTextSource),
        12_000,
      );
      const sectionUnsupported = translationIntroducedNumbers(sectionTextSource, sectionText);
      if (sectionUnsupported.length) throw new Error(`Resume section translation introduced unsupported numbers: ${sectionUnsupported.join(", ")}`);

      const entries: ResumeEntry[] = [];
      const sourceEntries = section.entries ?? [];
      for (let index = 0; index < sourceEntries.length; index += 3) {
        const batch = sourceEntries.slice(index, index + 3);
        const translated = await request(
          entryTranslationBatchSchema,
          `Translate each resume entry into ${languageName}. Copy every id exactly. Translate user-facing prose while preserving proper nouns when no established translation is known. Preserve every employer, school, project, role, date, number, metric, URL, technology, skill, and factual detail. Return exactly one complete entry for every input id, in the same order. Do not invent or summarize facts.`,
          JSON.stringify(batch.map(compactEntry)),
          12_000,
        );
        if (translated.items.length !== batch.length || translated.items.some((item, itemIndex) => item.id !== batch[itemIndex]?.id)) {
          throw new Error("Resume translation did not preserve the source entry mapping.");
        }
        for (let itemIndex = 0; itemIndex < batch.length; itemIndex += 1) {
          const sourceEntry = batch[itemIndex]!;
          const translatedEntry = translated.items[itemIndex]!.entry;
          const unsupported = translationIntroducedNumbers(sourceEntry, translatedEntry);
          if (unsupported.length) throw new Error(`Resume entry translation introduced unsupported numbers: ${unsupported.join(", ")}`);
          entries.push(entryWithTranslatedFields(sourceEntry, translatedEntry));
        }
      }
      translatedSections.push({ ...section, title: sectionText.title, content: sectionText.content, entries });
    }

    const translatedResume = normalizePlatformResume({
      ...source,
      basics: {
        ...source.basics,
        headline: header.headline,
        location: header.location,
        additionalInfo: header.additionalInfo,
      },
      summary: header.summary,
      sections: translatedSections,
    });
    const renderedText = renderResumeText(translatedResume);
    const title = translatedTitle(sourceResume.title, input.targetLanguage);
    const translatedResumeId = randomUUID();
    await db.transaction(async (tx) => {
      const currentSource = await tx.select({ currentVersionId: resumes.currentVersionId }).from(resumes).where(eq(resumes.id, sourceResume.id)).get();
      if (currentSource?.currentVersionId !== sourceVersion.id) throw new ResumeVersionConflictError();
      await tx.insert(resumes).values({
        id: translatedResumeId,
        userId: input.userId,
        title,
        language: input.targetLanguage,
        resumeGroupId: groupId,
        sourceType: "editor",
        originalText: renderedText,
        isPrimary: false,
      }).run();
      await appendResumeVersionTx(tx, {
        resumeId: translatedResumeId,
        expectedVersionId: null,
        externalParentVersionId: sourceVersion.id,
        versionType: "base",
        title,
        structuredContentJson: translatedResume,
        renderedText,
        changeSummary: input.targetLanguage === "zh" ? "由另一语言的基础简历生成，等待用户检查。" : "Generated from the paired base resume and awaiting user review.",
        factCheckStatus: "needs_review",
        createdBy: "ai",
      });
      await tx.update(agentRuns).set({
        status: "succeeded",
        entityId: translatedResumeId,
        outputJson: { sourceResumeId: sourceResume.id, translatedResumeId, targetLanguage: input.targetLanguage },
        finishedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(agentRuns.id, run.id)).run();
      await tx.insert(notifications).values({
        userId: input.userId,
        notificationType: "ai_task_complete",
        titleZh: "双语基础简历已生成",
        titleEn: "Bilingual base resume ready",
        bodyZh: `“${title}”已生成，请检查翻译、姓名写法和专有名词后再使用。`,
        bodyEn: `“${title}” is ready. Review translations, name spelling, and proper nouns before using it.`,
        entityType: "resume",
        entityId: translatedResumeId,
      }).run();
    });
    return { translatedResumeId, targetLanguage: input.targetLanguage };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown resume translation error";
    await db.update(agentRuns).set({
      status: "failed",
      errorCode: "RESUME_TRANSLATION_ERROR",
      errorMessage: message,
      finishedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(agentRuns.id, run.id)).run();
    throw error;
  }
}
