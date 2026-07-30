import { load } from "cheerio";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentRuns, appSettings } from "@/db/schema";
import { structureJobDetailWithAi } from "@/lib/job-detail-structurer";
import { selectAiModel } from "@/lib/ai-models";
import { queueSearchReindex } from "@/lib/background-queue";
import { saveDiscoveredJob } from "@/lib/job-discovery";
import { extractJobFromPage } from "@/lib/job-page-parser";
import { fetchPublicPage } from "@/lib/public-web";
import { classifyListingPage } from "@/lib/listing-check";

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
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function aiExtract(userId: string, sourceText: string, descriptionText: string, pageUrl: string) {
  const settings = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).get();
  if (!settings?.aiEnabled) return null;
  const model = selectAiModel(settings, "lightweight");
  const run = await db.insert(agentRuns).values({ userId, runType: "smart_job_import", status: "running", entityType: "url", entityId: pageUrl, modelProvider: settings.aiProvider, modelName: model, promptVersion: "smart-job-import-v2", inputRefsJson: [{ type: "public_url", id: pageUrl }], startedAt: new Date() }).returning().get();
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

export async function smartImportJob({ userId, url, capturedHtml, capturedText, hints, source }: { userId: string; url: string; capturedHtml?: string; capturedText?: string; hints?: CapturedJobHints; source: "url_import" | "chrome_extension" }) {
  let pageUrl = url;
  let html = capturedHtml ?? "";
  let sourceText = cleanText([hints?.title, hints?.companyName, hints?.location, hints?.salaryText, hints?.employmentType, capturedText].filter(Boolean).join("\n"));
  if (!html && !sourceText) {
    const page = await fetchPublicPage(url);
    if (page.status < 200 || page.status >= 400 || !page.contentType.includes("html")) throw new Error(`The page could not be imported (HTTP ${page.status}).`);
    pageUrl = page.url;
    html = page.text;
  }
  if (html && sourceText.length < 2_000) {
    const $ = load(html);
    $("script,style,noscript").remove();
    sourceText = cleanText(`${sourceText}\n${$.root().text()}`).slice(0, 120_000);
  }
  if (html && classifyListingPage({ status: 200, contentType: "text/html", text: html }, "unknown").status === "expired") {
    throw new Error("This listing is already closed or expired and was not added to Job discovery.");
  }
  let item = extractJobFromPage(html, pageUrl, hints);
  let extractionMethod: "structured" | "ai" = "structured";
  const aiItem = await aiExtract(userId, sourceText, hints?.descriptionText || item?.descriptionText || capturedText || sourceText, pageUrl);
  if (aiItem) {
    item = { ...item, ...aiItem, publishedAt: item?.publishedAt ?? aiItem.publishedAt };
    extractionMethod = "ai";
  }
  if (!item) throw new Error("JobPilot could not identify a complete job listing on this page. Open the job detail page or use the manual form.");
  const saved = await saveDiscoveredJob(userId, item, {
    type: source === "chrome_extension" ? "extension" : "manual",
    name: source === "chrome_extension" ? "JobPilot Chrome extension" : "Smart URL import",
    evidence: extractionMethod === "ai" ? "Fields and description sections were extracted from captured page text by a validated AI workflow." : "Fields were parsed from structured data or visible job-page fields.",
    rawSnapshotText: cleanText(capturedText || hints?.descriptionText || sourceText).slice(0, 120_000),
  });
  if (saved.ignored || !saved.jobId) throw new Error("This job was previously ignored and will not be added again.");
  await queueSearchReindex(userId);
  return { ...saved, extractionMethod };
}
