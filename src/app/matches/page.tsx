import Link from "next/link";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleAlert, ExternalLink, Ellipsis, MapPin, Plus, Radar, UserRound } from "lucide-react";
import { addJobToPipeline, ignoreDiscoveredJob } from "@/app/actions";
import { db } from "@/db";
import { queryBatch } from "@/db/batch";
import { applications, careerPreferences, jobs, jobMatches, jobSearchTargets, jobSources } from "@/db/schema";
import { EmptyState } from "@/components/empty-state";
import { listingStatusLabels } from "@/lib/constants";
import { formatLocaleDate, getLocale, pick } from "@/lib/i18n";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { isAutomaticRecommendation } from "@/lib/job-preference-match";
import { getCurrentUser } from "@/lib/current-user";
import { DiscoveryNavigation } from "@/components/discovery-navigation";

export const dynamic = "force-dynamic";

export default async function MatchesPage({ searchParams }: { searchParams: Promise<{ filter?: string; job?: string; page?: string }> }) {
  const locale = await getLocale();
  const { filter = "all", job: selectedJobValue, page: pageValue } = await searchParams;
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
  const selectedRow = rows.find(({ job }) => job.id === selectedJobValue) ?? rows[0];
  const selectedJobId = selectedRow?.job.id;
  const sourceCount = new Set(rows.map(({ source }) => source?.sourceName ?? source?.sourceType).filter(Boolean)).size;
  const analyzedCount = rows.filter(({ match }) => Boolean(match)).length;
  const filterHref = (nextFilter: string) => `/matches?filter=${encodeURIComponent(nextFilter)}${page > 1 ? `&page=${page}` : ""}`;
  const selectedHref = (jobId: string) => `/matches?filter=${encodeURIComponent(filter)}${page > 1 ? `&page=${page}` : ""}&job=${encodeURIComponent(jobId)}`;

  const mobileDetailOpen = Boolean(selectedJobValue && selectedRow);

  return (
    <div className={`page-shell discovery-page ${mobileDetailOpen ? "show-mobile-inspector" : "show-mobile-list"}`}>
      <DiscoveryNavigation detailJobId={mobileDetailOpen ? selectedJobId ?? null : null} />
      {/* C Focus: opportunity index and evidence canvas; queries and actions are unchanged. */}
      <header className="discovery-command">
        <div className="discovery-command-copy">
          <h1>{pick(locale, "发现下一站", "Your next move")}</h1>
          <p>{pick(locale, "根据你的求职目标和简历持续寻找合适机会。", "Continuously find relevant opportunities from your goals and resume.")}</p>

        </div>
      <section className="discovery-preference-bar" data-tour="discovery-preferences">
        <div><span className={`status-dot ${preferences?.searchEnabled ? "" : "inactive"}`} /><div><strong>{targetTitles.length ? targetTitles.slice(0, 3).join(" · ") : pick(locale, "尚未设置目标岗位", "No target roles configured")}</strong><p>{targetTitles.length ? pick(locale, `${targetTitles.length} 个岗位目标 · ${targetLocationCount} 个独立地点条件 · ${preferences?.searchEnabled ? "自动发现已开启" : "仅保存偏好"}`, `${targetTitles.length} role targets · ${targetLocationCount} target-specific locations · ${preferences?.searchEnabled ? "automatic discovery on" : "preferences only"}`) : pick(locale, "设置目标岗位和地点，让搜索结果更贴合你的求职方向。", "Set target roles and locations to guide your job search.")}</p></div></div>
        <Link href="/preferences">{targetTitles.length ? pick(locale, "编辑", "Edit") : pick(locale, "立即设置", "Set up now")}<ArrowUpRight size={15} /></Link>
      </section>
          <div className="discovery-command-actions">
            <Link className="button button-primary" href="/automation"><Radar size={16} />{pick(locale, "搜索新岗位", "Search for jobs")}</Link>
            <Link className="button button-quiet" data-tour="discovery-add-job" href="/jobs/new"><Plus size={16} />{pick(locale, "手动添加", "Add manually")}</Link>
          </div>

      </header>



      <div className="discovery-workspace">
        <div className="discovery-results">
        <section className="discovery-search-status" aria-label={pick(locale, "岗位搜索状态", "Job search status") }>
          <Radar size={18} aria-hidden="true" />
          <strong className="search-result-count">{rows.length}<span>{pick(locale, "个岗位", "roles")}</span></strong>
          <div className="search-status-copy">
            <strong>{pick(locale, "本页搜索结果已整理", "Results on this page are organized")}</strong>
            <span>{pick(locale, `${sourceCount} 个来源 · ${analyzedCount} 个已有匹配分析`, `${sourceCount} sources · ${analyzedCount} with match analysis`)}</span>
          </div>
        </section>
          <section className="toolbar discovery-toolbar" aria-label={pick(locale, "岗位筛选", "Job filters")}>
            <div className="segmented-control"><Link aria-current={filter === "all" ? "page" : undefined} className={filter === "all" ? "active" : ""} href={filterHref("all")}>{pick(locale, "全部", "All")}</Link><Link aria-current={filter === "strong" ? "page" : undefined} className={filter === "strong" ? "active" : ""} href={filterHref("strong")}>{pick(locale, "高匹配", "Strong match")}</Link><Link aria-current={filter === "ai" ? "page" : undefined} className={filter === "ai" ? "active" : ""} href={filterHref("ai")}>{pick(locale, "自动发现", "Auto found")}</Link><Link aria-current={filter === "closing" ? "page" : undefined} className={filter === "closing" ? "active" : ""} href={filterHref("closing")}>{pick(locale, "即将截止", "Closing soon")}</Link></div>
            <span className="discovery-scroll-hint">{pick(locale, "选择岗位，查看匹配依据", "Select a role to review its evidence")}</span>
          </section>

          {rows.length === 0 ? <EmptyState filtered={filter !== "all"} locale={locale} resetHref={filterHref("all")} /> : (
            <section tabIndex={0} className="discovery-list" aria-label={pick(locale, "岗位发现列表", "Discovered jobs")}>
              {rows.map(({ job, match, source }) => {
                const isManual = source?.sourceType === "manual" || source?.sourceType === "extension";
                return (
                  <article className={`discovery-list-row ${job.id === selectedJobId ? "selected" : ""}`} key={job.id}>
                    <Link id={`discovery-job-${job.id}`} aria-current={job.id === selectedJobId ? "true" : undefined} className="discovery-job-main" href={selectedHref(job.id)} scroll={false}>
                      <span className="discovery-job-copy"><span className="discovery-company">{job.companyName}</span><strong>{job.title}</strong><small><MapPin size={12} />{job.location || pick(locale, "地点未注明", "Location not listed")}</small></span>
                    </Link>
                    <span className={`source-badge ${isManual ? "source-user" : "source-ai"}`}>{isManual ? <UserRound size={13} /> : <Radar size={13} />}{isManual ? pick(locale, "用户添加", "User added") : pick(locale, "自动发现", "Auto found")}</span>
                    <span className="match-target-cell">{match ? <><strong className="match-score">{match.overallScore}%</strong>{match.matchedTargetId && targetById.get(match.matchedTargetId) ? <small>{targetById.get(match.matchedTargetId)?.targetTitle}</small> : null}</> : <span className="muted">{pick(locale, "待分析", "Pending")}</span>}</span>
                    <span className="discovery-list-meta"><small>{pick(locale, "截止", "Deadline")}</small><strong>{formatLocaleDate(job.applicationDeadline, locale)}</strong><span className={`status-pill status-${job.listingStatus}`}>{locale === "zh" ? listingStatusLabels[job.listingStatus] : ({ unknown: "Unknown", active: "Active", possibly_expired: "Possibly closed", expired: "Closed" }[job.listingStatus])}</span></span>
                    <details className="discovery-job-actions"><summary aria-label={pick(locale, "岗位操作", "Job actions")}><Ellipsis size={20} /></summary><div className="row-actions discovery-row-actions"><form action={addJobToPipeline}><input name="jobId" type="hidden" value={job.id} /><button className="button button-primary compact-button" type="submit">{pick(locale, "加入进度", "Add")}</button></form><form action={ignoreDiscoveredJob}><input name="jobId" type="hidden" value={job.id} /><ConfirmDeleteButton cancelLabel={pick(locale, "取消", "Cancel")} confirmLabel={pick(locale, "确认忽略", "Ignore job")} description={pick(locale, `“${job.companyName} · ${job.title}”将从岗位发现中删除。JobPilot 会保留排除记录，之后的 AI 搜索和公司招聘页同步都不会自动添加同一岗位；如果误点忽略，之后仍可通过手动填写、智能 URL 导入或插件再次保存。`, `“${job.companyName} · ${job.title}” will be removed from discovery. JobPilot will keep an exclusion record so automatic search and company-source sync do not add it again; if you ignored it by mistake, you can still restore it with manual entry, smart URL import, or the extension.`)} title={pick(locale, "忽略这个岗位？", "Ignore this job?")} triggerLabel={pick(locale, "忽略", "Ignore")} triggerStyle="button" /></form></div></details>
                  </article>
                );
              })}
            </section>
          )}
        </div>

        {selectedRow ? (
          <aside id="match-assessment" className="discovery-inspector" aria-label={pick(locale, "岗位匹配解读", "Job match explanation")}>
            <Link className="inspector-back-link" href={filterHref(filter)} scroll={false}><ArrowLeft size={17} />{pick(locale, "返回岗位列表", "Back to job list")}</Link>
            <header>
              <div className="inspector-title"><small>{selectedRow.job.companyName}</small><h2 id="discovery-detail-title" tabIndex={-1}>{selectedRow.job.title}</h2><p><MapPin size={14} />{selectedRow.job.location || pick(locale, "地点未注明", "Location not listed")}</p><p className="inspector-deadline">{pick(locale, "截止", "Deadline")} · {formatLocaleDate(selectedRow.job.applicationDeadline, locale)}<Link href={`/jobs/${selectedRow.job.id}`} aria-label={pick(locale, "打开岗位详情", "Open job details")}>{pick(locale, "岗位详情", "Job details")}<ExternalLink size={14} /></Link></p></div>
              <div className={`focus-score ${selectedRow.match ? "" : "pending"}`} aria-label={pick(locale, "整体匹配度", "Overall fit")}><strong>{selectedRow.match ? selectedRow.match.overallScore : "—"}{selectedRow.match ? <small>%</small> : null}</strong><span>{selectedRow.match ? pick(locale, "匹配参考", "Match guidance") : pick(locale, "待分析", "Pending")}</span></div>
            </header>
            <p className="inspector-guidance">{selectedRow.match ? pick(locale, "分数用于辅助比较，请结合证据和缺口判断是否申请。", "Use the score for comparison, then decide from the evidence and gaps.") : pick(locale, "这个岗位还没有完成 AI 匹配分析。", "This role has not completed AI match analysis yet.")}</p>

            <section className="inspector-evidence">
              <h3>{pick(locale, "适合你的地方", "Why it may fit")}</h3>
              {selectedRow.match?.evidenceJson.length ? selectedRow.match.evidenceJson.slice(0, 3).map((item, index) => <p key={index}><Check size={15} /><span>{item.claim}</span></p>) : <p className="inspector-empty"><CircleAlert size={15} /><span>{pick(locale, "分析完成后会在这里显示可追溯到简历的匹配证据。", "Resume-backed evidence will appear here after analysis.")}</span></p>}
            </section>

            <section className="inspector-evidence inspector-gaps">
              <h3>{pick(locale, "需要确认", "Needs confirmation")}</h3>
              {selectedRow.match?.gapsJson.length ? selectedRow.match.gapsJson.slice(0, 2).map((gap, index) => <p key={index}><CircleAlert size={15} /><span>{gap}</span></p>) : <p className="inspector-empty"><Check size={15} /><span>{selectedRow.match ? pick(locale, "暂未发现明确缺口。", "No clear gap was identified.") : pick(locale, "完成匹配分析后显示需要确认的事项。", "Items to verify will appear after match analysis.")}</span></p>}
              {selectedRow.match?.uncertaintiesJson.slice(0, 1).map((item, index) => <p key={`uncertainty-${index}`}><CircleAlert size={15} /><span>{item}</span></p>)}
            </section>

            <section className="inspector-source">
              <span>{pick(locale, "依据", "Sources")}</span>
              <strong>{selectedRow.source?.sourceName || pick(locale, "岗位原始页面", "Original job page")}</strong>
              {selectedRow.match?.modelName ? <small>{pick(locale, `由 ${selectedRow.match.modelName} 分析`, `Analyzed by ${selectedRow.match.modelName}`)}</small> : null}
            </section>

            <footer>
              <form action={addJobToPipeline}><input name="jobId" type="hidden" value={selectedRow.job.id} /><button className="button button-primary" type="submit">{pick(locale, "加入申请进度", "Add to pipeline")}<ArrowRight size={16} /></button></form>
              <Link className="button button-secondary" href={`/jobs/${selectedRow.job.id}`}>{pick(locale, "查看完整岗位", "View full job")}</Link>
              <form action={ignoreDiscoveredJob} className="inspector-ignore"><input name="jobId" type="hidden" value={selectedRow.job.id} /><ConfirmDeleteButton cancelLabel={pick(locale, "取消", "Cancel")} confirmLabel={pick(locale, "确认忽略", "Ignore job")} description={pick(locale, `“${selectedRow.job.companyName} · ${selectedRow.job.title}”将从岗位发现中删除，并从后续自动搜索中排除。你仍可通过手动填写、URL 导入或插件再次保存。`, `“${selectedRow.job.companyName} · ${selectedRow.job.title}” will be removed and excluded from future automatic searches. You can still save it again manually, from a URL, or with the extension.`)} title={pick(locale, "忽略这个岗位？", "Ignore this job?")} triggerLabel={pick(locale, "忽略", "Ignore")} triggerStyle="button" /></form>
            </footer>
          </aside>
        ) : null}
      </div>
      {page > 1 || hasNextPage ? <nav className="pagination" aria-label={pick(locale, "岗位分页", "Job pagination")}>{page > 1 ? <Link className="button button-secondary" href={`/matches?filter=${encodeURIComponent(filter)}&page=${page - 1}`}>{pick(locale, "上一页", "Previous")}</Link> : <span />}{hasNextPage ? <Link className="button button-secondary" href={`/matches?filter=${encodeURIComponent(filter)}&page=${page + 1}`}>{pick(locale, "下一页", "Next")}</Link> : null}</nav> : null}
    </div>
  );
}
