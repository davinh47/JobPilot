import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentRuns, appSettings, jobSnapshots, jobs, notifications } from "@/db/schema";
import { structureJobDetailWithAi } from "@/lib/job-detail-structurer";
import { selectAiModel } from "@/lib/ai-models";
import { queueSearchReindex, queueSmartJobImport } from "@/lib/background-queue";
import { saveDiscoveredJob } from "@/lib/job-discovery";
import { extractCapturedJobText, extractJobFromCapturedText, extractJobFromPage } from "@/lib/job-page-parser";
import { fetchPublicPage } from "@/lib/public-web";
import { classifyListingPage } from "@/lib/listing-check";
import { stripJobPageNoise } from "@/lib/job-description";

export const capturedJobHintsSchema = z.object({
  title: z.string().trim().max(300).nullable().optional(),
  companyName: z.string().trim().max(300).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  salaryText: z.string().trim().max(300).nullable().optional(),
  employmentType: z.string().trim().max(120).nullable().optional(),
  descriptionText: z.string().trim().max(120_000).nullable().optional(),
});

export type CapturedJobHints = z.infer<typeof capturedJobHintsSchema>;

function cleanText(value: string) {
  return stripJobPageNoise(value);
}

type SmartImportSource = "url_import" | "chrome_extension";

type SmartImportInput = {
  userId: string;
  url: string;
  capturedHtml?: string;
  capturedText?: string;
  hints?: CapturedJobHints;
  source: SmartImportSource;
};

async function aiExtract(userId: string, sourceText: string, descriptionText: string, pageUrl: string) {
  const settings = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).get();
  if (!settings?.aiEnabled) return null;
  const model = selectAiModel(settings, "lightweight");
  const run = await db.insert(agentRuns).values({ userId, runType: "smart_job_import", status: "running", entityType: "url", entityId: pageUrl, modelProvider: settings.aiProvider, modelName: model, promptVersion: "smart-job-import-v3", inputRefsJson: [{ type: "public_url", id: pageUrl }], startedAt: new Date() }).returning().get();
  try {
    const result = await structureJobDetailWithAi({
      userId,
      provider: settings.aiProvider,
      apiBaseUrl: settings.aiBaseUrl,
      model,
      sourceText,
      descriptionText,
      pageUrl,
    });
    if (!result) throw new Error("AI could not confirm that the page contains one specific job listing.");
    await db.update(agentRuns).set({ status: "succeeded", outputJson: { title: result.title, companyName: result.companyName, canonicalUrl: result.canonicalUrl }, finishedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown smart import error";
    await db.update(agentRuns).set({ status: "failed", errorCode: "SMART_IMPORT_ERROR", errorMessage: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
    return null;
  }
}

export async function smartImportJob({ userId, url, capturedHtml, capturedText, hints, source }: SmartImportInput) {
  let pageUrl = url;
  let html = capturedHtml ?? "";
  let pageText = cleanText(capturedText ?? hints?.descriptionText ?? "");
  if (!html && !pageText) {
    const page = await fetchPublicPage(url);
    if (page.status < 200 || page.status >= 400 || !page.contentType.includes("html")) throw new Error(`The page could not be imported (HTTP ${page.status}).`);
    pageUrl = page.url;
    html = page.text;
  }
  // The extension has already removed page chrome in the browser. Re-parsing a
  // 1.5 MB DOM here only adds latency and can make a synchronous import appear
  // stuck, so use its captured text unless it is shorter than the parser's
  // minimum useful description length.
  const hasUsableCapturedText = source === "chrome_extension" && pageText.length >= 80;
  if (html && !hasUsableCapturedText) pageText = cleanText(extractCapturedJobText(html, pageUrl) || pageText);
  const sourceText = cleanText([hints?.title, hints?.companyName, hints?.location, hints?.salaryText, hints?.employmentType, pageText].filter(Boolean).join("\n")).slice(0, 120_000);
  if (html && !hasUsableCapturedText && classifyListingPage({ status: 200, contentType: "text/html", text: html }, "unknown").status === "expired") {
    throw new Error("This listing is already closed or expired and was not added to Job discovery.");
  }
  const normalizedHints = hints ? { ...hints, descriptionText: pageText || hints.descriptionText } : pageText ? { descriptionText: pageText } : undefined;
  let item = extractJobFromPage(hasUsableCapturedText ? "" : html, pageUrl, normalizedHints);
  if (!item && hasUsableCapturedText && html) item = extractJobFromPage(html, pageUrl, normalizedHints);
  let extractionMethod: "structured" | "captured" | "ai" = "structured";
  let aiItem: Awaited<ReturnType<typeof aiExtract>> = null;
  if (!item && source === "url_import") {
    aiItem = await aiExtract(userId, sourceText, pageText || sourceText, pageUrl);
    if (aiItem) {
      item = aiItem;
      extractionMethod = "ai";
    }
  }
  if (!item && source === "chrome_extension" && hasUsableCapturedText) {
    item = extractJobFromCapturedText(pageText, pageUrl, normalizedHints);
    if (item) extractionMethod = "captured";
  }
  if (!item) throw new Error("JobPilot could not identify a complete job listing on this page. Open the job detail page or use the manual form.");
  const saved = await saveDiscoveredJob(userId, item, {
    type: source === "chrome_extension" ? "extension" : "manual",
    name: source === "chrome_extension" ? "JobPilot Chrome extension" : "Smart URL import",
    evidence: extractionMethod === "ai"
      ? "Fields and description sections were extracted from captured page text by a validated AI workflow."
      : extractionMethod === "captured"
        ? "The extension saved useful visible job text; missing fields can be completed by background AI cleanup or manual editing."
        : "Fields were parsed from structured data or visible job-page fields.",
    rawSnapshotText: sourceText,
  });
  if (saved.ignored || !saved.jobId) throw new Error("This job was previously ignored and will not be added again.");
  let aiQueued = false;
  const settings = source === "chrome_extension"
    ? await db.select().from(appSettings).where(eq(appSettings.userId, userId)).get()
    : undefined;
  if (source === "chrome_extension") {
    if (settings?.aiEnabled && settings.workerEnabled !== false) {
      const queued = await queueSmartJobImport({ userId, jobId: saved.jobId, pageUrl });
      aiQueued = Boolean(queued.jobId);
    }
  } else if (!aiItem) {
    aiItem = await aiExtract(userId, sourceText, pageText || item.descriptionText, pageUrl);
    if (aiItem) {
      item = { ...item, ...aiItem, publishedAt: item.publishedAt ?? aiItem.publishedAt };
      extractionMethod = "ai";
      await saveDiscoveredJob(userId, item, {
        type: "manual",
        name: "Smart URL import",
        evidence: "Fields and description sections were extracted from captured page text by a validated AI workflow.",
        rawSnapshotText: sourceText,
      });
    }
  }
  await queueSearchReindex(userId);
  return { ...saved, extractionMethod, aiQueued };
}

export async function runBackgroundSmartJobImport(payload: Record<string, unknown>) {
  const userId = typeof payload.userId === "string" ? payload.userId : null;
  const jobId = typeof payload.jobId === "string" ? payload.jobId : null;
  const pageUrl = typeof payload.pageUrl === "string" ? payload.pageUrl : null;
  if (!userId || !jobId || !pageUrl) throw new Error("smart_job_import requires userId, jobId, and pageUrl.");

  const [job, settings, snapshot] = await Promise.all([
    db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.ownerUserId, userId))).get(),
    db.select().from(appSettings).where(eq(appSettings.userId, userId)).get(),
    db.select().from(jobSnapshots).where(eq(jobSnapshots.jobId, jobId)).orderBy(desc(jobSnapshots.createdAt)).limit(1).get(),
  ]);
  if (!job) throw new Error("The imported job no longer exists.");
  if (!settings?.aiEnabled) return { jobId, skipped: "AI assistance is disabled." };

  const sourceText = cleanText(snapshot?.rawText || job.descriptionText);
  const aiItem = await aiExtract(userId, sourceText, sourceText, pageUrl);
  if (!aiItem) throw new Error("AI could not organize the captured job page.");
  const saved = await saveDiscoveredJob(userId, aiItem, {
    type: "extension",
    name: "JobPilot Chrome extension",
    evidence: "Fields and description sections were extracted from captured page text by a validated AI workflow.",
    rawSnapshotText: sourceText,
  });
  if (saved.ignored || !saved.jobId) throw new Error("This job was ignored before AI cleanup completed.");
  await queueSearchReindex(userId);
  if (settings.notificationsEnabled !== false) {
    await db.insert(notifications).values({
      userId,
      notificationType: "ai_task_complete",
      titleZh: "岗位页面整理完成",
      titleEn: "Job page organization is ready",
      bodyZh: `“${aiItem.companyName} · ${aiItem.title}”已完成字段识别和职位描述整理。`,
      bodyEn: `“${aiItem.companyName} · ${aiItem.title}” has been cleaned up and organized.`,
      entityType: "job",
      entityId: saved.jobId,
    }).run();
  }
  return { jobId: saved.jobId, extractionMethod: "ai" };
}
