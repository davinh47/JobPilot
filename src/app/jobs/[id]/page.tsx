import Link from "next/link";
import { and, asc, desc, eq, or } from "drizzle-orm";
import { ArrowRight, ArrowUpRight, CalendarPlus, ChevronLeft, CircleAlert, FilePenLine, FileText, Mail, RefreshCw, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { addJobToPipeline, deleteApplication, updateApplicationStatus } from "@/app/actions";
import { db } from "@/db";
import { queryBatch } from "@/db/batch";
import { getCurrentUser } from "@/lib/current-user";
import { applicationEvents, applications, applicationStatuses, appSettings, backgroundJobs, jobs, jobMatches, materials } from "@/db/schema";
import { listingStatusLabels } from "@/lib/constants";
import { formatLocaleDate, getLocale, pick } from "@/lib/i18n";
import { scheduleInterview } from "@/app/interviews/actions";
import { verifyJobListing } from "./actions";
import { readLocalSecrets } from "@/lib/secrets";
import { createBasicInterviewPack, createSafeTailoredResume } from "./workflow-actions";
import { CoverLetterGenerateForm } from "@/components/cover-letter-generate-form";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { JobDescriptionView } from "@/components/job-description-view";
import { JobMatchButton } from "@/components/job-match-button";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ coverLetter?: string; tailored?: string; outputLanguage?: string }> }) {
  const { id } = await params;
  const { coverLetter, tailored, outputLanguage } = await searchParams;
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) notFound();
  const [batched, secrets] = await Promise.all([
    queryBatch([
      db.select({ job: jobs, application: applications })
        .from(jobs)
        .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, user.id)))
        .where(and(eq(jobs.id, id), eq(jobs.ownerUserId, user.id)))
        .limit(1),
      db.select().from(jobMatches).where(and(eq(jobMatches.jobId, id), eq(jobMatches.userId, user.id))).orderBy(desc(jobMatches.createdAt)).limit(1),
      db.select().from(applicationStatuses).where(eq(applicationStatuses.userId, user.id)).orderBy(asc(applicationStatuses.position)),
      db.select().from(appSettings).where(eq(appSettings.userId, user.id)).limit(1),
      db.select({ event: applicationEvents })
        .from(applicationEvents)
        .innerJoin(applications, eq(applicationEvents.applicationId, applications.id))
        .where(and(eq(applications.userId, user.id), eq(applications.jobId, id)))
        .orderBy(asc(applicationEvents.occurredAt)),
      db.select({ material: materials })
        .from(materials)
        .innerJoin(applications, eq(materials.applicationId, applications.id))
        .where(and(eq(applications.userId, user.id), eq(applications.jobId, id), eq(materials.materialType, "cover_letter")))
        .orderBy(asc(materials.createdAt)),
      db.select({ status: backgroundJobs.status, payloadJson: backgroundJobs.payloadJson })
        .from(backgroundJobs)
        .where(and(eq(backgroundJobs.userId, user.id), eq(backgroundJobs.jobType, "job_match"), or(eq(backgroundJobs.status, "queued"), eq(backgroundJobs.status, "running"))))
        .orderBy(desc(backgroundJobs.createdAt))
        .limit(20),
      db.select({ status: backgroundJobs.status, payloadJson: backgroundJobs.payloadJson })
        .from(backgroundJobs)
        .where(and(eq(backgroundJobs.userId, user.id), eq(backgroundJobs.jobType, "cover_letter"), or(eq(backgroundJobs.status, "queued"), eq(backgroundJobs.status, "running"))))
        .orderBy(desc(backgroundJobs.createdAt))
        .limit(20),
    ]),
    readLocalSecrets(user.id),
  ]);
  const [rows, matches, statuses, aiSettingsRows, eventRows, materialRows, matchJobs, coverLetterJobs] = batched;
  const row = rows[0];
  if (!row) notFound();
  const match = matches[0];
  const aiSettings = aiSettingsRows[0];
  const keyConfigured = Boolean(aiSettings?.aiProvider === "openai" ? secrets.openaiApiKey : secrets.deepseekApiKey);
  const events = eventRows.map(({ event }) => event);
  const coverLetters = materialRows.map(({ material }) => material);
  const matchQueued = matchJobs.some((job) => job.payloadJson.jobId === row.job.id);
  const coverLetterQueued = coverLetterJobs.some((job) => job.payloadJson.jobId === row.job.id);

  return (
    <div className="page-shell">
      <Link className="back-link" href={row.application ? "/pipeline" : "/matches"}><ChevronLeft size={16} />{row.application ? pick(locale, "返回申请进度", "Back to pipeline") : pick(locale, "返回岗位发现", "Back to discovery")}</Link>
      <header className="job-detail-header">
        <div><p className="eyebrow">{row.job.companyName}</p><h1>{row.job.title}</h1><p className="page-description">{row.job.location || pick(locale, "地点未注明", "Location not listed")} · {row.job.workplaceType}{row.job.employmentType ? ` · ${row.job.employmentType}` : ""}{row.job.salaryMin ? ` · ${row.job.salaryCurrency ?? ""} ${row.job.salaryMin.toLocaleString()}${row.job.salaryMax && row.job.salaryMax !== row.job.salaryMin ? `–${row.job.salaryMax.toLocaleString()}` : ""}` : ""}</p></div>
        <div className="header-actions">
          {row.job.canonicalUrl ? <a className="button button-secondary" href={row.job.canonicalUrl} rel="noreferrer" target="_blank">{pick(locale, "原始岗位", "Original listing")}<ArrowUpRight size={16} /></a> : null}
          {row.job.canonicalUrl ? <form action={verifyJobListing}><input name="jobId" type="hidden" value={row.job.id} /><button className="button button-secondary"><RefreshCw size={16} />{pick(locale, "核验有效性", "Verify listing")}</button></form> : null}
          <JobMatchButton enabled={Boolean(aiSettings?.aiEnabled && keyConfigured && aiSettings.workerEnabled !== false)} hasMatch={Boolean(match?.modelName)} initiallyQueued={matchQueued} jobId={row.job.id} locale={locale} />
        </div>
      </header>

      <div className="detail-layout">
        <div className="detail-main">
          <section className="content-section">
            <div className="section-heading"><div><p className="eyebrow">SOURCE SNAPSHOT</p><h2>{pick(locale, "职位描述", "Job description")}</h2></div><span className={`status-pill status-${row.job.listingStatus}`}>{locale === "zh" ? listingStatusLabels[row.job.listingStatus] : ({ unknown: "Unknown", active: "Active", possibly_expired: "Possibly closed", expired: "Closed" }[row.job.listingStatus])}</span></div>
            <JobDescriptionView description={row.job.descriptionText} locale={locale} />
          </section>

          <section className="content-section">
            <div className="section-heading"><div><p className="eyebrow">MATCH EVIDENCE</p><h2>{pick(locale, "简历支持的匹配点与目标差距", "Resume-backed fit and target gaps")}</h2></div>{match ? <div className="match-score-summary"><strong className="large-score">{match.overallScore}%</strong><small>{pick(locale, "仅供参考", "Guidance only")}</small></div> : null}</div>
            {match ? (
              <div className="evidence-columns">
                <div><h3>{pick(locale, "简历支持的匹配点", "Resume-backed matches")}</h3>{match.evidenceJson.length ? match.evidenceJson.map((item, index) => <p key={index}>{item.claim}</p>) : <p>{pick(locale, "简历中暂未找到直接支持该岗位匹配的内容。", "The resume does not yet contain content that directly supports this match.")}</p>}</div>
                <div><h3>{pick(locale, "可能不匹配的地方", "Potential mismatches")}</h3>{match.gapsJson.length ? match.gapsJson.map((gap, index) => <p key={index}>{gap}</p>) : <p>{pick(locale, "暂未发现明确缺口。", "No clear gap was identified.")}</p>}</div>
                <div><h3>{pick(locale, "仍需补充或查明", "Information still needed")}</h3>{match.uncertaintiesJson.length ? match.uncertaintiesJson.map((item, index) => <p key={index}>{item}</p>) : <p>{pick(locale, "当前信息已经足够，没有需要额外补充的项目。", "The current sources provide enough information; nothing else needs to be added.")}</p>}</div>
              </div>
            ) : (
              <div className="inline-empty"><CircleAlert size={20} /><span>{pick(locale, "还没有匹配分析。接入 AI 模型后，这里会显示分项评分、证据、缺口和不确定项。", "No match analysis yet. Once an AI provider is connected, this area will show dimension scores, evidence, gaps, and uncertainties.")}</span></div>
            )}
          </section>
        </div>

        <aside className="detail-sidebar">
          <section className="side-section">
            <p className="eyebrow">APPLICATION</p><h2>{pick(locale, "申请进度", "Application")}</h2>
            {row.application ? (
              <form action={updateApplicationStatus} className="status-form">
                <input name="applicationId" type="hidden" value={row.application.id} />
                <input name="jobId" type="hidden" value={row.job.id} />
                <select name="status" defaultValue={row.application.status}>{statuses.map((status) => <option key={status.id} value={status.slug}>{locale === "zh" ? status.labelZh : status.labelEn}</option>)}</select>
                <button className="button button-secondary" type="submit">{pick(locale, "更新", "Update")}</button>
              </form>
            ) : <form action={addJobToPipeline} className="add-pipeline-form"><input name="jobId" type="hidden" value={row.job.id} /><p>{pick(locale, "这个岗位仍在发现池中。加入后会从发现页移除，并进入“待申请”栏。", "This job is still in discovery. Adding it moves the role into the To apply column.")}</p><button className="button button-primary" type="submit">{pick(locale, "加入申请进度", "Add to pipeline")}<ArrowRight size={16} /></button></form>}
            {row.application ? <form action={deleteApplication} className="detail-delete-application"><input name="applicationId" type="hidden" value={row.application.id} /><ConfirmDeleteButton cancelLabel={pick(locale, "取消", "Cancel")} confirmLabel={pick(locale, "移出申请进度", "Remove application")} description={pick(locale, `将删除 ${row.job.companyName} · ${row.job.title} 的申请时间线、材料和面试记录。岗位与网页快照会保留并回到岗位推荐。`, `This removes the application timeline, materials, and interviews for ${row.job.companyName} · ${row.job.title}. The job and snapshots remain and return to discovery.`)} title={pick(locale, "移出申请进度？", "Remove from pipeline?")} triggerLabel={pick(locale, "删除申请记录", "Delete application record")} /></form> : null}
            <div className="timeline">
              {events.map((event) => <div className="timeline-event" key={event.id}><span /><div><strong>{event.title === "Added to application pipeline" ? pick(locale, "已加入申请进度", event.title) : event.title}</strong><small>{formatLocaleDate(event.occurredAt, locale)}</small></div></div>)}
            </div>
          </section>
          {row.application ? <section className="side-section"><p className="eyebrow">INTERVIEW</p><h2>{pick(locale, "安排面试", "Schedule interview")}</h2><form action={scheduleInterview} className="job-form compact-side-form"><input name="applicationId" type="hidden" value={row.application.id} /><input name="jobId" type="hidden" value={row.job.id} /><label>{pick(locale, "轮次", "Stage")}<input name="stage" placeholder={pick(locale, "例如：招聘经理面试", "e.g. Hiring manager")} required /></label><div className="form-row two-columns"><label>{pick(locale, "形式", "Format")}<select name="format"><option value="video">Video</option><option value="phone">Phone</option><option value="onsite">Onsite</option><option value="take_home">Take home</option><option value="other">Other</option></select></label><label>{pick(locale, "分钟", "Minutes")}<input defaultValue="60" min="5" name="durationMinutes" type="number" /></label></div><label>{pick(locale, "时间", "Time")}<input name="scheduledAt" required type="datetime-local" /></label><label>{pick(locale, "备注 / 会议链接", "Notes / meeting link")}<textarea name="notes" rows={3} /></label><button className="button button-secondary"><CalendarPlus size={16} />{pick(locale, "加入面试中心", "Add to interview center")}</button></form><a className="button button-secondary email-draft-button" href={`mailto:?subject=${encodeURIComponent(`Question about ${row.job.title} at ${row.job.companyName}`)}&body=${encodeURIComponent("Hello,\n\nI am writing regarding the role.\n\nBest regards,")}`}><Mail size={16} />{pick(locale, "打开邮件草稿", "Open email draft")}</a></section> : null}
          <section className="side-section">
            <p className="eyebrow">MATERIALS</p><h2>{pick(locale, "申请材料", "Materials")}</h2>
            {coverLetter === "queued" || coverLetterQueued ? <p className="form-success" role="status">{pick(locale, "求职信已提交后台生成，完成后会通过通知提醒你。你可以继续浏览其他页面。", "The cover letter is being generated in the background. You will be notified when it is ready.")}</p> : null}
            {coverLetter === "failed" ? <p className="form-error">{pick(locale, "求职信生成失败；可在后台运行记录中查看原因。", "Cover letter generation failed. See the agent run log for details.")}</p> : null}
            {coverLetter === "unavailable" ? <p className="form-error">{pick(locale, "请先启用 AI 模型，并把岗位加入申请进度。", "Enable an AI provider and add this job to the pipeline first.")}</p> : null}
            {coverLetter === "no-resume" ? <p className="form-error">{pick(locale, "没有找到可用于生成的简历版本。", "No resume version is available for generation.")}</p> : null}
            {coverLetter === "language-missing" ? <p className="form-error">{pick(locale, `没有找到${outputLanguage === "zh" ? "中文" : "英文"}简历。求职信的正文和寄件人信息必须使用同语言简历，请先导入、创建或同步对应版本。`, `No ${outputLanguage === "zh" ? "Chinese" : "English"} resume was found. The letter body and sender details must use a resume in the same language.`)}</p> : null}
            {tailored === "language-missing" ? <p className="form-error">{pick(locale, `没有找到${outputLanguage === "zh" ? "中文" : "英文"}基础简历。安全定制不会自动翻译，请先导入或创建对应语言的简历。`, `No ${outputLanguage === "zh" ? "Chinese" : "English"} base resume was found. Safe tailoring does not translate automatically; import or create one in that language first.`)}</p> : null}
            <div className="action-list"><CoverLetterGenerateForm enabled={Boolean(row.application && aiSettings?.aiEnabled && keyConfigured)} jobId={row.job.id} locale={locale} /><form action={createSafeTailoredResume}><input name="jobId" type="hidden" value={row.job.id} /><details className="generation-menu"><summary aria-disabled={!row.application}><FilePenLine size={17} />{pick(locale, "创建安全定制简历", "Create safe tailored resume")}</summary><div><button disabled={!row.application} name="outputLanguage" value="zh">{pick(locale, "中文版", "Chinese")}</button><button disabled={!row.application} name="outputLanguage" value="en">{pick(locale, "英文版", "English")}</button></div></details></form><form action={createBasicInterviewPack}><input name="jobId" type="hidden" value={row.job.id} /><details className="generation-menu"><summary aria-disabled={!row.application}><Sparkles size={17} />{pick(locale, "创建基础面试包", "Create basic interview pack")}</summary><div><button disabled={!row.application} name="outputLanguage" value="zh">{pick(locale, "中文版", "Chinese")}</button><button disabled={!row.application} name="outputLanguage" value="en">{pick(locale, "英文版", "English")}</button></div></details></form></div>
            {coverLetters.length ? <div className="material-link-list">{coverLetters.map((material) => <Link href={`/materials/${material.id}`} key={material.id}><FileText size={15} /><span><strong>{material.title}</strong><small>{material.status === "ready" ? pick(locale, "已确认", "Ready") : pick(locale, "草稿", "Draft")} · {formatLocaleDate(material.updatedAt, locale)}</small></span><ArrowRight size={14} /></Link>)}</div> : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
