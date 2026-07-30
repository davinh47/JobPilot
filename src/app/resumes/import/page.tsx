import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { ImportResumeForm } from "@/components/resume-forms";
import { getLocale, pick } from "@/lib/i18n";

export default async function ImportResumePage({ searchParams }: { searchParams: Promise<{ language?: string; group?: string }> }) {
  const locale = await getLocale();
  const params = await searchParams;
  const resumeLanguage = params.language === "en" ? "en" : "zh";
  const resumeGroupId = /^[0-9a-f-]{36}$/i.test(params.group ?? "") ? params.group! : "";
  return <div className="page-shell narrow-page"><Link className="back-link" href="/resumes"><ChevronLeft size={16} />{pick(locale, "返回简历工作室", "Back to resume studio")}</Link><header className="page-header compact-header"><div><p className="eyebrow">IMMUTABLE SOURCE · {resumeLanguage === "zh" ? "中文" : "ENGLISH"}</p><h1>{pick(locale, resumeLanguage === "zh" ? "导入中文简历" : "导入英文简历", resumeLanguage === "zh" ? "Import a Chinese resume" : "Import an English resume")}</h1><p className="page-description">{pick(locale, "上传 PDF、DOCX 或 TXT 简历，然后检查和编辑提取的内容。", "Upload a PDF, DOCX, or TXT resume, then review and edit the extracted content.")}</p></div><div aria-label={pick(locale, "简历语言", "Resume language")} className="segmented-control resume-create-language"><Link className={resumeLanguage === "zh" ? "active" : ""} href={`/resumes/import?language=zh${resumeGroupId ? `&group=${resumeGroupId}` : ""}`}>中文</Link><Link className={resumeLanguage === "en" ? "active" : ""} href={`/resumes/import?language=en${resumeGroupId ? `&group=${resumeGroupId}` : ""}`}>English</Link></div></header><div className="form-surface"><div className="trust-note"><ShieldCheck size={18} /><span><strong>{pick(locale, "原始文件会保留。", "Your original file is preserved.")}</strong></span></div><ImportResumeForm locale={locale} resumeGroupId={resumeGroupId} resumeLanguage={resumeLanguage} /></div></div>;
}
