"use server";

import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { deleteResumeSource, saveResumeSource } from "@/lib/file-storage";
import {
  applicationEvents,
  applications,
  applicationStatuses,
  appSettings,
  candidateProfiles,
  careerPreferences,
  ignoredJobs,
  jobSearchTargets,
  jobs,
  jobSnapshots,
  jobSources,
  materials,
  resumes,
  resumeVersions,
  searchPlans,
} from "@/db/schema";
import { AI_BASE_URLS, providerSupportsAutomaticDiscovery } from "@/lib/ai-provider-config";
import { aiModelOptions } from "@/lib/ai-models";
import { requestStructuredAiJsonWithKey } from "@/lib/ai-provider";
import { classifyResumeExtractionError, extractResumeText } from "@/lib/resume-extract";
import { type PlatformResume, normalizePlatformResume, renderResumeText, parseResumeText } from "@/lib/resume-format";
import { hasAiProviderKey, readLocalSecrets, saveDeepSeekApiKey, saveOpenAiApiKey } from "@/lib/secrets";
import { queueResumeParse, queueSearchReindex } from "@/lib/background-queue";
import { deleteApplicationRecord, deleteResumeRecord } from "@/lib/delete-records";
import { isCloudDeployment } from "@/lib/deployment";
import { ignoreDiscoveredJobRecord } from "@/lib/ignored-jobs";
import { canonicalJobKey } from "@/lib/job-identity";
import { isHttpUrl } from "@/lib/public-web";
import { detectTextLanguage } from "@/lib/text-language";
import { appendResumeVersionTx, ResumeVersionConflictError } from "@/lib/resume-versions";

export type FormState = {
  error?: string;
  success?: string;
  savedAiSettings?: {
    provider: "deepseek" | "openai";
    model: string;
    modelStrategy: "economy" | "balanced" | "quality" | "fixed";
    enabled: boolean;
  };
};

const aiSettingsSchema = z.object({
  aiProvider: z.enum(["deepseek", "openai"]),
  aiModel: z.string().trim().min(1).max(100),
  aiModelStrategy: z.enum(["economy", "balanced", "quality", "fixed"]).default("balanced"),
  apiKey: z.string().trim().max(512).optional(),
  locale: z.enum(["zh", "en"]).default("zh"),
}).superRefine((value, context) => {
  if (!(aiModelOptions[value.aiProvider] as readonly string[]).includes(value.aiModel)) {
    context.addIssue({ code: "custom", path: ["aiModel"], message: "Unsupported model for the selected provider." });
  }
});

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
});

const addJobSchema = z.object({
  title: z.string().trim().min(2).max(300),
  companyName: z.string().trim().min(2).max(200),
  location: z.string().trim().max(300).optional(),
  workplaceType: z.enum(["unknown", "remote", "hybrid", "onsite"]),
  canonicalUrl: z.union([z.literal(""), z.string().trim().max(2_000).refine(isHttpUrl)]),
  applicationDeadline: z.union([z.literal(""), isoDateSchema]).optional(),
  descriptionText: z.string().trim().min(20).max(120_000),
  locale: z.enum(["zh", "en"]).default("zh"),
});

export async function addJob(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = addJobSchema.safeParse(Object.fromEntries(formData));
  const locale = formData.get("locale") === "en" ? "en" : "zh";
  if (!parsed.success) return { error: locale === "zh" ? "请检查岗位信息，JD 至少需要 20 个字符。" : "Check the job details. The description must contain at least 20 characters." };

  const data = parsed.data;
  const normalized = `${data.companyName}|${data.title}|${data.location ?? ""}`.toLowerCase();
  const canonicalKey = data.canonicalUrl ? canonicalJobKey(data.canonicalUrl) : createHash("sha256").update(normalized).digest("hex");
  const contentHash = createHash("sha256").update(data.descriptionText).digest("hex");
  const user = await getCurrentUser();
  if (!user) return { error: locale === "zh" ? "本地工作区尚未初始化。" : "The local workspace is not initialized." };
  const ignored = await db.select({ id: ignoredJobs.id }).from(ignoredJobs).where(and(eq(ignoredJobs.userId, user.id), eq(ignoredJobs.canonicalKey, canonicalKey))).limit(1).get();
  if (ignored) return { error: locale === "zh" ? "这个岗位此前已被忽略，不会重新添加。" : "This job was previously ignored and will not be added again." };
  const duplicate = await db.select().from(jobs).where(and(eq(jobs.ownerUserId, user.id), eq(jobs.canonicalKey, canonicalKey))).get();
  if (duplicate) return { error: locale === "zh" ? "这个岗位已经存在。" : "This job already exists." };

  const jobId = await db.transaction(async (tx) => {
    const job = await tx.insert(jobs).values({
      ownerUserId: user.id,
      title: data.title,
      companyName: data.companyName,
      location: data.location || null,
      workplaceType: data.workplaceType,
      canonicalUrl: data.canonicalUrl || null,
      canonicalKey,
      descriptionText: data.descriptionText,
      applicationDeadline: data.applicationDeadline ? new Date(`${data.applicationDeadline}T12:00:00`) : null,
      listingStatus: "unknown",
    }).returning().get();
    const source = await tx.insert(jobSources).values({
      jobId: job.id,
      sourceType: "manual",
      sourceName: "User added",
      sourceUrl: data.canonicalUrl || null,
    }).returning().get();
    await tx.insert(jobSnapshots).values({
      jobId: job.id,
      sourceId: source.id,
      contentHash,
      rawText: data.descriptionText,
      listingEvidence: "User supplied; listing status has not been verified.",
    }).run();
    return job.id;
  });

  revalidatePath("/matches");
  await queueSearchReindex(user.id);
  redirect(`/jobs/${jobId}`);
}

export async function smartImportUrl(_: FormState, formData: FormData): Promise<FormState> {
  const locale = formData.get("locale") === "en" ? "en" : "zh";
  const parsed = z.object({ url: z.string().trim().max(2_000).refine(isHttpUrl) }).safeParse({ url: formData.get("url") });
  if (!parsed.success) return { error: locale === "zh" ? "请输入完整的岗位网址。" : "Enter a complete job URL." };
  const user = await getCurrentUser();
  if (!user) return { error: locale === "zh" ? "本地工作区尚未初始化。" : "The local workspace is not initialized." };
  let importedJobId: string;
  try {
    const { smartImportJob } = await import("@/lib/smart-job-import");
    const result = await smartImportJob({ userId: user.id, url: parsed.data.url, source: "url_import" });
    importedJobId = result.jobId;
  } catch (error) {
    return { error: error instanceof Error ? error.message : (locale === "zh" ? "无法导入这个岗位页面。" : "Unable to import this job page.") };
  }
  revalidatePath("/matches");
  redirect(`/jobs/${importedJobId}`);
}

export async function addJobToPipeline(formData: FormData) {
  const jobId = z.string().uuid().safeParse(formData.get("jobId"));
  if (!jobId.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const ownedJob = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, jobId.data), eq(jobs.ownerUserId, user.id))).get();
  if (!ownedJob) return;
  const existing = await db.select().from(applications).where(and(eq(applications.userId, user.id), eq(applications.jobId, jobId.data))).get();
  if (existing) return;
  const firstStatus = await db.select().from(applicationStatuses).where(eq(applicationStatuses.userId, user.id)).orderBy(asc(applicationStatuses.position)).limit(1).get();

  await db.transaction(async (tx) => {
    const application = await tx.insert(applications).values({
      userId: user.id,
      jobId: jobId.data,
      status: firstStatus?.slug ?? "to_apply",
      nextAction: "Prepare application",
    }).returning().get();
    await tx.insert(applicationEvents).values({
      applicationId: application.id,
      eventType: "created",
      title: "Added to application pipeline",
      actorType: "user",
    }).run();
  });

  revalidatePath("/matches");
  revalidatePath("/pipeline");
  revalidatePath(`/jobs/${jobId.data}`);
}

export async function ignoreDiscoveredJob(formData: FormData) {
  const jobId = z.string().uuid().safeParse(formData.get("jobId"));
  if (!jobId.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const ignored = await ignoreDiscoveredJobRecord(user.id, jobId.data);
  if (!ignored) return;
  await queueSearchReindex(user.id);
  revalidatePath("/matches");
}

export async function updateApplicationStatusOptimistic(input: { applicationId: string; jobId: string; status: string }) {
  const parsed = z.object({ applicationId: z.string().uuid(), jobId: z.string().uuid(), status: z.string().min(1).max(80) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid application status." };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "The local workspace is not initialized." };
  const current = await db.select().from(applications).where(and(
    eq(applications.id, parsed.data.applicationId),
    eq(applications.jobId, parsed.data.jobId),
    eq(applications.userId, user.id),
  )).get();
  if (!current) return { ok: false as const, error: "Application not found." };
  if (current.status === parsed.data.status) return { ok: true as const, status: current.status, appliedAt: current.appliedAt?.toISOString().slice(0, 10) ?? "" };
  const validStatus = await db.select().from(applicationStatuses).where(and(eq(applicationStatuses.userId, current.userId), eq(applicationStatuses.slug, parsed.data.status))).get();
  if (!validStatus) return { ok: false as const, error: "Application status is not available." };

  const nextAppliedAt = validStatus.slug === "applied" && !current.appliedAt ? new Date() : current.appliedAt;
  await db.transaction(async (tx) => {
    await tx.update(applications).set({
      status: validStatus.slug,
      appliedAt: nextAppliedAt,
      updatedAt: new Date(),
    }).where(eq(applications.id, current.id)).run();
    await tx.insert(applicationEvents).values({
      applicationId: current.id,
      eventType: "status_changed",
      fromStatus: current.status,
      toStatus: validStatus.slug,
      title: "Application status updated",
      actorType: "user",
    }).run();
  });
  revalidatePath(`/jobs/${parsed.data.jobId}`);
  revalidatePath("/pipeline");
  return { ok: true as const, status: validStatus.slug, appliedAt: nextAppliedAt?.toISOString().slice(0, 10) ?? "" };
}

export async function updateApplicationStatus(formData: FormData) {
  await updateApplicationStatusOptimistic({
    applicationId: String(formData.get("applicationId") ?? ""),
    jobId: String(formData.get("jobId") ?? ""),
    status: String(formData.get("status") ?? ""),
  });
}

const updateApplicationDetailsSchema = z.object({
  applicationId: z.string().uuid(),
  jobId: z.string().uuid(),
  companyName: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  location: z.string().trim().max(300),
  canonicalUrl: z.union([z.literal(""), z.string().trim().max(2_000).refine(isHttpUrl)]),
  applicationDeadline: z.union([z.literal(""), isoDateSchema]),
  appliedAt: z.union([z.literal(""), isoDateSchema]),
  nextAction: z.string().trim().max(500),
});

function editableDate(value: string) {
  return value ? new Date(`${value}T12:00:00.000Z`) : null;
}

export async function updateApplicationDetails(input: z.infer<typeof updateApplicationDetailsSchema>) {
  const parsed = updateApplicationDetailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Check the application fields and URL format." };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "The local workspace is not initialized." };
  const current = await db.select().from(applications).where(and(eq(applications.id, parsed.data.applicationId), eq(applications.userId, user.id), eq(applications.jobId, parsed.data.jobId))).get();
  const currentJob = await db.select().from(jobs).where(and(eq(jobs.id, parsed.data.jobId), eq(jobs.ownerUserId, user.id))).get();
  if (!current || !currentJob) return { ok: false as const, error: "Application or job not found." };

  const deadline = editableDate(parsed.data.applicationDeadline);
  const appliedAt = editableDate(parsed.data.appliedAt);
  const changedFields = [
    currentJob.companyName !== parsed.data.companyName ? "companyName" : null,
    currentJob.title !== parsed.data.title ? "title" : null,
    (currentJob.location ?? "") !== parsed.data.location ? "location" : null,
    (currentJob.canonicalUrl ?? "") !== parsed.data.canonicalUrl ? "canonicalUrl" : null,
    (currentJob.applicationDeadline?.toISOString().slice(0, 10) ?? "") !== parsed.data.applicationDeadline ? "applicationDeadline" : null,
    (current.appliedAt?.toISOString().slice(0, 10) ?? "") !== parsed.data.appliedAt ? "appliedAt" : null,
    (current.nextAction ?? "") !== parsed.data.nextAction ? "nextAction" : null,
  ].filter((field): field is string => Boolean(field));

  await db.transaction(async (tx) => {
    await tx.update(jobs).set({
      companyName: parsed.data.companyName,
      title: parsed.data.title,
      location: parsed.data.location || null,
      canonicalUrl: parsed.data.canonicalUrl || null,
      applicationDeadline: deadline,
      updatedAt: new Date(),
    }).where(eq(jobs.id, currentJob.id)).run();
    await tx.update(applications).set({
      appliedAt,
      nextAction: parsed.data.nextAction || null,
      updatedAt: new Date(),
    }).where(eq(applications.id, current.id)).run();
    if (changedFields.length) {
      await tx.insert(applicationEvents).values({
        applicationId: current.id,
        eventType: "note_added",
        title: "Application details updated",
        detailsJson: { changedFields },
        actorType: "user",
      }).run();
    }
  });
  await queueSearchReindex(user.id);
  revalidatePath("/pipeline");
  revalidatePath("/matches");
  revalidatePath(`/jobs/${currentJob.id}`);
  return {
    ok: true as const,
    values: {
      companyName: parsed.data.companyName,
      title: parsed.data.title,
      location: parsed.data.location,
      url: parsed.data.canonicalUrl,
      deadlineValue: parsed.data.applicationDeadline,
      appliedAtValue: parsed.data.appliedAt,
      nextAction: parsed.data.nextAction,
    },
  };
}

export async function deleteApplication(formData: FormData) {
  const applicationId = z.string().uuid().safeParse(formData.get("applicationId"));
  if (!applicationId.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const application = await deleteApplicationRecord(user.id, applicationId.data);
  if (!application) return;
  revalidatePath("/pipeline");
  revalidatePath("/matches");
  revalidatePath(`/jobs/${application.jobId}`);
}

export async function addApplicationStatus(formData: FormData) {
  const parsed = z.object({ label: z.string().trim().min(1).max(30) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const statuses = await db.select().from(applicationStatuses).where(eq(applicationStatuses.userId, user.id)).all();
  await db.insert(applicationStatuses).values({
    userId: user.id,
    slug: `custom_${randomUUID().slice(0, 8)}`,
    labelZh: parsed.data.label,
    labelEn: parsed.data.label,
    color: "gray",
    position: statuses.length,
  }).run();
  revalidatePath("/pipeline");
}

export async function updateApplicationStatusLabels(input: { statusId: string; labelZh: string; labelEn: string }) {
  const parsed = z.object({
    statusId: z.string().uuid(),
    labelZh: z.string().trim().min(1).max(30),
    labelEn: z.string().trim().min(1).max(30),
  }).safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid status labels." };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "The local workspace is not initialized." };
  const status = await db.select().from(applicationStatuses).where(and(
    eq(applicationStatuses.id, parsed.data.statusId),
    eq(applicationStatuses.userId, user.id),
  )).get();
  if (!status) return { ok: false as const, error: "Application status not found." };
  await db.update(applicationStatuses).set({
    labelZh: parsed.data.labelZh,
    labelEn: parsed.data.labelEn,
    updatedAt: new Date(),
  }).where(eq(applicationStatuses.id, status.id)).run();
  revalidatePath("/pipeline");
  return { ok: true as const };
}

const createResumeSchema = z.object({
  title: z.string().trim().min(2),
  structuredContent: z.string().min(2).max(1_000_000),
  locale: z.enum(["zh", "en"]).default("zh"),
  resumeLanguage: z.enum(["zh", "en"]),
  resumeGroupId: z.union([z.literal(""), z.string().uuid()]).default(""),
});

export async function createResume(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = createResumeSchema.safeParse(Object.fromEntries(formData));
  const locale = formData.get("locale") === "en" ? "en" : "zh";
  if (!parsed.success) return { error: locale === "zh" ? "请填写简历名称并检查简历内容。" : "Add a resume name and check its content." };
  const user = await getCurrentUser();
  if (!user) return { error: locale === "zh" ? "本地工作区尚未初始化。" : "The local workspace is not initialized." };
  const existing = await db.select().from(resumes).where(eq(resumes.userId, user.id)).limit(1).get();
  const data = parsed.data;
  const groupedResumes = data.resumeGroupId
    ? await db.select().from(resumes).where(and(eq(resumes.userId, user.id), eq(resumes.resumeGroupId, data.resumeGroupId))).all()
    : [];
  if (data.resumeGroupId && !groupedResumes.length) return { error: locale === "zh" ? "找不到要补充语言版本的基础简历。" : "The base resume group could not be found." };
  if (groupedResumes.some((resume) => resume.language === data.resumeLanguage)) {
    return { error: locale === "zh" ? "这个基础简历已经有相同语言的版本。" : "This base resume already has a version in that language." };
  }
  let decodedContent: unknown;
  try { decodedContent = JSON.parse(data.structuredContent); } catch { return { error: locale === "zh" ? "简历内容格式无效，请刷新后重试。" : "Invalid resume content. Refresh and try again." }; }
  const contentResult = platformResumeInputSchema.safeParse(decodedContent);
  if (!contentResult.success) return { error: locale === "zh" ? "请填写姓名，并检查各模块中是否有过长或无效的内容。" : "Add your name and check sections for overly long or invalid content." };
  const structuredContent = normalizePlatformResume(contentResult.data as PlatformResume);
  const renderedText = renderResumeText(structuredContent);

  const resumeId = await db.transaction(async (tx) => {
    const id = randomUUID();
    const resume = await tx.insert(resumes).values({
      id,
      userId: user.id,
      title: data.title,
      language: data.resumeLanguage,
      resumeGroupId: data.resumeGroupId || id,
      sourceType: "editor",
      originalText: renderedText,
      isPrimary: !existing,
    }).returning().get();
    await appendResumeVersionTx(tx, {
      resumeId: resume.id,
      expectedVersionId: null,
      versionType: "base",
      title: data.title,
      structuredContentJson: structuredContent,
      renderedText,
      factCheckStatus: "passed",
      createdBy: "user",
    });
    return resume.id;
  });
  revalidatePath("/resumes");
  await queueSearchReindex(user.id);
  redirect(`/resumes/${resumeId}/edit?created=1`);
}

export async function importResume(_: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get("file");
  const locale = formData.get("locale") === "en" ? "en" : "zh";
  const resumeLanguage = formData.get("resumeLanguage") === "zh" ? "zh" : "en";
  const resumeGroupId = z.union([z.literal(""), z.string().uuid()]).safeParse(formData.get("resumeGroupId") ?? "");
  if (!(file instanceof File) || file.size === 0) return { error: locale === "zh" ? "请选择简历文件。" : "Choose a resume file." };
  if (!resumeGroupId.success) return { error: locale === "zh" ? "基础简历关联信息无效，请从简历工作室重新打开导入页面。" : "The resume group is invalid. Reopen import from Resume Studio." };
  if (file.size > 10 * 1024 * 1024) return { error: locale === "zh" ? "文件不能超过 10 MB。" : "The file must be smaller than 10 MB." };
  const extension = extname(file.name).toLowerCase().replace(".", "");
  if (!(["pdf", "docx", "txt"] as string[]).includes(extension)) return { error: locale === "zh" ? "仅支持 PDF、DOCX 和 TXT。" : "Only PDF, DOCX, and TXT are supported." };
  const user = await getCurrentUser();
  if (!user) return { error: locale === "zh" ? "本地工作区尚未初始化。" : "The local workspace is not initialized." };

  const [existing, settings, groupedResumes] = await Promise.all([
    db.select().from(resumes).where(eq(resumes.userId, user.id)).limit(1).get(),
    db.select().from(appSettings).where(eq(appSettings.userId, user.id)).get(),
    resumeGroupId.data
      ? db.select().from(resumes).where(and(eq(resumes.userId, user.id), eq(resumes.resumeGroupId, resumeGroupId.data))).all()
      : Promise.resolve([]),
  ]);
  if (resumeGroupId.data && !groupedResumes.length) return { error: locale === "zh" ? "找不到要补充语言版本的基础简历。" : "The base resume group could not be found." };
  if (groupedResumes.some((resume) => resume.language === resumeLanguage)) {
    return { error: locale === "zh" ? "这个基础简历已经有相同语言的版本。" : "This base resume already has a version in that language." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const storedSource = await saveResumeSource({ userId: user.id, bytes, hash, extension });
  const relativePath = storedSource.storagePath;
  const createdUpload = storedSource.created;

  let originalText: string;
  try {
    originalText = await extractResumeText(bytes, extension as "pdf" | "docx" | "txt");
  } catch (error) {
    console.error("[JobPilot] Resume text extraction failed", {
      extension,
      filename: file.name,
      error,
    });
    if (createdUpload) await deleteResumeSource(relativePath).catch(() => undefined);
    const pdfError = extension === "pdf" ? classifyResumeExtractionError(error) : null;
    return {
      error: extension === "pdf"
        ? pdfError === "password-protected"
          ? locale === "zh"
            ? "这个 PDF 受密码保护，请移除密码后重新上传。"
            : "This PDF is password-protected. Remove the password and upload it again."
          : pdfError === "invalid-file"
            ? locale === "zh"
              ? "这个文件不是有效的 PDF，或文件已经损坏。"
              : "This is not a valid PDF, or the file is damaged."
            : pdfError === "runtime-unavailable"
              ? locale === "zh"
                ? "PDF 读取服务暂时不可用，请稍后重试。"
                : "PDF extraction is temporarily unavailable. Try again shortly."
              : locale === "zh"
                ? "无法提取这个 PDF 的文字，请确认文件可以正常打开后重试。"
                : "Text could not be extracted from this PDF. Make sure it opens normally and try again."
        : locale === "zh"
          ? "无法读取这个文件的文字内容，请确认文件未损坏后重试。"
          : "Text could not be extracted. Make sure the file is not damaged and try again.",
    };
  }
  if (originalText.trim().length < 5) {
    if (createdUpload) await deleteResumeSource(relativePath).catch(() => undefined);
    return {
      error: locale === "zh"
        ? "这个文件没有可提取的文字层；如果是扫描版 PDF，目前需要先进行 OCR。"
        : "This file has no extractable text layer. Scanned PDFs currently need OCR first.",
    };
  }
  const fallbackContent = parseResumeText(originalText);
  const shouldQueueAi = Boolean(settings?.aiEnabled && (settings.workerEnabled ?? true) && await hasAiProviderKey(settings.aiProvider, user.id));
  let resumeId: string;
  let sourceVersionId: string;
  try {
    const created = await db.transaction(async (tx) => {
      const id = randomUUID();
      const resume = await tx.insert(resumes).values({
        id,
        userId: user.id,
        title: file.name.replace(/\.[^.]+$/, ""),
        language: resumeLanguage,
        resumeGroupId: resumeGroupId.data || id,
        sourceType: extension as "pdf" | "docx" | "txt",
        originalFilename: file.name,
        originalStoragePath: relativePath,
        originalText: originalText.trim(),
        contentHash: hash,
        isPrimary: !existing,
      }).returning().get();
      const version = await appendResumeVersionTx(tx, {
        resumeId: resume.id,
        expectedVersionId: null,
        versionType: "base",
        title: resume.title,
        structuredContentJson: fallbackContent,
        renderedText: renderResumeText(fallbackContent),
        factCheckStatus: "needs_review",
        createdBy: "user",
      });
      return { resumeId: resume.id, sourceVersionId: version.id };
    });
    resumeId = created.resumeId;
    sourceVersionId = created.sourceVersionId;
  } catch (error) {
    if (createdUpload) await deleteResumeSource(relativePath).catch(() => undefined);
    throw error;
  }
  if (shouldQueueAi) await queueResumeParse({ userId: user.id, resumeId, sourceVersionId, locale: resumeLanguage });
  revalidatePath("/resumes");
  await queueSearchReindex(user.id);
  redirect(`/resumes/${resumeId}/edit?imported=1&structure=${shouldQueueAi ? "queued" : "rules"}`);
}

const resumeEntryInputSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(["experience_projects", "experience", "education", "skills", "projects", "certifications", "other"]),
  organization: z.string().max(300), position: z.string().max(300), school: z.string().max(300), degree: z.string().max(300), fieldOfStudy: z.string().max(300),
  projectName: z.string().max(300), role: z.string().max(300), name: z.string().max(300), issuer: z.string().max(300), category: z.string().max(300), title: z.string().max(300), subtitle: z.string().max(300),
  location: z.string().max(300), startDate: z.string().max(80), endDate: z.string().max(80), current: z.boolean(), date: z.string().max(80), url: z.string().max(1000), description: z.string().max(20_000),
  highlights: z.array(z.string().max(2000)).max(40), skills: z.array(z.string().max(200)).max(100),
});

const platformResumeInputSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  basics: z.object({ fullName: z.string().trim().min(1).max(200), headline: z.string().max(300), email: z.union([z.literal(""), z.email()]), phone: z.string().max(100), location: z.string().max(300), links: z.string().max(3000), additionalInfo: z.string().max(3000).optional().default("") }),
  summary: z.string().max(20_000),
  sections: z.array(z.object({ id: z.string().min(1).max(100), type: z.enum(["experience_projects", "experience", "education", "skills", "projects", "certifications", "other"]), title: z.string().trim().min(1).max(200), content: z.string().max(80_000), entries: z.array(resumeEntryInputSchema).min(1).max(60) })).min(1).max(30),
});

export async function saveResumeVersion(_: FormState, formData: FormData): Promise<FormState> {
  const header = z.object({
    resumeId: z.string().uuid(),
    title: z.string().trim().min(2),
    structuredContent: z.string().min(2).max(1_000_000),
    locale: z.enum(["zh", "en"]).default("zh"),
    optimizationJobId: z.union([z.literal(""), z.string().uuid()]).default(""),
    changeSummary: z.string().max(20_000).default(""),
    expectedVersionId: z.string().uuid(),
  }).safeParse(Object.fromEntries(formData));
  const locale = formData.get("locale") === "en" ? "en" : "zh";
  if (!header.success) return { error: locale === "zh" ? "请检查简历名称、姓名和邮箱格式。" : "Check the resume name, full name, and email format." };
  const user = await getCurrentUser();
  const resume = user ? await db.select().from(resumes).where(and(eq(resumes.id, header.data.resumeId), eq(resumes.userId, user.id))).get() : undefined;
  if (!resume) return { error: locale === "zh" ? "找不到这份简历。" : "Resume not found." };

  let parsedContent: unknown;
  try { parsedContent = JSON.parse(header.data.structuredContent); } catch { return { error: locale === "zh" ? "简历内容格式无效，请刷新后重试。" : "Invalid resume content. Refresh and try again." }; }
  const contentResult = platformResumeInputSchema.safeParse(parsedContent);
  if (!contentResult.success) return { error: locale === "zh" ? "请检查简历字段，部分内容过长或格式不正确。" : "Check the resume fields. Some content is too long or invalid." };
  const structuredContent = normalizePlatformResume(contentResult.data as PlatformResume);
  const tailoredJobId = header.data.optimizationJobId || null;
  const tailoredJob = tailoredJobId ? await db.select().from(jobs).where(and(eq(jobs.id, tailoredJobId), eq(jobs.ownerUserId, resume.userId))).get() : null;
  if (tailoredJobId) {
    const application = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.userId, resume.userId), eq(applications.jobId, tailoredJobId))).limit(1).get();
    if (!application) return { error: locale === "zh" ? "目标岗位不在你的申请进度中，请重新选择后再保存。" : "The target job is not in your pipeline. Select it again before saving." };
    if (!tailoredJob) return { error: locale === "zh" ? "找不到目标岗位，请重新选择。" : "The target job could not be found. Select it again." };
  }
  const latest = await db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, resume.id)).orderBy(desc(resumeVersions.versionNumber)).limit(1).get();
  if (!latest) return { error: locale === "zh" ? "找不到当前编辑版，请重新导入或创建简历。" : "The current editable copy is missing. Import or create the resume again." };
  if (latest.id !== header.data.expectedVersionId) {
    return { error: locale === "zh" ? "这份简历已在其他页面或后台任务中更新。请刷新页面后检查最新版本，再重新保存。" : "This resume changed in another page or background task. Refresh, review the latest version, and save again." };
  }
  const renderedText = renderResumeText(structuredContent);
  if (tailoredJobId && tailoredJob && latest.jobId !== tailoredJobId) {
    const application = await db.select().from(applications).where(and(eq(applications.userId, resume.userId), eq(applications.jobId, tailoredJobId))).get();
    if (!application) return { error: locale === "zh" ? "目标岗位不在你的申请进度中。" : "The target job is not in your pipeline." };
    const companySuffix = ` · ${tailoredJob.companyName}`;
    const tailoredTitle = header.data.title.toLocaleLowerCase().includes(tailoredJob.companyName.toLocaleLowerCase())
      ? header.data.title
      : `${header.data.title}${companySuffix}`;
    const created = await db.transaction(async (tx) => {
      const sourceResume = await tx.select({ currentVersionId: resumes.currentVersionId }).from(resumes).where(eq(resumes.id, resume.id)).get();
      if (sourceResume?.currentVersionId !== header.data.expectedVersionId) throw new ResumeVersionConflictError();
      const tailoredResumeId = randomUUID();
      const tailoredResume = await tx.insert(resumes).values({
        id: tailoredResumeId,
        userId: resume.userId,
        title: tailoredTitle,
        language: resume.language ?? detectTextLanguage(renderedText),
        resumeGroupId: tailoredResumeId,
        sourceType: "editor",
        originalText: renderedText,
        isPrimary: false,
      }).returning().get();
      const version = await appendResumeVersionTx(tx, {
        resumeId: tailoredResume.id,
        expectedVersionId: null,
        externalParentVersionId: latest.id,
        jobId: tailoredJobId,
        versionType: "tailored",
        title: tailoredTitle,
        structuredContentJson: structuredContent,
        renderedText,
        changeSummary: header.data.changeSummary || null,
        factCheckStatus: "passed",
        createdBy: "user",
      });
      await tx.update(applications).set({
        selectedResumeVersionId: version.id,
        updatedAt: new Date(),
      }).where(eq(applications.id, application.id)).run();
      const existingMaterial = await tx.select().from(materials).where(and(eq(materials.applicationId, application.id), eq(materials.materialType, "resume"))).orderBy(desc(materials.updatedAt)).limit(1).get();
      if (existingMaterial) {
        await tx.update(materials).set({ title: tailoredTitle, resumeVersionId: version.id, status: "draft", updatedAt: new Date() }).where(eq(materials.id, existingMaterial.id)).run();
      } else {
        await tx.insert(materials).values({ applicationId: application.id, materialType: "resume", title: tailoredTitle, status: "draft", resumeVersionId: version.id }).run();
      }
      await tx.insert(applicationEvents).values({
        applicationId: application.id,
        eventType: "material_added",
        title: locale === "zh" ? "已创建独立岗位简历" : "Separate job resume created",
        detailsJson: { resumeId: tailoredResume.id, resumeVersionId: version.id, sourceResumeId: resume.id },
        actorType: "user",
      }).run();
      return tailoredResume;
    }).catch((error) => {
      if (error instanceof ResumeVersionConflictError) return null;
      throw error;
    });
    if (!created) {
      return { error: locale === "zh" ? "创建岗位简历时基础简历已更新。请刷新并重新检查优化建议。" : "The base resume changed while creating the job-specific copy. Refresh and review the optimization again." };
    }
    revalidatePath("/resumes");
    revalidatePath("/pipeline");
    revalidatePath(`/jobs/${tailoredJobId}`);
    await queueSearchReindex(resume.userId);
    redirect(`/resumes/${created.id}/edit?saved=1&tailored=1`);
  }
  try {
    await db.transaction(async (tx) => {
      const version = await appendResumeVersionTx(tx, {
        resumeId: resume.id,
        expectedVersionId: header.data.expectedVersionId,
      jobId: tailoredJobId ?? latest.jobId,
      versionType: tailoredJobId ? "tailored" : latest.versionType === "tailored" ? "tailored" : "manual_edit",
      title: header.data.title,
      structuredContentJson: structuredContent,
      renderedText,
      changeSummary: header.data.changeSummary || null,
      factCheckStatus: "passed",
      createdBy: "user",
        resumeUpdates: {
          title: header.data.title,
          originalText: resume.sourceType === "editor" ? renderedText : resume.originalText,
        },
      });
      if (version.jobId) {
        const application = await tx.select().from(applications).where(and(
          eq(applications.userId, resume.userId),
          eq(applications.jobId, version.jobId),
        )).get();
        if (application?.selectedResumeVersionId === latest.id) {
          await tx.update(applications).set({ selectedResumeVersionId: version.id, updatedAt: new Date() }).where(eq(applications.id, application.id)).run();
          await tx.update(materials).set({ resumeVersionId: version.id, title: version.title, updatedAt: new Date() }).where(and(
            eq(materials.applicationId, application.id),
            eq(materials.resumeVersionId, latest.id),
          )).run();
        }
      }
    });
  } catch (error) {
    if (error instanceof ResumeVersionConflictError) {
      return { error: locale === "zh" ? "保存时检测到更新版本。你的旧页面不会覆盖新内容；请刷新并重新检查。" : "A newer version appeared while saving. This stale editor did not overwrite it; refresh and review." };
    }
    throw error;
  }
  revalidatePath("/resumes");
  revalidatePath(`/resumes/${resume.id}/edit`);
  await queueSearchReindex(resume.userId);
  redirect(`/resumes/${resume.id}/edit?saved=1`);
}

export async function restoreResumeVersion(formData: FormData) {
  const parsed = z.object({
    resumeId: z.string().uuid(),
    versionId: z.string().uuid(),
    expectedVersionId: z.string().uuid(),
    locale: z.enum(["zh", "en"]),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const [resume, target] = await Promise.all([
    db.select().from(resumes).where(and(eq(resumes.id, parsed.data.resumeId), eq(resumes.userId, user.id))).get(),
    db.select().from(resumeVersions).where(and(eq(resumeVersions.id, parsed.data.versionId), eq(resumeVersions.resumeId, parsed.data.resumeId))).get(),
  ]);
  if (!resume || !target) return;
  const renderedText = target.renderedText ?? renderResumeText(target.structuredContentJson as PlatformResume);
  const restored = await db.transaction((tx) => appendResumeVersionTx(tx, {
    resumeId: resume.id,
    expectedVersionId: parsed.data.expectedVersionId,
    jobId: target.jobId,
    versionType: target.versionType === "tailored" ? "tailored" : "manual_edit",
    title: target.title,
    structuredContentJson: target.structuredContentJson,
    renderedText,
    changeSummary: parsed.data.locale === "zh" ? `从 v${target.versionNumber} 恢复为新的不可变版本` : `Restored from v${target.versionNumber} as a new immutable revision`,
    factCheckStatus: "needs_review",
    createdBy: "user",
    resumeUpdates: {
      title: target.title,
      originalText: resume.sourceType === "editor" ? renderedText : resume.originalText,
    },
  })).catch((error) => {
    if (error instanceof ResumeVersionConflictError) return null;
    throw error;
  });
  if (!restored) redirect(`/resumes/${resume.id}/edit?conflict=1`);
  await queueSearchReindex(user.id);
  revalidatePath("/resumes");
  revalidatePath(`/resumes/${resume.id}/edit`);
  redirect(`/resumes/${resume.id}/edit?restored=${target.versionNumber}`);
}

export async function deleteResume(formData: FormData) {
  const resumeId = z.string().uuid().safeParse(formData.get("resumeId"));
  if (!resumeId.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const resume = await deleteResumeRecord(user.id, resumeId.data);
  if (!resume) return;

  if (resume.originalStoragePath) {
    const stillReferenced = await db.select({ id: resumes.id }).from(resumes).where(eq(resumes.originalStoragePath, resume.originalStoragePath)).limit(1).get();
    if (!stillReferenced) await deleteResumeSource(resume.originalStoragePath).catch((error) => console.error("Unable to remove deleted resume source file", error));
  }

  await queueSearchReindex(user.id);
  revalidatePath("/resumes");
  revalidatePath("/profile");
  revalidatePath("/pipeline");
  revalidatePath("/matches");
}

export async function setPrimaryResume(formData: FormData) {
  const resumeId = z.string().uuid().safeParse(formData.get("resumeId"));
  if (!resumeId.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const resume = await db.select().from(resumes).where(and(eq(resumes.id, resumeId.data), eq(resumes.userId, user.id))).get();
  if (!resume || resume.isPrimary) return;

  await db.transaction(async (tx) => {
    await tx.update(resumes).set({ isPrimary: false, updatedAt: new Date() }).where(eq(resumes.userId, user.id)).run();
    await tx.update(resumes).set({ isPrimary: true, updatedAt: new Date() }).where(eq(resumes.id, resume.id)).run();
    await tx.update(candidateProfiles).set({ headline: null, summary: null, currentLocation: null, yearsOfExperience: null, workAuthorization: null, profileJson: null, analyzedAt: null, updatedAt: new Date() }).where(eq(candidateProfiles.userId, user.id)).run();
  });

  await queueSearchReindex(user.id);
  revalidatePath("/resumes");
  revalidatePath("/profile");
  revalidatePath("/matches");
}

export async function saveAiSettings(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = aiSettingsSchema.safeParse(Object.fromEntries(formData));
  const locale = formData.get("locale") === "en" ? "en" : "zh";
  if (!parsed.success) return { error: locale === "zh" ? "请检查 AI 设置。" : "Check the AI settings." };
  const user = await getCurrentUser();
  if (!user) return { error: locale === "zh" ? "本地工作区尚未初始化。" : "The local workspace is not initialized." };
  const enabled = formData.get("aiEnabled") === "on";
  const keyConfigured = await hasAiProviderKey(parsed.data.aiProvider, user.id);
  const providerName = parsed.data.aiProvider === "openai" ? "OpenAI" : "DeepSeek";
  if (enabled && !parsed.data.apiKey && !keyConfigured) return { error: locale === "zh" ? `启用 AI 前需要填写 ${providerName} API Key。` : `Enter a ${providerName} API key before enabling AI.` };

  const current = await db.select().from(appSettings).where(eq(appSettings.userId, user.id)).get();
  const values = {
    aiEnabled: enabled,
    aiProvider: parsed.data.aiProvider,
    aiModel: parsed.data.aiModel,
    aiBaseUrl: AI_BASE_URLS[parsed.data.aiProvider],
    aiModelStrategy: parsed.data.aiModelStrategy,
    webSearchEnabled: enabled && providerSupportsAutomaticDiscovery(parsed.data.aiProvider),
    updatedAt: new Date(),
  };
  const saveKey = parsed.data.aiProvider === "openai" ? saveOpenAiApiKey : saveDeepSeekApiKey;
  if (parsed.data.apiKey) await saveKey(parsed.data.apiKey, user.id);
  if (current) await db.update(appSettings).set(values).where(eq(appSettings.id, current.id)).run();
  else await db.insert(appSettings).values({ userId: user.id, ...values }).run();
  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath("/resumes");
  revalidatePath("/matches");
  return {
    success: locale === "zh"
      ? `AI 设置已保存${isCloudDeployment ? "到账户" : "在本机"}。`
      : `AI settings were saved ${isCloudDeployment ? "to your account" : "locally"}.`,
    savedAiSettings: {
      provider: parsed.data.aiProvider,
      model: parsed.data.aiModel,
      modelStrategy: parsed.data.aiModelStrategy,
      enabled,
    },
  };
}

export async function deleteAiApiKey(formData: FormData) {
  const provider = z.enum(["deepseek", "openai"]).safeParse(formData.get("aiProvider"));
  if (!provider.success) return;
  const user = await getCurrentUser();
  if (!user) return;
  const saveKey = provider.data === "openai" ? saveOpenAiApiKey : saveDeepSeekApiKey;
  await saveKey(null, user.id);
  const current = await db.select().from(appSettings).where(eq(appSettings.userId, user.id)).get();
  if (current?.aiProvider === provider.data) await db.update(appSettings).set({ aiEnabled: false, webSearchEnabled: false, updatedAt: new Date() }).where(eq(appSettings.id, current.id)).run();
  revalidatePath("/settings");
  revalidatePath("/automation");
  revalidatePath("/profile");
}

export async function testAiConnection(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = aiSettingsSchema.safeParse(Object.fromEntries(formData));
  const locale = formData.get("locale") === "en" ? "en" : "zh";
  if (!parsed.success) return { error: locale === "zh" ? "请检查 API 设置。" : "Check the API settings." };
  const user = await getCurrentUser();
  if (!user) return { error: locale === "zh" ? "请先登录。" : "Sign in first." };
  const secrets = await readLocalSecrets(user.id);
  const apiKey = parsed.data.apiKey || (parsed.data.aiProvider === "openai" ? secrets.openaiApiKey : secrets.deepseekApiKey);
  const providerName = parsed.data.aiProvider === "openai" ? "OpenAI" : "DeepSeek";
  const model = parsed.data.aiModel;
  if (!apiKey) return { error: locale === "zh" ? `请先填写 ${providerName} API Key。` : `Enter a ${providerName} API key first.` };
  try {
    await requestStructuredAiJsonWithKey({ provider: parsed.data.aiProvider, apiBaseUrl: AI_BASE_URLS[parsed.data.aiProvider], model, apiKey, system: "This is a connection test. Follow the requested JSON schema exactly.", user: "Return an object with ok set to true.", schema: z.object({ ok: z.literal(true) }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown API error";
    if (/HTTP 401|HTTP 403|not authorized|token not match/i.test(message)) return { error: locale === "zh" ? `${providerName} 认证失败，请确认 API Key 正确。` : `${providerName} authentication failed. Check that the API key is correct.` };
    if (/HTTP 429|insufficient balance|quota|1008/i.test(message)) return { error: locale === "zh" ? `${providerName} 当前限流或余额不足，请检查该 Key 对应的额度。` : `${providerName} is rate-limited or out of balance. Check the quota attached to this key.` };
    if (parsed.data.aiProvider === "deepseek" && /network request failed|fetch failed|ENOTFOUND|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT|Connect Timeout/i.test(message)) {
      return { error: isCloudDeployment
        ? locale === "zh" ? "JobPilot 暂时无法连接 DeepSeek，请稍后重试。" : "JobPilot cannot reach DeepSeek right now. Try again later."
        : locale === "zh" ? "暂时无法连接 DeepSeek，请检查网络后重试。" : "JobPilot cannot reach DeepSeek. Check your connection and try again." };
    }
    return { error: locale === "zh" ? `连接失败：${message.slice(0, 260)}` : `Connection failed: ${message.slice(0, 260)}` };
  }
  return { success: locale === "zh" ? `${providerName} 连接成功。` : `${providerName} connected.` };
}

const preferenceSchema = z.object({
  searchFrequencyMinutes: z.coerce.number().int().min(60).max(10080),
  locale: z.enum(["zh", "en"]).default("zh"),
});

const jobSearchLocationPreferenceSchema = z.object({
  location: z.string().trim().max(200),
  requiresVisaSponsorship: z.boolean(),
  workAuthorizationNotes: z.string().trim().max(1_000),
});

const jobSearchTargetSchema = z.object({
  id: z.union([z.literal(""), z.string().uuid()]),
  targetTitle: z.string().trim().min(2).max(120),
  seniorityLevel: z.enum(["any", "internship", "entry", "mid", "senior", "lead", "executive"]),
  employmentType: z.enum(["any", "full_time", "part_time", "contract", "temporary", "internship"]),
  locationPreferences: z.array(jobSearchLocationPreferenceSchema).max(10),
  remotePreference: z.enum(["any", "remote", "hybrid", "onsite"]),
  minimumSalary: z.union([z.literal(""), z.coerce.number().int().nonnegative()]),
  salaryCurrency: z.string().trim().min(3).max(3),
  industries: z.string().trim().max(4_000).optional(),
  companyAllowlist: z.string().trim().max(4_000).optional(),
  companyBlocklist: z.string().trim().max(4_000).optional(),
  excludedKeywords: z.string().trim().max(4_000).optional(),
  hardRequirements: z.string().trim().max(8_000).optional(),
});

function parsePreferenceList(value: string | undefined) {
  return Array.from(new Set((value ?? "").split(/[\n,，]/).map((item) => item.trim()).filter(Boolean)));
}

function parseLocationPreferences(value: string | undefined) {
  try {
    return JSON.parse(value ?? "[]");
  } catch {
    return null;
  }
}

export async function saveCareerPreferences(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = preferenceSchema.safeParse(Object.fromEntries(formData));
  const locale = formData.get("locale") === "en" ? "en" : "zh";
  const targetIds = formData.getAll("targetId").map(String);
  const targetTitles = formData.getAll("targetTitle").map(String);
  const targetSeniorities = formData.getAll("targetSeniority").map(String);
  const targetEmploymentTypes = formData.getAll("targetEmploymentType").map(String);
  const targetLocationPreferences = formData.getAll("targetLocationPreferences").map(String);
  const targetRemotePreferences = formData.getAll("targetRemotePreference").map(String);
  const targetMinimumSalaries = formData.getAll("targetMinimumSalary").map(String);
  const targetSalaryCurrencies = formData.getAll("targetSalaryCurrency").map(String);
  const targetIndustries = formData.getAll("targetIndustries").map(String);
  const targetCompanyAllowlists = formData.getAll("targetCompanyAllowlist").map(String);
  const targetCompanyBlocklists = formData.getAll("targetCompanyBlocklist").map(String);
  const targetExcludedKeywords = formData.getAll("targetExcludedKeywords").map(String);
  const targetHardRequirements = formData.getAll("targetHardRequirements").map(String);
  const targetResult = z.array(jobSearchTargetSchema).min(1).max(8).safeParse(targetTitles.map((targetTitle, index) => ({
    id: targetIds[index] ?? "",
    targetTitle,
    seniorityLevel: targetSeniorities[index],
    employmentType: targetEmploymentTypes[index],
    locationPreferences: parseLocationPreferences(targetLocationPreferences[index]),
    remotePreference: targetRemotePreferences[index],
    minimumSalary: targetMinimumSalaries[index],
    salaryCurrency: targetSalaryCurrencies[index],
    industries: targetIndustries[index],
    companyAllowlist: targetCompanyAllowlists[index],
    companyBlocklist: targetCompanyBlocklists[index],
    excludedKeywords: targetExcludedKeywords[index],
    hardRequirements: targetHardRequirements[index],
  })));
  const targetFieldLengths = [targetIds, targetSeniorities, targetEmploymentTypes, targetLocationPreferences, targetRemotePreferences, targetMinimumSalaries, targetSalaryCurrencies, targetIndustries, targetCompanyAllowlists, targetCompanyBlocklists, targetExcludedKeywords, targetHardRequirements];
  if (!parsed.success || !targetResult.success || targetFieldLengths.some((values) => values.length !== targetTitles.length)) return { error: locale === "zh" ? "请添加 1 到 8 个完整的岗位目标，并检查每个目标的薪资和条件。" : "Add 1 to 8 complete role targets and check the salary and criteria for each target." };
  const user = await getCurrentUser();
  if (!user) return { error: locale === "zh" ? "本地工作区尚未初始化。" : "The local workspace is not initialized." };
  const data = parsed.data;
  const targets = targetResult.data.map((target) => {
    const locationPreferencesJson = target.locationPreferences.filter((location) => location.location).map((location) => ({
      location: location.location,
      requiresVisaSponsorship: location.requiresVisaSponsorship,
      workAuthorizationNotes: location.workAuthorizationNotes,
    }));
    return {
      ...target,
      locationsJson: locationPreferencesJson.map((location) => location.location),
      locationPreferencesJson,
      minimumSalary: target.minimumSalary === "" ? null : target.minimumSalary,
      salaryCurrency: target.salaryCurrency.toUpperCase(),
      industriesJson: parsePreferenceList(target.industries),
      companyAllowlistJson: parsePreferenceList(target.companyAllowlist),
      companyBlocklistJson: parsePreferenceList(target.companyBlocklist),
      excludedKeywordsJson: parsePreferenceList(target.excludedKeywords),
      requiresVisaSponsorship: locationPreferencesJson.some((location) => location.requiresVisaSponsorship),
      workAuthorizationNotes: locationPreferencesJson.map((location) => location.workAuthorizationNotes).filter(Boolean).join("\n") || null,
      hardRequirementsJson: parsePreferenceList(target.hardRequirements),
    };
  });
  if (targets.some((target) => new Set(target.locationsJson.map((location) => location.toLowerCase())).size !== target.locationsJson.length)) {
    return { error: locale === "zh" ? "同一个岗位目标中存在重复地点，请合并地点设置。" : "A role target contains duplicate locations. Merge the location settings." };
  }
  const targetDedupeKey = (target: (typeof targets)[number]) => JSON.stringify({
    title: target.targetTitle.toLowerCase(),
    seniority: target.seniorityLevel,
    employmentType: target.employmentType,
    locations: target.locationPreferencesJson.map((location) => ({ ...location, location: location.location.toLowerCase() })).sort((a, b) => a.location.localeCompare(b.location)),
    remote: target.remotePreference,
    minimumSalary: target.minimumSalary,
    salaryCurrency: target.salaryCurrency,
    industries: [...target.industriesJson].sort(),
    preferredCompanies: [...target.companyAllowlistJson].sort(),
    blockedCompanies: [...target.companyBlocklistJson].sort(),
    excludedKeywords: [...target.excludedKeywordsJson].sort(),
    hardRequirements: [...target.hardRequirementsJson].sort(),
  });
  const dedupeKeys = new Set(targets.map(targetDedupeKey));
  if (dedupeKeys.size !== targets.length) return { error: locale === "zh" ? "存在完全重复的岗位目标，请合并或删除重复项。" : "Duplicate role targets found. Merge or remove the duplicate." };
  const values = {
    targetTitlesJson: Array.from(new Set(targets.map((target) => target.targetTitle))),
    seniorityLevelsJson: Array.from(new Set(targets.map((target) => target.seniorityLevel).filter((value) => value !== "any"))),
    employmentTypesJson: Array.from(new Set(targets.map((target) => target.employmentType).filter((value) => value !== "any"))),
    locationsJson: Array.from(new Set(targets.flatMap((target) => target.locationsJson))),
    remotePreference: targets.every((target) => target.remotePreference === targets[0].remotePreference) ? targets[0].remotePreference : "any" as const,
    minimumSalary: targets.every((target) => target.minimumSalary === targets[0].minimumSalary && target.salaryCurrency === targets[0].salaryCurrency) ? targets[0].minimumSalary : null,
    salaryCurrency: targets.every((target) => target.salaryCurrency === targets[0].salaryCurrency) ? targets[0].salaryCurrency : "USD",
    industriesJson: Array.from(new Set(targets.flatMap((target) => target.industriesJson))),
    companyAllowlistJson: Array.from(new Set(targets.flatMap((target) => target.companyAllowlistJson))),
    companyBlocklistJson: Array.from(new Set(targets.flatMap((target) => target.companyBlocklistJson))),
    excludedKeywordsJson: Array.from(new Set(targets.flatMap((target) => target.excludedKeywordsJson))),
    requiresVisaSponsorship: targets.some((target) => target.requiresVisaSponsorship),
    workAuthorizationNotes: Array.from(new Set(targets.map((target) => target.workAuthorizationNotes).filter(Boolean))).join("\n") || null,
    hardRequirementsJson: Array.from(new Set(targets.flatMap((target) => target.hardRequirementsJson))),
    searchEnabled: formData.get("searchEnabled") === "on",
    searchFrequencyMinutes: data.searchFrequencyMinutes,
    lastSearchAt: null,
    updatedAt: new Date(),
  };
  const current = await db.select().from(careerPreferences).where(eq(careerPreferences.userId, user.id)).get();
  const existingTargets = await db.select().from(jobSearchTargets).where(eq(jobSearchTargets.userId, user.id)).all();
  const existingById = new Map(existingTargets.map((target) => [target.id, target]));
  if (targets.some((target) => target.id && !existingById.has(target.id))) return { error: locale === "zh" ? "岗位目标已发生变化，请刷新页面后重试。" : "Role targets changed. Refresh and try again." };
  const targetKey = (target: { targetTitle: string; seniorityLevel: string; employmentType: string }) => `${target.targetTitle.trim().toLowerCase()}\u0000${target.seniorityLevel}\u0000${target.employmentType}`;
  const claimedExistingIds = new Set(targets.map((target) => target.id).filter(Boolean));
  const resolvedTargets = targets.map((target) => {
    if (target.id) return target;
    const reusable = existingTargets.find((existingTarget) => !claimedExistingIds.has(existingTarget.id) && targetKey(existingTarget) === targetKey(target));
    if (!reusable) return target;
    claimedExistingIds.add(reusable.id);
    return { ...target, id: reusable.id };
  });
  await db.transaction(async (tx) => {
    await tx.delete(searchPlans).where(eq(searchPlans.userId, user.id)).run();
    if (current) await tx.update(careerPreferences).set(values).where(eq(careerPreferences.id, current.id)).run();
    else await tx.insert(careerPreferences).values({ userId: user.id, ...values }).run();
    const retainedIds = new Set(resolvedTargets.map((target) => target.id).filter(Boolean));
    for (const existingTarget of existingTargets) {
      if (!retainedIds.has(existingTarget.id)) await tx.delete(jobSearchTargets).where(eq(jobSearchTargets.id, existingTarget.id)).run();
    }
    for (const [position, target] of resolvedTargets.entries()) {
      const targetValues = { targetTitle: target.targetTitle, seniorityLevel: target.seniorityLevel, employmentType: target.employmentType, locationsJson: target.locationsJson, locationPreferencesJson: target.locationPreferencesJson, remotePreference: target.remotePreference, minimumSalary: target.minimumSalary, salaryCurrency: target.salaryCurrency, industriesJson: target.industriesJson, companyAllowlistJson: target.companyAllowlistJson, companyBlocklistJson: target.companyBlocklistJson, excludedKeywordsJson: target.excludedKeywordsJson, requiresVisaSponsorship: target.requiresVisaSponsorship, workAuthorizationNotes: target.workAuthorizationNotes, hardRequirementsJson: target.hardRequirementsJson, position, updatedAt: new Date() };
      if (target.id) await tx.update(jobSearchTargets).set(targetValues).where(eq(jobSearchTargets.id, target.id)).run();
      else await tx.insert(jobSearchTargets).values({ userId: user.id, ...targetValues }).run();
    }
  });
  revalidatePath("/preferences");
  revalidatePath("/matches");
  revalidatePath("/automation");
  revalidatePath("/profile");
  return { success: locale === "zh" ? "岗位搜索偏好已保存。" : "Job search preferences were saved." };
}
