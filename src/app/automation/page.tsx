import Link from "next/link";
import { Activity, ArrowUpRight, Brain, Building2, CheckCircle2, Globe2, Play, Plus, RefreshCw, Rss, Search, Settings2, Sparkles, ToggleLeft, ToggleRight, X } from "lucide-react";
import { and, asc, desc, eq, or } from "drizzle-orm";
import { PlatformSearchPanel } from "@/components/platform-search-panel";
import { CompanyDiscoverySubmit } from "@/components/company-discovery-submit";
import { db } from "@/db";
import { queryBatch } from "@/db/batch";
import { getCurrentUser } from "@/lib/current-user";
import { agentRuns, appSettings, backgroundJobs, candidateProfiles, careerPreferences, companyRecommendations, jobSearchTargets, sourceConnectors } from "@/db/schema";
import { formatLocaleDate, getLocale, pick } from "@/lib/i18n";
import { friendlyAgentError } from "@/lib/agent-errors";
import { addSourceConnector, dismissCompanyRecommendation, runCompanyRecommendations, runCompanySourceSetup, runStandardDiscovery, saveAutomationSettings, setDailyDiscoveryEnabled, syncAllSourcesNow, syncSourceNow, toggleSourceConnector } from "./actions";

export const dynamic = "force-dynamic";

export default async function AutomationPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const [{ mode }, locale] = await Promise.all([searchParams, getLocale()]);
  const advanced = mode === "advanced";
  const user = await getCurrentUser();
  const [connectors, jobs, settingsRows, preferenceRows, targets, profileRows, recommendations, latestCompanyRuns, latestWebRuns, activeWebJobs] = user ? await queryBatch([
    db.select().from(sourceConnectors).where(eq(sourceConnectors.userId, user.id)).orderBy(desc(sourceConnectors.createdAt)),
    db.select().from(backgroundJobs).where(eq(backgroundJobs.userId, user.id)).orderBy(desc(backgroundJobs.createdAt)).limit(8),
    db.select().from(appSettings).where(eq(appSettings.userId, user.id)).limit(1),
    db.select().from(careerPreferences).where(eq(careerPreferences.userId, user.id)).limit(1),
    db.select().from(jobSearchTargets).where(eq(jobSearchTargets.userId, user.id)).orderBy(asc(jobSearchTargets.position)),
    db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, user.id)).limit(1),
    db.select().from(companyRecommendations).where(eq(companyRecommendations.userId, user.id)).orderBy(desc(companyRecommendations.confidence)),
    db.select().from(agentRuns).where(and(eq(agentRuns.userId, user.id), eq(agentRuns.runType, "company_research"))).orderBy(desc(agentRuns.createdAt)).limit(1),
    db.select().from(agentRuns).where(and(eq(agentRuns.userId, user.id), eq(agentRuns.runType, "web_job_search"))).orderBy(desc(agentRuns.createdAt)).limit(1),
    db.select().from(backgroundJobs).where(and(eq(backgroundJobs.userId, user.id), eq(backgroundJobs.jobType, "web_job_search"), or(eq(backgroundJobs.status, "queued"), eq(backgroundJobs.status, "running")))).orderBy(desc(backgroundJobs.createdAt)).limit(1),
  ]) : [[], [], [], [], [], [], [], [], [], []];
  const settings = settingsRows[0];
  const preferences = preferenceRows[0];
  const profile = profileRows[0];
  const latestCompanyRun = latestCompanyRuns[0];
  const latestWebRun = latestWebRuns[0];
  const activeWebJob = activeWebJobs[0];
  const activeWebJobRunning = activeWebJob?.status === "running";
  const titles = targets.length ? targets.map((target) => target.targetTitle) : preferences?.targetTitlesJson ?? [];
  const locations = targets.length ? Array.from(new Set(targets.flatMap((target) => target.locationsJson))) : preferences?.locationsJson ?? [];
  const workModes = Array.from(new Set(targets.map((target) => target.remotePreference)));
  const webReady = Boolean(settings?.aiEnabled && (settings.aiProvider === "openai" || settings.aiProvider === "deepseek"));
  const hostedWebProvider = settings?.aiProvider === "openai" ? "OpenAI" : settings?.aiProvider === "deepseek" ? "DeepSeek" : null;
  const companyWebReady = webReady;
  const recommendedCompanies = recommendations.filter((item) => item.status === "verified" || item.status === "connected");
  const latestCompanyMode = (latestCompanyRun?.outputJson as { mode?: "recommend" | "connect" } | null)?.mode;
  const dailySearchEnabled = Boolean(preferences?.searchEnabled);
  const autoActive = Boolean(dailySearchEnabled && settings?.workerEnabled && webReady);
  const frequencyLabel = preferences?.searchFrequencyMinutes === 360
    ? pick(locale, "每 6 小时", "Every 6 hours")
    : preferences?.searchFrequencyMinutes === 720
      ? pick(locale, "每 12 小时", "Every 12 hours")
      : preferences?.searchFrequencyMinutes === 4320
        ? pick(locale, "每 3 天", "Every 3 days")
        : preferences?.searchFrequencyMinutes === 10080
          ? pick(locale, "每周", "Weekly")
          : pick(locale, "每天", "Daily");
  const latestWebOutput = latestWebRun?.status === "succeeded" ? latestWebRun.outputJson as {
    queries?: string[];
    searchResults?: number;
    candidatesFound?: number;
    pagesInspected?: number;
    pageFetchFailures?: number;
    unreadablePages?: number;
    snippetCandidatesInspected?: number;
    parsedPostings?: number;
    aiExtractionAttempts?: number;
    aiExtractionErrors?: number;
    aiMatched?: number;
    aiMatchErrors?: number;
    added?: number;
    updated?: number;
    budgetExhausted?: boolean;
    degraded?: boolean;
  } | null : null;
  const searchResultCount = latestWebOutput
    ? latestWebOutput.candidatesFound ?? (latestWebOutput.searchResults == null ? (latestWebOutput.pagesInspected ?? 0) + (latestWebOutput.snippetCandidatesInspected ?? 0) : Math.min(latestWebOutput.searchResults, 36))
    : null;

  return <div className="page-shell automation-page">
    <header className="page-header"><div><p className="eyebrow">DISCOVERY AUTOMATION</p><h1>{pick(locale, "岗位来源与自动化", "Sources & automation")}</h1><p className="page-description">{advanced ? pick(locale, "用 AI 查找并连接特定公司的官方招聘页，管理后台 Worker 和同步日志。", "Use AI to find and connect official company careers pages, then manage the worker and sync logs.") : pick(locale, "自动搜索当前公开岗位，或一键打开 LinkedIn、SEEK 等平台搜索。", "Search current public jobs automatically, or open LinkedIn, SEEK, and other platforms in one click.")}</p></div>{advanced && connectors.length ? <form action={syncAllSourcesNow}><button className="button button-primary"><RefreshCw size={16} />{pick(locale, "立即同步全部", "Sync all now")}</button></form> : null}</header>

    <nav className="automation-mode-tabs segmented-control" aria-label={pick(locale, "设置模式", "Settings mode")}><Link className={!advanced ? "active" : ""} href="/automation">{pick(locale, "标准", "Standard")}</Link><Link className={advanced ? "active" : ""} href="/automation?mode=advanced">{pick(locale, "高级", "Advanced")}</Link></nav>

    {!advanced ? <>
      <div className="section-heading standard-section-heading">
        <div><p className="eyebrow">AI JOB MATCHING</p><h2>{pick(locale, "AI 匹配岗位", "AI-matched jobs")}</h2></div>
        <form action={runStandardDiscovery}><button className="button button-primary" disabled={!webReady || !titles.length || Boolean(activeWebJob)}>{activeWebJob ? <RefreshCw className={activeWebJobRunning ? "spin" : undefined} size={16} /> : <Sparkles size={16} />}{activeWebJob ? activeWebJobRunning ? pick(locale, "正在搜索岗位", "Searching for jobs") : pick(locale, "等待开始搜索", "Waiting to start") : pick(locale, "立即搜索一次", "Search now")}</button></form>
      </div>
      <section className="standard-automation-panel discovery-setup-panel">
        <div className="standard-profile-summary"><span className="settings-icon"><Settings2 size={18} /></span><div><p className="eyebrow">SEARCH PROFILE</p><h2>{titles.length ? titles.slice(0, 3).join(" · ") : pick(locale, "先设置目标岗位", "Set target roles first")}</h2><p>{locations.length ? locations.join(" · ") : pick(locale, "不限地点", "Any location")} · {workModes.length ? workModes.join(" / ") : "any"}</p></div><Link className="button button-secondary" href="/preferences">{titles.length ? pick(locale, "编辑偏好", "Edit preferences") : pick(locale, "设置偏好", "Set preferences")}<ArrowUpRight size={15} /></Link></div>
        <div className="discovery-readiness-grid">
          <Link className={`discovery-readiness ${profile?.analyzedAt ? "ready" : ""}`} href="/profile"><span>{profile?.analyzedAt ? <CheckCircle2 size={18} /> : <Brain size={18} />}</span><div><strong>{pick(locale, "候选人画像（可选）", "Candidate profile (optional)")}</strong><p>{profile?.analyzedAt ? profile.headline : pick(locale, "用于增强岗位匹配，不影响直接搜索", "Improves matching but is not required for search")}</p></div><ArrowUpRight size={15} /></Link>
          <Link className={`discovery-readiness ${titles.length ? "ready" : ""}`} href="/preferences"><span>{titles.length ? <CheckCircle2 size={18} /> : <Settings2 size={18} />}</span><div><strong>{pick(locale, "岗位偏好", "Job preferences")}</strong><p>{titles.length ? `${titles.length} ${pick(locale, "个目标岗位", "target roles")}` : pick(locale, "需要至少一个目标岗位", "At least one target role is required")}</p></div><ArrowUpRight size={15} /></Link>
          <Link className={`discovery-readiness ${webReady ? "ready" : ""}`} href="/settings"><span>{webReady ? <CheckCircle2 size={18} /> : <Globe2 size={18} />}</span><div><strong>{pick(locale, "网络岗位发现", "Web job discovery")}</strong><p>{hostedWebProvider ? pick(locale, `${hostedWebProvider} 原生联网搜索`, `${hostedWebProvider} native web search`) : pick(locale, "先启用一个 AI 模型", "Enable an AI provider first")}</p></div><ArrowUpRight size={15} /></Link>
        </div>
        <div className="standard-primary-actions automation-schedule-control">
          <div className="automation-schedule-copy">
            <strong>{pick(locale, "每日自动搜索", "Daily auto-search")}</strong>
            <p>{autoActive
              ? pick(locale, `已开启 · ${frequencyLabel}`, `Enabled · ${frequencyLabel}`)
              : dailySearchEnabled
                ? pick(locale, "计划已保存，但后台自动化当前暂停", "Schedule saved, but background automation is paused")
                : pick(locale, "关闭时仍可使用“立即搜索一次”", "Search now remains available while this is off")}</p>
          </div>
          <form action={setDailyDiscoveryEnabled}>
            <input name="enabled" type="hidden" value={dailySearchEnabled ? "false" : "true"} />
            <button
              aria-checked={dailySearchEnabled}
              aria-label={dailySearchEnabled ? pick(locale, "关闭每日自动搜索", "Turn off daily auto-search") : pick(locale, "开启每日自动搜索", "Turn on daily auto-search")}
              className="automation-schedule-switch"
              disabled={!dailySearchEnabled && (!webReady || !titles.length)}
              role="switch"
              type="submit"
            >
              <span aria-hidden="true" />
              <strong>{dailySearchEnabled ? pick(locale, "已开启", "On") : pick(locale, "已关闭", "Off")}</strong>
            </button>
          </form>
        </div>
        {!webReady ? <p className="provider-update-note">{pick(locale, "启用 OpenAI 或 DeepSeek 后即可使用自动岗位发现。", "Enable OpenAI or DeepSeek to use automatic job discovery.")} <Link href="/settings">{pick(locale, "前往设置", "Open Settings")}</Link></p> : <p className="provider-update-note">{pick(locale, `当前使用 ${hostedWebProvider} 原生联网搜索；搜索结果仍会经过岗位页验证、去重和偏好判断。`, `Currently using ${hostedWebProvider} native web search. Results are still verified as job pages, deduplicated, and evaluated against your preferences.`)}</p>}
        {latestWebRun?.status === "failed" ? <p className="form-error">{friendlyAgentError(latestWebRun.errorMessage, locale)}</p> : null}
        <p className="standard-automation-note">{pick(locale, "每日计划开启后，JobPilot 会在后台自动搜索，去重并把新结果放进“岗位发现”；不需要每天点击按钮。按钮只用于立即执行一次。这里不依赖公司招聘页连接，LinkedIn、SEEK 等登录平台由下方入口在浏览器中打开。", "Once the daily schedule is enabled, JobPilot searches in the background, deduplicates results, and adds new matches to Job Discovery automatically. You do not need to click every day; the button only runs an extra search now. Company source connections are not required, and signed-in platforms such as LinkedIn and SEEK open from the shortcuts below.")}</p>
      </section>
      <section className="standard-source-summary"><div><Globe2 size={18} /><span><strong>{searchResultCount == null ? "—" : String(searchResultCount)}</strong>{pick(locale, "网页搜索结果", "web search results")}</span></div><div><Search size={18} /><span><strong>{latestWebOutput ? String(latestWebOutput.parsedPostings ?? 0) : "—"}</strong>{pick(locale, "确认岗位", "jobs confirmed")}</span></div><div><Brain size={18} /><span><strong>{latestWebOutput ? String(latestWebOutput.aiMatched ?? 0) : "—"}</strong>{pick(locale, "完成 AI 匹配", "AI matches completed")}</span></div><div><Sparkles size={18} /><span><strong>{latestWebOutput ? String(latestWebOutput.added ?? 0) : "—"}</strong>{pick(locale, "新增匹配", "new matches")}</span></div><Link href="/matches">{pick(locale, "查看岗位发现", "View job discovery")}<ArrowUpRight size={14} /></Link></section>
      {latestWebOutput && (searchResultCount ?? 0) > 0 && !(latestWebOutput.parsedPostings ?? 0) ? <p className="provider-update-note search-run-detail">{pick(locale, `本轮执行了 ${latestWebOutput.queries?.length ?? 0} 组搜索，返回 ${searchResultCount} 条网页结果，并读取了 ${latestWebOutput.pagesInspected ?? 0} 个页面${latestWebOutput.pageFetchFailures ? `；${latestWebOutput.pageFetchFailures} 个页面无法直接读取` : ""}${latestWebOutput.aiExtractionAttempts ? `；AI 兜底检查了 ${latestWebOutput.aiExtractionAttempts} 个结果` : ""}，但仍未确认到信息完整的独立岗位。`, `This run used ${latestWebOutput.queries?.length ?? 0} queries, returned ${searchResultCount} web results, and read ${latestWebOutput.pagesInspected ?? 0} pages${latestWebOutput.pageFetchFailures ? `; ${latestWebOutput.pageFetchFailures} pages could not be fetched directly` : ""}${latestWebOutput.aiExtractionAttempts ? `; AI checked ${latestWebOutput.aiExtractionAttempts} fallback results` : ""}, but still did not confirm a complete individual job.`)}</p> : null}
      {latestWebOutput && (latestWebOutput.parsedPostings ?? 0) > 0 && !((latestWebOutput.added ?? 0) + (latestWebOutput.updated ?? 0)) ? <p className="provider-update-note search-run-detail">{pick(locale, `本轮确认了 ${latestWebOutput.parsedPostings} 个岗位，但它们都与职级、地点或排除条件存在明确冲突。`, `This run confirmed ${latestWebOutput.parsedPostings} job(s), but all clearly conflicted with seniority, location, or exclusion rules.`)}</p> : null}
      {latestWebOutput?.degraded ? <p className="provider-update-note search-run-detail">{pick(locale, `本轮搜索已经完成，但有部分来源未能读取或分析，系统已自动跳过；已确认并保存的岗位不受影响。`, `This search completed with some sources skipped because they could not be read or analyzed. Confirmed and saved jobs are unaffected.`)}</p> : null}
      {latestWebOutput?.budgetExhausted ? <p className="provider-update-note search-run-detail">{pick(locale, "本轮达到云端执行时限后已保存现有结果并正常结束；你可以再次点击“立即搜索一次”。", "This run saved its results and finished when it reached the cloud execution limit. You can select Search now again.")}</p> : null}
      <section className="company-strategy-section">
        <div className="section-heading">
          <div><p className="eyebrow">AI COMPANY RECOMMENDATIONS</p><h2>{pick(locale, "AI 推荐公司", "AI-recommended companies")}</h2></div>
          <form action={runCompanyRecommendations}>
            <CompanyDiscoverySubmit
              disabled={!companyWebReady || !titles.length}
              label={recommendedCompanies.length ? pick(locale, "更新推荐", "Refresh recommendations") : pick(locale, "推荐适合我的公司", "Recommend companies")}
              pendingLabel={pick(locale, "正在查找并核实官网…", "Finding and verifying careers pages…")}
            />
          </form>
        </div>
        <p className="company-section-description">{pick(locale, "根据你的画像和岗位偏好推荐公司；这里只核实公司及其官方招聘页，不代表该网站支持自动同步。", "Recommendations are based on your profile and job preferences. Verification confirms the company and its official careers page, not automatic sync support.")}</p>
        {latestCompanyRun?.status === "failed" && latestCompanyMode !== "connect" ? <p className="form-error">{friendlyAgentError(latestCompanyRun.errorMessage, locale)}</p> : null}
        {recommendedCompanies.length ? <div className="company-recommendation-list">{recommendedCompanies.map((company) => <article key={company.id}><div className="company-recommendation-main"><span className="settings-icon"><Building2 size={18} /></span><div><h3>{company.companyName}</h3><p>{company.reason}</p><div className="company-meta"><span className="status-pill status-active">{pick(locale, "官方招聘页已核实", "Official careers page verified")}</span>{company.status === "connected" && company.atsProvider ? <span>{pick(locale, `已通过 ${company.atsProvider} 自动同步`, `Auto-syncing via ${company.atsProvider}`)}</span> : null}{company.careersUrl ? <a href={company.careersUrl} rel="noreferrer" target="_blank">{pick(locale, "查看招聘页", "View careers page")}<ArrowUpRight size={13} /></a> : null}</div></div></div><form action={dismissCompanyRecommendation}><input name="id" type="hidden" value={company.id} /><button className="icon-button" title={pick(locale, "不再推荐这家公司", "Remove this recommendation")}><X size={16} /></button></form></article>)}</div> : <div className="inline-empty"><Building2 size={18} />{pick(locale, "还没有公司推荐。你可以让 AI 根据画像和岗位偏好查找并核实适合的公司。", "No company recommendations yet. AI can find and verify companies based on your profile and job preferences.")}</div>}
      </section>
      <PlatformSearchPanel locale={locale} targets={targets.map((target) => ({ id: target.id, targetTitle: target.targetTitle, seniorityLevel: target.seniorityLevel, locations: target.locationsJson }))} />
    </> : <>
      <section className="standard-automation-panel discovery-setup-panel">
        <div className="standard-profile-summary"><span className="settings-icon"><Building2 size={18} /></span><div><p className="eyebrow">CONNECTABLE COMPANY SOURCES</p><h2>{pick(locale, "AI 精确连接公司招聘页", "AI-connectable company sources")}</h2><p>{pick(locale, "直接搜索并连接使用 Greenhouse、Lever 或 Ashby 的公开公司招聘页。普通官网推荐不会出现在这里。", "Search for and connect public company job boards hosted on Greenhouse, Lever, or Ashby. General careers-page recommendations stay in Standard mode.")}</p></div><form action={runCompanySourceSetup}><CompanyDiscoverySubmit disabled={!companyWebReady || !titles.length} label={pick(locale, "搜索并连接", "Search and connect")} pendingLabel={pick(locale, "正在搜索可连接来源…", "Searching connectable sources…")} /></form></div>
        {!companyWebReady ? <p className="provider-update-note">{pick(locale, "启用 OpenAI 或 DeepSeek 后即可搜索可自动同步的公司招聘源。", "Enable OpenAI or DeepSeek to find auto-syncable company sources.")} <Link href="/settings">{pick(locale, "前往设置", "Open Settings")}</Link></p> : <p className="provider-update-note">{pick(locale, `将使用 ${hostedWebProvider} 搜索公开 ATS，并只把完成验证且能够同步的来源加入下方列表。`, `${hostedWebProvider} will search public ATS boards; only verified, syncable sources are added below.`)}</p>}
        {latestCompanyRun?.status === "failed" && latestCompanyMode === "connect" ? <p className="form-error">{friendlyAgentError(latestCompanyRun.errorMessage, locale)}</p> : null}
        <p className="standard-automation-note">{pick(locale, "此功能只负责建立可重复同步的公司招聘源。公司推荐和普通官方招聘页请在“标准”模式查看。", "This feature only creates repeatable company-source syncs. Company recommendations and general official careers pages are shown in Standard mode.")}</p>
      </section>

      <section className="automation-grid" id="company-connectors">
        <div className="preference-section"><div className="preference-heading"><span>01</span><div><h2>{pick(locale, "连接公司招聘页", "Connect a company careers page")}</h2><p>{pick(locale, "仅当公司官网使用 Greenhouse、Lever 或 Ashby 时需要配置。", "Only configure this when a company careers site uses Greenhouse, Lever, or Ashby.")}</p></div></div>
          <form action={addSourceConnector} className="job-form"><div className="form-row two-columns"><label>{pick(locale, "招聘系统", "ATS provider")}<select name="provider"><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="ashby">Ashby</option></select></label><label>{pick(locale, "公司名称", "Company name")}<input name="name" required /></label></div><label>{pick(locale, "招聘页网址或 Board ID", "Board URL or ID")}<input name="board" placeholder="https://jobs.lever.co/company" required /></label><div className="form-row two-columns"><label>{pick(locale, "Lever 数据区域", "Lever data region")}<select name="region"><option value="global">Global</option><option value="eu">EU</option></select></label><button className="button button-primary source-add-button"><Plus size={16} />{pick(locale, "添加连接器", "Add connector")}</button></div></form>
        </div>
        <form action={saveAutomationSettings} className="preference-section"><div className="preference-heading"><span>02</span><div><h2>{pick(locale, "后台 Worker", "Background worker")}</h2><p>{pick(locale, "随 JobPilot 自动运行，控制连接器刷新和应用内通知；不会提交申请或发送邮件。", "Runs automatically with JobPilot to refresh connectors and create in-app notifications. It never applies or sends email.")}</p></div></div><label className="checkbox-row"><input defaultChecked={settings?.workerEnabled ?? true} name="workerEnabled" type="checkbox" />{pick(locale, "启用后台任务", "Enable background jobs")}</label><label className="checkbox-row"><input defaultChecked={settings?.notificationsEnabled ?? true} name="notificationsEnabled" type="checkbox" />{pick(locale, "启用应用内通知", "Enable in-app notifications")}</label><div className="worker-command"><code>{pick(locale, "已随应用启动", "Started with the app")}</code><span>{pick(locale, "无需单独运行命令", "No separate command required")}</span></div><button className="button button-secondary"><Activity size={16} />{pick(locale, "保存高级设置", "Save advanced settings")}</button></form>
      </section>

      <section className="source-list-section"><div className="section-heading"><div><p className="eyebrow">CONNECTED SOURCES</p><h2>{pick(locale, "已连接的公司招聘源", "Connected company sources")}</h2></div></div>
        {connectors.length ? <div className="settings-list source-list">{connectors.map((connector) => <section key={connector.id}><span className="settings-icon"><Rss size={18} /></span><div><h2>{connector.name} <span className="status-pill">{connector.provider}</span></h2><p>{connector.boardToken} · {connector.lastSuccessAt ? pick(locale, `上次成功 ${formatLocaleDate(connector.lastSuccessAt, locale)}`, `Last success ${formatLocaleDate(connector.lastSuccessAt, locale)}`) : pick(locale, "尚未同步", "Not synced yet")}{connector.lastError ? ` · ${connector.lastError}` : ""}</p></div><div className="source-row-actions"><form action={syncSourceNow}><input name="id" type="hidden" value={connector.id} /><button className="icon-link" title={pick(locale, "立即同步", "Sync now")}><Play size={16} /></button></form><form action={toggleSourceConnector}><input name="id" type="hidden" value={connector.id} /><button className="icon-link" title={pick(locale, connector.enabled ? "停用" : "启用", connector.enabled ? "Disable" : "Enable")}>{connector.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}</button></form></div></section>)}</div> : <div className="inline-empty"><Rss size={18} />{pick(locale, "没有连接器。标准模式的平台搜索无需连接器。", "No connectors. Platform searches in Standard mode do not need one.")}</div>}
      </section>

      <section className="source-list-section"><div className="section-heading"><div><p className="eyebrow">RECENT JOBS</p><h2>{pick(locale, "后台任务日志", "Background job log")}</h2></div></div><div className="task-log">{jobs.length ? jobs.map((job) => <div key={job.id}><span className={`status-pill status-${job.status === "succeeded" ? "active" : job.status === "failed" ? "expired" : "possibly_expired"}`}>{job.status === "queued" ? pick(locale, "等待中", "queued") : job.status === "running" ? pick(locale, "进行中", "running") : job.status === "succeeded" ? pick(locale, "已完成", "succeeded") : pick(locale, "失败", "failed")}</span><strong>{job.jobType}</strong><small>{formatLocaleDate(job.updatedAt, locale)}{job.lastError ? ` · ${job.lastError}` : ""}</small></div>) : <p>{pick(locale, "还没有后台任务。", "No background jobs yet.")}</p>}</div></section>
    </>}
  </div>;
}
