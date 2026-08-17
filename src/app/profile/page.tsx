import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { ArrowRight, Brain, CheckCircle2, Plus, Settings2, UserRound } from "lucide-react";
import { db } from "@/db";
import { queryBatch } from "@/db/batch";
import { getCurrentUser } from "@/lib/current-user";
import { agentRuns, appSettings, backgroundJobs, candidateProfiles, memories, resumeVersions, resumes } from "@/db/schema";
import { ProfileAnalysisActions } from "@/components/profile-analysis-actions";
import { getLocale, pick } from "@/lib/i18n";
import { candidateAnalysisSchema } from "@/lib/profile-analysis";
import { friendlyAgentError } from "@/lib/agent-errors";
import { sourceAuthority, sourceNeedsConfirmation } from "@/lib/source-authority";
import { addConfirmedMemory, analyzeProfileAction, toggleMemoryConfirmation } from "./actions";

export const dynamic = "force-dynamic";

function evidenceSourceLabel(sourceType: "resume" | "user_context", locale: "zh" | "en") {
  if (sourceType === "resume") return pick(locale, "来自当前主简历", "From your current primary resume");
  return pick(locale, "来自你补充的信息", "From information you provided");
}

function memoryTypeLabel(memoryType: string, locale: "zh" | "en") {
  const labels: Record<string, [string, string]> = {
    capability_evidence: ["能力证据", "Capability evidence"],
    preference: ["偏好", "Preference"],
    star_story: ["STAR 故事", "STAR story"],
    weakness: ["待提升项", "Development area"],
    goal: ["目标", "Goal"],
  };
  const label = labels[memoryType];
  return label ? pick(locale, label[0], label[1]) : memoryType.replaceAll("_", " ");
}

function memorySourceLabel(sourceType: string, confirmed: boolean, locale: "zh" | "en") {
  const authority = sourceAuthority(sourceType);
  if (authority === "user_provided") return pick(locale, "你主动提供", "Provided by you");
  if (authority === "resume_grounded") return pick(locale, "来自简历", "From your resume");
  return confirmed ? pick(locale, "AI 建议 · 已确认", "AI suggestion · Confirmed") : pick(locale, "AI 建议 · 待你确认", "AI suggestion · Needs your confirmation");
}

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ analysis?: string }> }) {
  const locale = await getLocale();
  const query = await searchParams;
  const user = await getCurrentUser();
  const [memoryRows, resumeRows, versions, profileRows, settingsRows, latestRuns, analysisJobs] = user ? await queryBatch([
    db.select().from(memories).where(eq(memories.userId, user.id)).orderBy(desc(memories.updatedAt)),
    db.select().from(resumes).where(eq(resumes.userId, user.id)),
    db.select({
      id: resumeVersions.id,
    }).from(resumeVersions).innerJoin(resumes, eq(resumeVersions.resumeId, resumes.id)).where(eq(resumes.userId, user.id)),
    db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, user.id)).limit(1),
    db.select().from(appSettings).where(eq(appSettings.userId, user.id)).limit(1),
    db.select().from(agentRuns).where(and(eq(agentRuns.userId, user.id), eq(agentRuns.runType, "profile_analysis"))).orderBy(desc(agentRuns.createdAt)).limit(1),
    db.select({ status: backgroundJobs.status }).from(backgroundJobs).where(and(eq(backgroundJobs.userId, user.id), eq(backgroundJobs.jobType, "profile_analysis"))),
  ]) : [[], [], [], [], [], [], []];
  const profile = profileRows[0];
  const settings = settingsRows[0];
  const latestRun = latestRuns[0];
  const profileAnalysisPending = analysisJobs.some((job) => job.status === "queued" || job.status === "running");
  const analysis = candidateAnalysisSchema.safeParse(profile?.profileJson).data;
  const canAnalyze = Boolean(settings?.aiEnabled && resumeRows.length);
  const providerName = settings?.aiProvider === "openai" ? "OpenAI" : "DeepSeek";
  return <div className="page-shell narrow-page"><header className="page-header"><div><p className="eyebrow">CANDIDATE PROFILE</p><h1>{pick(locale, "个人档案", "Candidate profile")}</h1><p className="page-description">{pick(locale, "当前主简历和你主动补充的信息是 JobPilot 的权威事实来源；AI 只负责整理与分析，不会要求你重复确认已有内容。", "Your current primary resume and the information you explicitly provide are JobPilot's authoritative sources. AI organizes and analyzes them without asking you to reconfirm existing facts.")}</p></div></header>
    <section className="profile-analysis-section"><div className="section-heading"><div><div className="profile-analysis-kicker"><p className="eyebrow">AI PROFILE</p><span className={`profile-analysis-state ${profile?.analyzedAt ? "active" : ""}`}>{profile?.analyzedAt ? pick(locale, "已分析", "Analyzed") : pick(locale, "待分析", "Not analyzed")}</span></div><h2>{analysis?.headline ?? pick(locale, "分析候选人画像", "Analyze candidate profile")}</h2></div></div>
      <form action={analyzeProfileAction} className="profile-context-form"><input name="locale" type="hidden" value={locale} /><label>{pick(locale, "你补充的事实与偏好", "Facts and preferences you provide")}<textarea defaultValue={profile?.userContext ?? ""} name="userContext" placeholder={pick(locale, "可补充职业方向、偏好的团队环境、简历未写出的技能或其他真实情况。这些内容会和主简历一样作为你的事实来源。", "Add career direction, preferred team environment, skills not written in the resume, or other factual context. JobPilot treats this as an authoritative source alongside your primary resume.")} rows={5} /></label><ProfileAnalysisActions analyzeLabel={analysis ? pick(locale, "重新分析", "Analyze again") : pick(locale, `用 ${providerName} 分析`, `Analyze with ${providerName}`)} analyzePendingLabel={analysis ? pick(locale, "正在后台分析…", "Analyzing in background…") : pick(locale, "正在后台分析…", "Analyzing in background…")} backgroundPending={profileAnalysisPending} canAnalyze={canAnalyze} saveLabel={pick(locale, "仅保存补充信息", "Save context")} savePendingLabel={pick(locale, "正在保存…", "Saving…")} /></form>
      {!settings?.aiEnabled ? <p className="form-note">{pick(locale, "AI 辅助当前关闭；可在设置中开启。", "AI assistance is off. Enable it in Settings.")}</p> : !resumeRows.length ? <p className="form-note">{pick(locale, "先导入或创建一份简历。", "Import or create a resume first.")}</p> : null}
      {query.analysis === "queued" || profileAnalysisPending ? <p className="form-success" role="status">{pick(locale, "AI 画像已加入后台任务，完成后会通知你。你可以继续浏览其他页面。", "AI profile analysis is running in the background. You will be notified when it is ready.")}</p> : null}
      {query.analysis === "failed" && latestRun?.status !== "failed" ? <p className="form-error">{pick(locale, "AI 画像生成失败，请检查 AI 设置后重试。", "AI profile generation failed. Check AI settings and try again.")}</p> : null}
      {latestRun?.status === "failed" ? <p className="form-error">{friendlyAgentError(latestRun.errorMessage, locale)}</p> : null}
      {analysis ? <div className="profile-analysis-result"><p>{analysis.summary}</p><div className="profile-analysis-columns"><div><h3>{pick(locale, "有原文依据的优势", "Source-backed strengths")}</h3>{analysis.strengths.length ? analysis.strengths.map((item) => <article key={`${item.claim}-${item.sourceQuote}`}><strong>{item.claim}</strong><q>{item.sourceQuote}</q><small>{evidenceSourceLabel(item.sourceType, locale)}</small></article>) : <p className="profile-analysis-empty">{pick(locale, "当前事实来源中暂未提取到可直接引用的优势。", "No directly quotable strength was extracted from the current sources.")}</p>}</div><div><h3>{pick(locale, "适合的方向", "Search direction")}</h3><div className="tag-cloud">{analysis.roleFamilies.map((item) => <span key={item}>{item}</span>)}</div><h3>{pick(locale, "公司特征", "Company traits")}</h3><ul>{analysis.companyTraits.map((item) => <li key={item}>{item}</li>)}</ul>{analysis.gaps.length ? <><h3>{pick(locale, "与目标的差距提示", "Target-fit notes")}</h3><ul>{analysis.gaps.map((item) => <li key={item}>{item}</li>)}</ul></> : null}{analysis.userQuestions.length ? <><h3>{pick(locale, "建议补充的信息", "Information worth adding")}</h3><p className="profile-analysis-note">{pick(locale, "这些内容在当前简历和补充信息中没有出现，并不是对已有事实的质疑。", "These details are not present in your current sources; this is not a challenge to facts you already provided.")}</p><ul>{analysis.userQuestions.map((item) => <li key={item}>{item}</li>)}</ul></> : null}</div></div></div> : null}
    </section>
    <section className="profile-actions"><Link className="profile-action-row" href="/preferences"><span className="settings-icon"><Settings2 size={19} /></span><div><h2>{pick(locale, "岗位搜索偏好", "Job search preferences")}</h2><p>{pick(locale, "设置目标岗位、地点、薪资、行业、签证和自动搜索频率。", "Set target roles, locations, compensation, industries, authorization, and search frequency.")}</p></div><ArrowRight size={17} /></Link><Link className="profile-action-row" href="/resumes"><span className="settings-icon"><UserRound size={19} /></span><div><h2>{pick(locale, "事实源", "Authoritative sources")}</h2><p>{pick(locale, `${resumeRows.length} 份简历 · ${versions.length} 个不可覆盖版本`, `${resumeRows.length} resumes · ${versions.length} immutable versions`)}</p></div><ArrowRight size={17} /></Link></section>
    <section className="memory-section"><div className="section-heading"><div><p className="eyebrow">LONG-TERM MEMORY</p><h2>{pick(locale, "长期求职记忆", "Long-term job search memory")}</h2><p className="memory-description">{pick(locale, "你主动添加或简历明确写出的内容直接采用；只有 AI 推断出的新内容才需要你确认。", "Content you add or state in your resume is used directly. Only new AI-inferred content needs your confirmation.")}</p></div></div><form action={addConfirmedMemory} className="memory-add-form"><select name="memoryType"><option value="capability_evidence">{pick(locale, "能力证据", "Capability evidence")}</option><option value="star_story">{pick(locale, "STAR 故事", "STAR story")}</option><option value="preference">{pick(locale, "偏好", "Preference")}</option><option value="weakness">{pick(locale, "待提升项", "Development area")}</option><option value="goal">{pick(locale, "目标", "Goal")}</option></select><textarea name="content" placeholder={pick(locale, "写下值得在不同岗位中复用的信息。", "Add information worth reusing across roles.")} required rows={1} /><button className="button button-primary"><Plus size={16} />{pick(locale, "添加到记忆", "Add to memory")}</button></form>{memoryRows.length ? <div className="memory-list">{memoryRows.map((memory) => { const needsConfirmation = sourceNeedsConfirmation(memory.sourceType); return <article key={memory.id}><div><span className="status-pill">{memoryTypeLabel(memory.memoryType, locale)}</span><p>{memory.content}</p><small>{memorySourceLabel(memory.sourceType, memory.userConfirmed, locale)}</small></div>{needsConfirmation ? <form action={toggleMemoryConfirmation}><input name="id" type="hidden" value={memory.id} /><button className={`icon-button ${memory.userConfirmed ? "confirmed" : ""}`} title={pick(locale, memory.userConfirmed ? "取消确认" : "确认这条 AI 建议", memory.userConfirmed ? "Unconfirm" : "Confirm this AI suggestion")}><CheckCircle2 size={18} /></button></form> : <span className="memory-source-check" title={pick(locale, "权威事实来源", "Authoritative source")}><CheckCircle2 size={18} /></span>}</article>; })}</div> : <div className="inline-empty"><Brain size={18} />{pick(locale, "暂无长期记忆。你可以主动添加；来自简历的内容无需再次确认。", "No long-term memories yet. You can add one directly; resume-sourced content does not need reconfirmation.")}</div>}</section></div>;
}
