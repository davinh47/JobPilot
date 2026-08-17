import Link from "next/link";
import { and, count, eq, or } from "drizzle-orm";
import { ArrowRight, CheckCircle2, Compass, FileText, Gauge, Settings2, Sparkles } from "lucide-react";
import { db } from "@/db";
import { queryBatch } from "@/db/batch";
import { applications, appSettings, backgroundJobs, careerPreferences, jobSearchTargets, resumes } from "@/db/schema";
import { getCurrentUser } from "@/lib/current-user";
import { getLocale, pick } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [user, locale] = await Promise.all([getCurrentUser(), getLocale()]);
  if (!user) return null;
  const [resumeCounts, applicationCounts, targetCounts, settingsRows, preferenceRows, activeSearches] = await queryBatch([
    db.select({ value: count() }).from(resumes).where(eq(resumes.userId, user.id)),
    db.select({ value: count() }).from(applications).where(eq(applications.userId, user.id)),
    db.select({ value: count() }).from(jobSearchTargets).where(eq(jobSearchTargets.userId, user.id)),
    db.select().from(appSettings).where(eq(appSettings.userId, user.id)).limit(1),
    db.select().from(careerPreferences).where(eq(careerPreferences.userId, user.id)).limit(1),
    db.select({ id: backgroundJobs.id }).from(backgroundJobs).where(and(
      eq(backgroundJobs.userId, user.id),
      eq(backgroundJobs.jobType, "web_job_search"),
      or(eq(backgroundJobs.status, "queued"), eq(backgroundJobs.status, "running")),
    )).limit(1),
  ]);
  const resumeCount = resumeCounts[0];
  const applicationCount = applicationCounts[0];
  const targetCount = targetCounts[0];
  const settings = settingsRows[0];
  const preferences = preferenceRows[0];
  const activeSearch = activeSearches[0];
  const hasResume = (resumeCount?.value ?? 0) > 0;
  const hasTarget = (targetCount?.value ?? 0) > 0 || Boolean(preferences?.targetTitlesJson.length);
  const aiReady = Boolean(settings?.aiEnabled);
  const steps = [
    { done: hasResume, href: hasResume ? "/resumes" : `/resumes/import?language=${locale}`, icon: FileText, title: pick(locale, "建立事实简历", "Create your factual resume"), body: pick(locale, "导入 PDF / DOCX / TXT，或在线新建；原件和每次修改都保留。", "Import PDF, DOCX, or TXT, or build one online. Originals and every revision are preserved.") },
    { done: hasTarget, href: "/preferences", icon: Settings2, title: pick(locale, "设置一个明确目标", "Set one clear target"), body: pick(locale, "岗位、职级、地点和签证条件组成一组，不会在不同目标间混用。", "Keep title, seniority, location, and authorization together as one target.") },
    { done: aiReady, optional: true, href: "/settings", icon: Sparkles, title: pick(locale, "连接 AI（可选）", "Connect AI (optional)"), body: pick(locale, "使用自己的 API Key；可设模型策略和每日 token 上限。", "Use your own API key and set a model strategy and daily token cap.") },
    { done: Boolean(activeSearch) || (applicationCount?.value ?? 0) > 0, href: hasTarget && aiReady ? "/automation" : "/jobs/new", icon: Compass, title: pick(locale, "发现或添加第一个岗位", "Find or add your first job"), body: pick(locale, "自动搜索公开岗位，或粘贴一个完整 JD；确认后再加入申请进度。", "Search public roles or paste a complete JD, then add it to the pipeline after review.") },
  ];
  const completed = steps.filter((step) => step.done || step.optional).length;
  const next = steps.find((step) => !step.done && !step.optional) ?? steps.find((step) => !step.done) ?? { href: "/pipeline", title: pick(locale, "继续管理申请", "Continue managing applications") };
  return (
    <div className="page-shell activation-page">
      <header className="activation-hero">
        <div><p className="eyebrow">JOB SEARCH WORKSPACE</p><h1>{pick(locale, "先完成一次真实求职闭环", "Complete one real job-search loop")}</h1><p>{pick(locale, "JobPilot 的核心路径是：可信简历 → 明确目标 → 岗位判断 → 人工确认材料 → 申请跟进。AI 只在需要判断和改写时介入。", "JobPilot’s core path is: factual resume → clear target → role assessment → human-approved materials → application follow-up. AI only assists where judgment or rewriting helps.")}</p></div>
        <div className="activation-progress"><strong>{completed}/{steps.length}</strong><span>{pick(locale, "启动项已就绪", "setup items ready")}</span></div>
      </header>
      <section className="activation-steps" aria-label={pick(locale, "启动清单", "Activation checklist")}>
        {steps.map(({ done, optional, href, icon: Icon, title, body }, index) => <Link className={`activation-step ${done ? "done" : ""}`} href={href} key={title}>
          <span className="activation-step-number">{done ? <CheckCircle2 size={20} /> : index + 1}</span>
          <span className="activation-step-icon"><Icon size={19} /></span>
          <span><strong>{title}</strong>{optional ? <small>{pick(locale, "可跳过", "Optional")}</small> : null}<p>{body}</p></span>
          <ArrowRight size={17} />
        </Link>)}
      </section>
      <section className="activation-next"><div><p className="eyebrow">NEXT BEST ACTION</p><h2>{next.title}</h2></div><Link className="button button-primary" href={next.href}>{pick(locale, "继续", "Continue")}<ArrowRight size={16} /></Link></section>
      {(applicationCount?.value ?? 0) > 0 ? <Link className="activation-pipeline-link" href="/pipeline"><Gauge size={18} /><span><strong>{applicationCount?.value}</strong>{pick(locale, "个申请正在进度中", "applications in your pipeline")}</span><ArrowRight size={16} /></Link> : null}
    </div>
  );
}
