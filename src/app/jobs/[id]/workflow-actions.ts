"use server";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { applicationEvents, applications, interviews, interviewQuestions, jobs, materials, resumes, resumeVersions } from "@/db/schema";
import { isPlatformResume, normalizePlatformResume, renderResumeSection, renderResumeText, type PlatformResume } from "@/lib/resume-format";
import { queueSearchReindex } from "@/lib/background-queue";
import { detectTextLanguage } from "@/lib/text-language";
import { appendResumeVersionTx, ResumeVersionConflictError } from "@/lib/resume-versions";

function keywords(value: string) {
  return new Set((value.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}|[\u3400-\u9fff]{2,}/g) ?? []).filter((word) => !["the", "and", "with", "for", "you", "your", "will", "this", "that"].includes(word)));
}

function relevance(value: string, terms: Set<string>) {
  const lower = value.toLowerCase();
  let score = 0;
  for (const term of terms) if (lower.includes(term)) score += 1;
  return score;
}

function reorderContent(content: PlatformResume, jobText: string): PlatformResume {
  const terms = keywords(jobText);
  const normalized = normalizePlatformResume(content);
  const rankedSections = normalized.sections.map((section) => {
    const entries = [...(section.entries ?? [])].sort((a, b) => relevance(renderResumeSection({ ...section, entries: [b] }), terms) - relevance(renderResumeSection({ ...section, entries: [a] }), terms));
    return { ...section, entries, score: relevance(`${section.title}\n${renderResumeSection(section)}`, terms) };
  }).sort((a, b) => b.score - a.score);
  const sections = rankedSections.map((section) => ({ id: section.id, type: section.type, title: section.title, content: renderResumeSection(section), entries: section.entries }));
  return { ...normalized, sections };
}

export async function createSafeTailoredResume(formData: FormData) {
  const parsed = z.object({ jobId: z.string().uuid(), outputLanguage: z.enum(["zh", "en"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const [job, application, resumeRows] = await Promise.all([
    db.select().from(jobs).where(and(eq(jobs.id, parsed.data.jobId), eq(jobs.ownerUserId, user.id))).get(),
    db.select().from(applications).where(and(eq(applications.userId, user.id), eq(applications.jobId, parsed.data.jobId))).get(),
    db.select({ resume: resumes, version: resumeVersions })
      .from(resumes)
      .innerJoin(resumeVersions, eq(resumeVersions.resumeId, resumes.id))
      .where(eq(resumes.userId, user.id))
      .orderBy(desc(resumes.isPrimary), desc(resumes.updatedAt), desc(resumeVersions.versionNumber))
      .all(),
  ]);
  if (!job || !application) return;
  const currentByResume = [...resumeRows.reduce((current, row) => {
    if (!current.has(row.resume.id)) current.set(row.resume.id, row);
    return current;
  }, new Map<string, (typeof resumeRows)[number]>()).values()];
  const existingVersion = currentByResume.find((row) => row.version.jobId === job.id && detectTextLanguage(row.version.renderedText ?? "") === parsed.data.outputLanguage);
  if (existingVersion) {
    redirect(`/resumes/${existingVersion.resume.id}/edit`);
  }
  const source = currentByResume.find((row) => !row.version.jobId && isPlatformResume(row.version.structuredContentJson) && detectTextLanguage(row.version.renderedText ?? "") === parsed.data.outputLanguage);
  if (!source) redirect(`/jobs/${job.id}?tailored=language-missing&outputLanguage=${parsed.data.outputLanguage}`);
  const baseVersion = source.version;
  const primary = source.resume;
  const tailored = reorderContent(normalizePlatformResume(baseVersion.structuredContentJson as PlatformResume), `${job.title}\n${job.descriptionText}`);
  const languageLabel = parsed.data.outputLanguage === "zh" ? "中文" : "English";
  const title = `${primary.title} · ${job.companyName} · ${languageLabel}`;
  const newResumeId = await db.transaction(async (tx) => {
    const currentSource = await tx.select({ currentVersionId: resumes.currentVersionId }).from(resumes).where(eq(resumes.id, primary.id)).get();
    if (currentSource?.currentVersionId !== baseVersion.id) throw new ResumeVersionConflictError();
    const id = randomUUID();
    const resume = await tx.insert(resumes).values({ id, userId: user.id, title, language: parsed.data.outputLanguage, resumeGroupId: id, sourceType: "editor", originalText: renderResumeText(tailored), isPrimary: false }).returning().get();
    const version = await appendResumeVersionTx(tx, {
      resumeId: resume.id,
      expectedVersionId: null,
      externalParentVersionId: baseVersion.id,
      jobId: job.id,
      versionType: "tailored",
      title,
      structuredContentJson: tailored,
      renderedText: renderResumeText(tailored),
      changeSummary: parsed.data.outputLanguage === "zh" ? "仅使用中文基础简历中的原文，按岗位关键词进行确定性排序。" : "Deterministic keyword-based reordering using only text from the English base resume.",
      factCheckStatus: "passed",
      createdBy: "user",
    });
    await tx.update(applications).set({ selectedResumeVersionId: version.id, nextAction: parsed.data.outputLanguage === "zh" ? "检查中文定制简历" : "Review English tailored resume", updatedAt: new Date() }).where(eq(applications.id, application.id)).run();
    await tx.insert(materials).values({ applicationId: application.id, materialType: "resume", title, status: "draft", resumeVersionId: version.id }).run();
    await tx.insert(applicationEvents).values({ applicationId: application.id, eventType: "material_added", title: parsed.data.outputLanguage === "zh" ? "中文安全定制简历已创建" : "English safe tailored resume created", detailsJson: { resumeVersionId: version.id, sourceResumeId: primary.id, outputLanguage: parsed.data.outputLanguage }, actorType: "system" }).run();
    return resume.id;
  }).catch((error) => {
    if (error instanceof ResumeVersionConflictError) return null;
    throw error;
  });
  if (!newResumeId) redirect(`/jobs/${job.id}?tailored=source-changed&outputLanguage=${parsed.data.outputLanguage}`);
  await queueSearchReindex(user.id);
  revalidatePath(`/jobs/${job.id}`);
  revalidatePath("/resumes");
  redirect(`/resumes/${newResumeId}/edit?tailored=1`);
}

export async function createBasicInterviewPack(formData: FormData) {
  const parsed = z.object({ jobId: z.string().uuid(), outputLanguage: z.enum(["zh", "en"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const [job, application, primary] = await Promise.all([
    db.select().from(jobs).where(and(eq(jobs.id, parsed.data.jobId), eq(jobs.ownerUserId, user.id))).get(),
    db.select().from(applications).where(and(eq(applications.userId, user.id), eq(applications.jobId, parsed.data.jobId))).get(),
    db.select().from(resumes).where(and(eq(resumes.userId, user.id), eq(resumes.isPrimary, true))).get(),
  ]);
  if (!job || !application) return;
  const version = primary ? await db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, primary.id)).orderBy(desc(resumeVersions.versionNumber)).limit(1).get() : undefined;
  const content = version && isPlatformResume(version.structuredContentJson) ? version.structuredContentJson : undefined;
  const sourceLine = content?.sections.flatMap((section) => section.content.split("\n")).find((line) => line.trim().length > 25)?.trim();
  const packStage = parsed.data.outputLanguage === "zh" ? "基础面试包（中文）" : "Basic interview pack (English)";
  const existing = await db.select().from(interviews).where(and(eq(interviews.applicationId, application.id), eq(interviews.stage, packStage))).get();
  if (!existing) {
    const questions = parsed.data.outputLanguage === "zh" ? [
      `请介绍你与 ${job.title} 最相关的一段经历。`,
      `你为什么对 ${job.companyName} 和这个岗位感兴趣？`,
      "请描述一个你解决过的困难问题，以及你如何衡量结果。",
      "请讲述一次分歧或挫折，以及你之后做出了什么改变。",
      "这份职位描述中的哪项要求是你最需要快速学习的？",
    ] : [
      `Walk me through the experience most relevant to ${job.title}.`,
      `Why are you interested in ${job.companyName} and this role?`,
      "Describe a difficult problem you solved and how you measured the result.",
      "Tell me about a disagreement or setback and what you changed afterward.",
      `Which requirement in this job description would you need to learn fastest?`,
    ];
    const framework = parsed.data.outputLanguage === "zh"
      ? "情境 → 任务 → 行动 → 结果 → 反思。公司、技能、日期和数据必须能够追溯到简历原文。"
      : "Situation → Task → Action → Result → Reflection. Keep every company, skill, date, and metric tied to the resume source.";
    const missing = parsed.data.outputLanguage === "zh"
      ? "选择一段真实简历经历，并在回答前补充具体背景。"
      : "Choose a real resume example and add concrete context before answering.";
    await db.transaction(async (tx) => {
      const pack = await tx.insert(interviews).values({ applicationId: application.id, stage: packStage, format: "other", notes: parsed.data.outputLanguage === "zh" ? `${job.companyName} · ${job.title} 面试准备区` : `Preparation workspace for ${job.companyName} · ${job.title}` }).returning().get();
      await tx.insert(interviewQuestions).values(questions.map((question, index) => ({ interviewId: pack.id, applicationId: application.id, question, category: index < 2 ? "motivation" : index < 4 ? "behavioral" : "gap", answerFramework: framework, answerDraft: index === 0 && sourceLine ? (parsed.data.outputLanguage === "zh" ? `可用于展开回答的简历原文：“${sourceLine}”` : `Resume fact to build from: “${sourceLine}”`) : null, evidenceIdsJson: [], missingInformationJson: index === 0 && sourceLine ? [parsed.data.outputLanguage === "zh" ? "补充当时的背景和你自己的反思后再使用。" : "Add the situation context and your own reflection before using this answer."] : [missing], userConfirmed: false }))).run();
      await tx.insert(applicationEvents).values({ applicationId: application.id, eventType: "material_added", title: parsed.data.outputLanguage === "zh" ? "中文基础面试包已创建" : "English basic interview pack created", detailsJson: { questionCount: questions.length, sourceResumeVersionId: version?.id, interviewId: pack.id, outputLanguage: parsed.data.outputLanguage }, actorType: "system" }).run();
    });
  }
  await queueSearchReindex(user.id);
  revalidatePath("/interviews");
  redirect("/interviews");
}
