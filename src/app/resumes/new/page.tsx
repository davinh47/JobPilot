import Link from "next/link";
import { eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { ResumeEditor } from "@/components/resume-editor";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { getCurrentUser } from "@/lib/current-user";
import { getLocale, pick } from "@/lib/i18n";
import { createDefaultPlatformResume } from "@/lib/resume-format";
import { hasAiProviderKey } from "@/lib/secrets";

export const dynamic = "force-dynamic";

export default async function NewResumePage({ searchParams }: { searchParams: Promise<{ language?: string; group?: string }> }) {
  const [locale, user] = await Promise.all([getLocale(), getCurrentUser()]);
  const params = await searchParams;
  const resumeLanguage = params.language === "en" ? "en" : "zh";
  const resumeGroupId = /^[0-9a-f-]{36}$/i.test(params.group ?? "") ? params.group! : "";
  const settings = user ? await db.select().from(appSettings).where(eq(appSettings.userId, user.id)).get() : undefined;
  const aiEnabled = settings?.aiEnabled ? await hasAiProviderKey(settings.aiProvider, user?.id) : false;
  return <div className="page-shell editor-page"><Link className="back-link" href="/resumes"><ChevronLeft size={16} />{pick(locale, "返回简历工作室", "Back to resume studio")}</Link><header className="page-header compact-header"><div><p className="eyebrow">ONLINE EDITOR · {resumeLanguage === "zh" ? "中文" : "ENGLISH"}</p><h1>{pick(locale, resumeLanguage === "zh" ? "在线建立中文简历" : "在线建立英文简历", resumeLanguage === "zh" ? "Create a Chinese resume" : "Create an English resume")}</h1><p className="page-description">{pick(locale, "从结构化模块开始填写；所有栏目都可以添加经历、改名、调整分类或删除。", "Start with structured sections. Add entries, rename sections, change their type, or remove them as needed.")}</p></div><div aria-label={pick(locale, "简历语言", "Resume language")} className="segmented-control resume-create-language"><Link className={resumeLanguage === "zh" ? "active" : ""} href={`/resumes/new?language=zh${resumeGroupId ? `&group=${resumeGroupId}` : ""}`}>中文</Link><Link className={resumeLanguage === "en" ? "active" : ""} href={`/resumes/new?language=en${resumeGroupId ? `&group=${resumeGroupId}` : ""}`}>English</Link></div></header><ResumeEditor aiEnabled={aiEnabled} content={createDefaultPlatformResume(resumeLanguage)} jobs={[]} locale={locale} mode="create" resumeGroupId={resumeGroupId} resumeLanguage={resumeLanguage} title="" /></div>;
}
