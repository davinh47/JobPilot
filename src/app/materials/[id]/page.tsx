import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileText, ShieldCheck } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { CoverLetterEditor } from "@/components/cover-letter-editor";
import { db } from "@/db";
import { applications, candidateProfiles, jobs, materials, resumeVersions, resumes } from "@/db/schema";
import { coverLetterOutputLocale, createCoverLetterDocumentMeta } from "@/lib/cover-letter-format";
import { formatLocaleDate, getLocale, pick } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/current-user";
import { findResumeVersionForLanguage } from "@/lib/resume-version-language";
import { localeCompatibleFallback } from "@/lib/text-language";

export const dynamic = "force-dynamic";

export default async function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const locale = await getLocale();
  const user = await getCurrentUser();
  const row = user ? await db.select({ material: materials, application: applications, job: jobs }).from(materials).innerJoin(applications, eq(materials.applicationId, applications.id)).innerJoin(jobs, eq(applications.jobId, jobs.id)).where(and(eq(materials.id, id), eq(applications.userId, user.id), eq(jobs.ownerUserId, user.id))).get() : undefined;
  if (!row || row.material.materialType !== "cover_letter" || !row.material.contentText) notFound();
  const version = row.material.resumeVersionId ? await db.select().from(resumeVersions).where(eq(resumeVersions.id, row.material.resumeVersionId)).get() : undefined;
  const resume = version ? await db.select().from(resumes).where(eq(resumes.id, version.resumeId)).get() : undefined;
  const profile = await db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, row.application.userId)).get();
  const outputLocale = coverLetterOutputLocale(row.material.sourceRefsJson, row.material.contentText);
  const identitySource = await findResumeVersionForLanguage(row.application.userId, outputLocale, { preferredVersionId: version?.id, jobId: row.job.id });
  const evidence = row.material.sourceRefsJson.filter((source) => source.type === "resume_version" && source.quote);
  const missingInformation = row.material.sourceRefsJson.filter((source) => source.type === "missing_information");
  const documentMeta = createCoverLetterDocumentMeta(identitySource?.version.structuredContentJson ?? version?.structuredContentJson, row.job, new Date(), outputLocale, localeCompatibleFallback(profile?.currentLocation ?? "", outputLocale));
  return <div className="page-shell cover-letter-page"><Link className="back-link" href={`/jobs/${row.job.id}`}><ArrowLeft size={16} />{pick(locale, "返回岗位详情", "Back to job detail")}</Link><header className="page-header"><div><p className="eyebrow">COVER LETTER</p><h1>{row.material.title}</h1><p className="page-description">{row.job.companyName} · {row.job.title}</p></div><span className={`status-pill ${row.material.status === "ready" ? "status-active" : "status-possibly_expired"}`}>{row.material.status === "ready" ? pick(locale, "检查完成", "Review complete") : pick(locale, "需要人工复核", "Needs review")}</span></header><CoverLetterEditor documentMeta={documentMeta} initialContent={row.material.contentText} initialTitle={row.material.title} locale={locale} materialId={row.material.id} ready={row.material.status === "ready"} /><section className="cover-letter-provenance"><div className="section-heading"><div><p className="eyebrow">PROVENANCE</p><h2>{pick(locale, "内容来源与检查", "Content sources & review")}</h2></div></div><div className="provenance-summary"><span className="settings-icon"><ShieldCheck size={18} /></span><div><h3>{pick(locale, "AI 草稿以你的简历事实为准", "AI drafts follow your resume facts")}</h3><p>{pick(locale, `已根据 ${resume?.title ?? "简历"}${version ? ` v${version.versionNumber}` : ""} 检查经历陈述 · ${row.material.modelName ?? "DeepSeek"} · ${formatLocaleDate(row.material.createdAt, locale)}`, `Experience claims checked against ${resume?.title ?? "resume"}${version ? ` v${version.versionNumber}` : ""} · ${row.material.modelName ?? "DeepSeek"} · ${formatLocaleDate(row.material.createdAt, locale)}`)}</p></div></div><div className="cover-letter-evidence-list">{evidence.map((source, index) => <blockquote key={index}><FileText size={15} /><span>{source.quote}</span></blockquote>)}</div>{missingInformation.length ? <div className="cover-letter-missing"><strong>{pick(locale, "当前事实来源未提供的信息", "Information not provided by current sources")}</strong>{missingInformation.map((item, index) => <p key={index}>{item.quote}</p>)}</div> : null}<p className="provenance-note"><CheckCircle2 size={15} />{pick(locale, "简历中的内容已作为你的事实使用；提交前只需检查 AI 的表达、动机和上下文是否符合你的本意。编辑后状态会重新变为“需要复核”。", "Resume content is used as your factual source. Before submitting, review only whether the AI wording, motivation, and context reflect your intent. Any edit returns the material to Needs review.")}</p></section></div>;
}
