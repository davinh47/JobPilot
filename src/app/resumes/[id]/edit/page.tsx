import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { ResumeEditor } from "@/components/resume-editor";
import { db } from "@/db";
import { agentRuns, applications, appSettings, backgroundJobs, jobs, resumes, resumeVersions } from "@/db/schema";
import { getLocale, pick } from "@/lib/i18n";
import { isPlatformResume, normalizePlatformResume, parseResumeText } from "@/lib/resume-format";
import { resumeOptimizationResultSchema } from "@/lib/resume-optimization";
import { hasAiProviderKey } from "@/lib/secrets";
import { getCurrentUser } from "@/lib/current-user";
import { detectTextLanguage } from "@/lib/text-language";
import { restoreResumeVersion } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function EditResumePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const locale = await getLocale();
  const user = await getCurrentUser();
  const resume = user ? await db.select().from(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, user.id))).get() : undefined;
  if (!resume) notFound();
  const [version, versions, settings, applicationJobs, recentResumeParseJobs] = await Promise.all([
    db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, id)).orderBy(desc(resumeVersions.versionNumber)).limit(1).get(),
    db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, id)).orderBy(desc(resumeVersions.versionNumber)).limit(10).all(),
    db.select().from(appSettings).where(eq(appSettings.userId, resume.userId)).get(),
    db.select({ id: jobs.id, companyName: jobs.companyName, title: jobs.title }).from(applications).innerJoin(jobs, eq(applications.jobId, jobs.id)).where(eq(applications.userId, resume.userId)).all(),
    db.select().from(backgroundJobs).where(and(eq(backgroundJobs.userId, resume.userId), eq(backgroundJobs.jobType, "resume_parse"))).orderBy(desc(backgroundJobs.createdAt)).limit(50).all(),
  ]);
  const resumeParseJob = recentResumeParseJobs.find((job) => job.payloadJson.resumeId === resume.id);
  const keyConfigured = await hasAiProviderKey(settings?.aiProvider ?? "deepseek", resume.userId);
  const content = normalizePlatformResume(version && isPlatformResume(version.structuredContentJson) ? version.structuredContentJson : parseResumeText(resume.originalText ?? ""));
  const resumeLanguage = resume.language ?? detectTextLanguage(version?.renderedText ?? "");
  const jobOptions = applicationJobs.map((job) => ({ id: job.id, label: `${job.companyName} · ${job.title}` }));
  const unmappedLineCount = typeof query.unmapped === "string" ? Number.parseInt(query.unmapped, 10) : 0;
  const requestedRunId = typeof query.optimizationRun === "string" && /^[0-9a-f-]{36}$/i.test(query.optimizationRun) ? query.optimizationRun : null;
  const optimizationRun = requestedRunId
    ? await db.select().from(agentRuns).where(and(eq(agentRuns.id, requestedRunId), eq(agentRuns.userId, resume.userId), eq(agentRuns.entityType, "resume"), eq(agentRuns.entityId, resume.id), eq(agentRuns.status, "succeeded"))).get()
    : null;
  const optimizationResult = resumeOptimizationResultSchema.safeParse(optimizationRun?.outputJson);

  const notice = query.structured === "1"
    ? unmappedLineCount > 0
      ? pick(
        locale,
        `AI 已依据原始简历创建新的结构化版本；${unmappedLineCount} 行暂时无法可靠归类，已完整保留在“原文补充（待整理）”中。`,
        `AI created a new structured version; ${unmappedLineCount} source lines could not be classified reliably and were preserved in “Source details to organize”.`,
      )
      : pick(locale, "AI 已把原始简历作为事实来源，创建结构化版本并检查内容覆盖。你可以直接继续编辑。", "AI used the original resume as the factual source, created a structured version, and checked content coverage. You can continue editing.")
    : query.imported === "1" && query.structure === "queued"
      ? resumeParseJob?.status === "succeeded"
        ? pick(locale, "本地导入和后台 AI 整理均已完成，当前已显示最新结构化版本。", "Local import and background AI organization are complete. The latest structured version is shown.")
        : resumeParseJob?.status === "failed"
          ? pick(locale, "本地导入已完成，可以正常编辑；后台 AI 整理失败，可稍后在下方重新运行。", "Local import is complete and editable. Background AI organization failed; run it again below when ready.")
          : pick(locale, "本地导入已完成，你现在可以立即编辑。AI 正在后台整理，完成后会创建新版本并发送通知。", "Local import is complete, so you can edit now. AI is organizing it in the background and will create a new version and notification.")
      : query.imported === "1"
        ? pick(locale, "导入完成。当前使用离线解析结果；开启 AI 后可在下方重新整理结构。", "Import complete using the offline parser. Enable AI to reorganize the structure below.")
        : query.conflict === "1"
          ? pick(locale, "恢复期间出现了更新版本，因此旧操作没有覆盖最新内容。", "A newer revision appeared during restore, so the stale operation did not overwrite it.")
          : typeof query.restored === "string"
            ? pick(locale, `已从 v${query.restored} 创建新的恢复版本。`, `Created a new revision restored from v${query.restored}.`)
        : "";

  return <div className="page-shell editor-page"><Link className="back-link" href="/resumes"><ChevronLeft size={16} />{pick(locale, "返回简历工作室", "Back to resume studio")}</Link><header className="page-header compact-header"><div><p className="eyebrow">RESUME EDITOR · {resumeLanguage === "zh" ? "中文" : "ENGLISH"}</p><h1>{resume.title}</h1><p className="page-description">{pick(locale, "检查自动提取的信息并整理为 JobPilot 的可编辑格式。", "Review extracted information and refine it in JobPilot's editable format.")}</p></div></header>{notice ? <p className="form-success" role="status">{notice}</p> : null}{versions.length > 1 ? <details className="version-history"><summary>{pick(locale, `版本历史（${versions.length}）`, `Revision history (${versions.length})`)}</summary><ol>{versions.map((item) => <li key={item.id}><div><strong>v{item.versionNumber} · {item.title}</strong><small>{item.createdBy === "ai" ? "AI" : pick(locale, "用户", "User")} · {item.createdAt.toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}{item.contentHash ? ` · ${item.contentHash.slice(0, 8)}` : ""}</small>{item.changeSummary ? <p>{item.changeSummary}</p> : null}</div><div><a className="button button-secondary compact-button" href={`/resumes/${resume.id}/export?format=pdf&template=modern&versionId=${item.id}`}>{pick(locale, "预览 PDF", "Preview PDF")}</a>{item.id !== version?.id ? <form action={restoreResumeVersion}><input name="resumeId" type="hidden" value={resume.id} /><input name="versionId" type="hidden" value={item.id} /><input name="expectedVersionId" type="hidden" value={version?.id} /><input name="locale" type="hidden" value={locale} /><button className="button button-ghost compact-button" type="submit">{pick(locale, "恢复为新版本", "Restore as new")}</button></form> : <span className="status-pill status-active">{pick(locale, "当前", "Current")}</span>}</div></li>)}</ol></details> : null}<ResumeEditor aiEnabled={Boolean(settings?.aiEnabled && keyConfigured)} content={content} expectedVersionId={version?.id} initialOptimization={optimizationResult.success ? optimizationResult.data : null} initialStructureQueued={resumeParseJob?.status === "queued" || resumeParseJob?.status === "running"} jobs={jobOptions} key={`${version?.id ?? resume.id}-${requestedRunId ?? "editor"}`} locale={locale} resumeId={resume.id} resumeLanguage={resumeLanguage} savedChangeSummary={query.saved === "1" ? version?.changeSummary : null} title={version?.title ?? resume.title} /></div>;
}
