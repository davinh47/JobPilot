import Link from "next/link";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { ArrowUpRight, Plus, Radar, Rss, Settings2, UserRound } from "lucide-react";
import { addJobToPipeline, ignoreDiscoveredJob } from "@/app/actions";
import { db } from "@/db";
import { queryBatch } from "@/db/batch";
import { applications, careerPreferences, jobs, jobMatches, jobSearchTargets, jobSources } from "@/db/schema";
import { EmptyState } from "@/components/empty-state";
import { listingStatusLabels } from "@/lib/constants";
import { formatLocaleDate, getLocale, pick } from "@/lib/i18n";
import { initials } from "@/lib/utils";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { isAutomaticRecommendation } from "@/lib/job-preference-match";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function MatchesPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const locale = await getLocale();
  const { filter = "all", page: pageValue } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageValue ?? "1", 10) || 1);
  const pageSize = 50;
  const user = await getCurrentUser();
  if (!user) return null;
  const pageJobIds = db.select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.ownerUserId, user.id))
    .orderBy(desc(jobs.createdAt))
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  const [allJobs, allApplications, allMatches, allSources, preferenceRows, targets, closingJobs] = await queryBatch([
    db.select().from(jobs).where(eq(jobs.ownerUserId, user.id)).orderBy(desc(jobs.createdAt)).limit(pageSize + 1).offset((page - 1) * pageSize),
    db.select().from(applications).where(and(eq(applications.userId, user.id), inArray(applications.jobId, pageJobIds))),
    db.select().from(jobMatches).where(and(eq(jobMatches.userId, user.id), inArray(jobMatches.jobId, pageJobIds))).orderBy(desc(jobMatches.createdAt)),
    db.select({
      id: jobSources.id,
      jobId: jobSources.jobId,
      sourceType: jobSources.sourceType,
      sourceName: jobSources.sourceName,
      sourceUrl: jobSources.sourceUrl,
      externalId: jobSources.externalId,
      discoveredAt: jobSources.discoveredAt,
      lastCheckedAt: jobSources.lastCheckedAt,
      createdAt: jobSources.createdAt,
    }).from(jobSources).innerJoin(jobs, eq(jobSources.jobId, jobs.id)).where(and(eq(jobs.ownerUserId, user.id), inArray(jobSources.jobId, pageJobIds))).orderBy(desc(jobSources.discoveredAt)),
    db.select().from(careerPreferences).where(eq(careerPreferences.userId, user.id)).limit(1),
    db.select().from(jobSearchTargets).where(eq(jobSearchTargets.userId, user.id)),
    db.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.ownerUserId, user.id),
      inArray(jobs.id, pageJobIds),
      gte(jobs.applicationDeadline, sql`unixepoch() * 1000`),
      lte(jobs.applicationDeadline, sql`(unixepoch() + 1209600) * 1000`),
    )),
  ]);
  const preferences = preferenceRows[0];
  const hasNextPage = allJobs.length > pageSize;
  if (hasNextPage) allJobs.pop();
  const preferenceWithTargets = preferences ? { ...preferences, jobSearchTargets: targets } : undefined;
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const targetTitles = targets.length ? targets.map((target) => target.targetTitle) : preferences?.targetTitlesJson ?? [];
  const targetLocationCount = targets.length ? new Set(targets.flatMap((target) => target.locationsJson)).size : preferences?.locationsJson.length ?? 0;
  const pipelineJobIds = new Set(allApplications.map((item) => item.jobId));
  const discoveredRows = allJobs.filter((job) => !pipelineJobIds.has(job.id)).map((job) => ({
    job,
    match: allMatches.find((item) => item.jobId === job.id),
    source: allSources.find((item) => item.jobId === job.id),
  })).filter(({ job, match, source }) => source?.sourceType === "manual" || source?.sourceType === "extension" || isAutomaticRecommendation(job, preferenceWithTargets, match));
  const closingJobIds = new Set(closingJobs.map((job) => job.id));
  const rows = discoveredRows.filter(({ job, match, source }) => {
    if (filter === "strong") return (match?.overallScore ?? 0) >= 75;
    if (filter === "ai") return source?.sourceType !== "manual" && source?.sourceType !== "extension";
    if (filter === "closing") return closingJobIds.has(job.id);
    return true;
  });

  return (
    <div className="page-shell">
      <header className="page-header">
        <div><p className="eyebrow">DISCOVERY</p><h1>{pick(locale, "岗位发现", "Job discovery")}</h1><p className="page-description">{pick(locale, "自动岗位只排除明确违反职级、地点和排除条件的结果；匹配分数仅供参考，不再作为推荐门槛。", "Automatic results only exclude roles that clearly conflict with seniority, location, or exclusion rules. Match scores are guidance, not a recommendation threshold.")}</p></div>
        <div className="header-actions"><Link className="button button-secondary" href="/automation"><Rss size={16} />{pick(locale, "岗位源", "Sources")}</Link><Link className="button button-secondary" href="/preferences"><Settings2 size={16} />{pick(locale, "搜索偏好", "Preferences")}</Link><Link className="button button-primary" data-tour="discovery-add-job" href="/jobs/new"><Plus size={16} />{pick(locale, "手动添加", "Add job")}</Link></div>
      </header>

      <section className="discovery-preference-bar" data-tour="discovery-preferences">
        <div><span className={`status-dot ${preferences?.searchEnabled ? "" : "inactive"}`} /><div><strong>{targetTitles.length ? targetTitles.slice(0, 3).join(" · ") : pick(locale, "尚未设置目标岗位", "No target roles configured")}</strong><p>{targetTitles.length ? pick(locale, `${targetTitles.length} 个岗位目标 · ${targetLocationCount} 个独立地点条件 · ${preferences?.searchEnabled ? "自动发现已开启" : "仅保存偏好"}`, `${targetTitles.length} role targets · ${targetLocationCount} target-specific locations · ${preferences?.searchEnabled ? "automatic discovery on" : "preferences only"}`) : pick(locale, "先设置偏好，后续搜索 Worker 才知道要寻找什么。", "Set preferences so the search worker knows what to look for.")}</p></div></div>
        <Link href="/preferences">{targetTitles.length ? pick(locale, "编辑", "Edit") : pick(locale, "立即设置", "Set up now")}<ArrowUpRight size={15} /></Link>
      </section>

      <section className="toolbar" aria-label={pick(locale, "岗位筛选", "Job filters")}>
        <div className="segmented-control"><Link className={filter === "all" ? "active" : ""} href="/matches?filter=all">{pick(locale, "全部", "All")}</Link><Link className={filter === "strong" ? "active" : ""} href="/matches?filter=strong">{pick(locale, "高匹配", "Strong match")}</Link><Link className={filter === "ai" ? "active" : ""} href="/matches?filter=ai">{pick(locale, "自动发现", "Auto found")}</Link><Link className={filter === "closing" ? "active" : ""} href="/matches?filter=closing">{pick(locale, "即将截止", "Closing soon")}</Link></div>
      </section>

      {rows.length === 0 ? <EmptyState locale={locale} /> : (
        <section className="data-table discovery-table" aria-label={pick(locale, "岗位发现列表", "Discovered jobs")}>
          <div className="table-head discovery-grid"><span>{pick(locale, "公司与岗位", "Company & role")}</span><span>{pick(locale, "来源", "Source")}</span><span>{pick(locale, "匹配", "Match")}</span><span>{pick(locale, "地点", "Location")}</span><span>{pick(locale, "截止日期", "Deadline")}</span><span>{pick(locale, "有效性", "Listing")}</span><span>{pick(locale, "操作", "Action")}</span></div>
          {rows.map(({ job, match, source }) => {
            const isManual = source?.sourceType === "manual" || source?.sourceType === "extension";
            return (
              <div className="table-row discovery-grid" key={job.id}>
                <Link className="job-identity" href={`/jobs/${job.id}`}><span className="company-avatar">{initials(job.companyName)}</span><span><strong>{job.title}</strong><small>{job.companyName}</small></span></Link>
                <span className={`source-badge ${isManual ? "source-user" : "source-ai"}`}>{isManual ? <UserRound size={13} /> : <Radar size={13} />}{isManual ? pick(locale, "用户", "User") : pick(locale, "自动", "Auto")}</span>
                <span className="match-target-cell">{match ? <><strong className="match-score">{match.overallScore}%</strong>{match.matchedTargetId && targetById.get(match.matchedTargetId) ? <small>{targetById.get(match.matchedTargetId)?.targetTitle}</small> : null}</> : <span className="muted">{pick(locale, "待分析", "Pending")}</span>}</span>
                <span>{job.location || pick(locale, "未注明", "Not listed")}</span>
                <span>{formatLocaleDate(job.applicationDeadline, locale)}</span>
                <span className={`status-pill status-${job.listingStatus}`}>{locale === "zh" ? listingStatusLabels[job.listingStatus] : ({ unknown: "Unknown", active: "Active", possibly_expired: "Possibly closed", expired: "Closed" }[job.listingStatus])}</span>
            <span className="row-actions discovery-row-actions"><form action={addJobToPipeline}><input name="jobId" type="hidden" value={job.id} /><button className="button button-primary compact-button" type="submit">{pick(locale, "加入进度", "Add to pipeline")}</button></form><form action={ignoreDiscoveredJob}><input name="jobId" type="hidden" value={job.id} /><ConfirmDeleteButton cancelLabel={pick(locale, "取消", "Cancel")} confirmLabel={pick(locale, "确认忽略", "Ignore job")} description={pick(locale, `“${job.companyName} · ${job.title}”将从岗位发现中删除。JobPilot 会保留排除记录，之后的 AI 搜索和公司招聘页同步都不会自动添加同一岗位；如果误点忽略，之后仍可通过手动填写、智能 URL 导入或插件再次保存。`, `“${job.companyName} · ${job.title}” will be removed from discovery. JobPilot will keep an exclusion record so automatic search and company-source sync do not add it again; if you ignored it by mistake, you can still restore it with manual entry, smart URL import, or the extension.`)} title={pick(locale, "忽略这个岗位？", "Ignore this job?")} triggerLabel={pick(locale, "忽略", "Ignore")} triggerStyle="button" /></form></span>
              </div>
            );
          })}
        </section>
      )}
      {page > 1 || hasNextPage ? <nav className="pagination" aria-label={pick(locale, "岗位分页", "Job pagination")}>{page > 1 ? <Link className="button button-secondary" href={`/matches?filter=${encodeURIComponent(filter)}&page=${page - 1}`}>{pick(locale, "上一页", "Previous")}</Link> : <span />}{hasNextPage ? <Link className="button button-secondary" href={`/matches?filter=${encodeURIComponent(filter)}&page=${page + 1}`}>{pick(locale, "下一页", "Next")}</Link> : null}</nav> : null}
    </div>
  );
}
