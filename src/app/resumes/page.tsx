import Link from "next/link";
import { redirect } from "next/navigation";
import { FilePlus2, PenLine, Upload } from "lucide-react";
import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { queryBatch } from "@/db/batch";
import { appSettings, backgroundJobs, candidateProfiles, resumes, resumeVersions } from "@/db/schema";
import { ResumeLanguageRow, type ResumeLanguageVariant } from "@/components/resume-language-row";
import { formatLocaleDate, getLocale, pick } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/current-user";
import { readLocalSecrets } from "@/lib/secrets";
import { ensureResumeLanguageGroups } from "@/lib/resume-language-groups";

export const dynamic = "force-dynamic";

export default async function ResumesPage() {
  const locale = await getLocale();
  const user = await getCurrentUser();
  const [batched, secrets] = user ? await Promise.all([
    queryBatch([
      db.select().from(resumes).where(eq(resumes.userId, user.id)).orderBy(desc(resumes.updatedAt)),
      db.select().from(appSettings).where(eq(appSettings.userId, user.id)).limit(1),
      db.select().from(backgroundJobs).where(and(eq(backgroundJobs.userId, user.id), eq(backgroundJobs.jobType, "resume_translate"), or(eq(backgroundJobs.status, "queued"), eq(backgroundJobs.status, "running")))),
      db.select({ resumeId: resumes.id, versionType: resumeVersions.versionType })
        .from(resumes)
        .leftJoin(resumeVersions, eq(resumes.currentVersionId, resumeVersions.id))
        .where(eq(resumes.userId, user.id)),
      db.select({ analyzedAt: candidateProfiles.analyzedAt, profileJson: candidateProfiles.profileJson })
        .from(candidateProfiles)
        .where(eq(candidateProfiles.userId, user.id))
        .limit(1),
    ]),
    readLocalSecrets(user.id),
  ]) : [[[], [], [], [], []], {}];
  const [items, settingsRows, activeTranslations, versionRows, profileRows] = batched;
  if (user && items.some((resume) => !resume.language || !resume.resumeGroupId)) {
    await ensureResumeLanguageGroups(user.id);
    redirect("/resumes");
  }
  const settings = settingsRows[0];
  const aiReady = Boolean(settings?.aiEnabled && (
    settings.aiProvider === "openai" ? secrets.openaiApiKey : secrets.deepseekApiKey
  ));
  const profileAnalyzed = Boolean(profileRows[0]?.analyzedAt && profileRows[0]?.profileJson);
  const currentVersionTypes = new Map<string, (typeof versionRows)[number]["versionType"]>();
  for (const row of versionRows) {
    if (!currentVersionTypes.has(row.resumeId)) currentVersionTypes.set(row.resumeId, row.versionType);
  }
  const grouped = Array.from(items.reduce((groups, resume) => {
    const groupId = resume.resumeGroupId || resume.id;
    const current = groups.get(groupId) ?? [];
    current.push(resume);
    groups.set(groupId, current);
    return groups;
  }, new Map<string, typeof items>()).entries()).sort((left, right) => {
    const leftTime = Math.max(...left[1].map((resume) => resume.updatedAt.getTime()));
    const rightTime = Math.max(...right[1].map((resume) => resume.updatedAt.getTime()));
    return rightTime - leftTime;
  });
  return (
    <div className="page-shell resume-studio-page">
      <header className="page-header"><div><p className="eyebrow">RESUME STUDIO</p><h1>{pick(locale, "简历工作室", "Resume studio")}</h1><p className="page-description">{pick(locale, "导入已有简历，或在线填写信息建立新的基础简历；中英文版本可以配对切换并按需同步。", "Import an existing resume or build a new base resume online. Pair Chinese and English versions for switching and on-demand synchronization.")}</p></div><div className="header-actions" data-tour="resume-actions"><Link className="button button-secondary" href={`/resumes/import?language=${locale}`}><Upload size={16} />{pick(locale, "导入简历", "Import")}</Link><Link className="button button-primary" href={`/resumes/new?language=${locale}`}><PenLine size={16} />{pick(locale, "在线新建", "Create online")}</Link></div></header>
      {items.length === 0 ? (
        <section className="resume-start-options">
          <Link className="resume-option" href={`/resumes/import?language=${locale}`}><span className="empty-icon"><Upload size={23} /></span><div><h2>{pick(locale, "导入已有简历", "Import an existing resume")}</h2><p>{pick(locale, "支持 PDF、DOCX、TXT；原始文件会以不可变来源保存。", "Supports PDF, DOCX, and TXT. The original file is stored as an immutable source.")}</p></div></Link>
          <Link className="resume-option" href={`/resumes/new?language=${locale}`}><span className="empty-icon warm"><FilePlus2 size={23} /></span><div><h2>{pick(locale, "在线建立新简历", "Build a resume online")}</h2><p>{pick(locale, "填写基本信息、职业简介和经历，立即创建可编辑的基础版本。", "Enter your profile, summary, and experience to create an editable base version.")}</p></div></Link>
        </section>
      ) : (
        <section className="resume-list">
          {grouped.map(([groupId, groupItems]) => <ResumeLanguageRow
            allowLanguagePairing={groupItems.every((resume) => currentVersionTypes.get(resume.id) !== "tailored")}
            aiReady={aiReady}
            groupId={groupId}
            key={groupId}
            locale={locale}
            pendingLanguages={activeTranslations
              .filter((job) => job.payloadJson.userId === user?.id && groupItems.some((resume) => resume.id === job.payloadJson.resumeId))
              .map((job) => job.payloadJson.targetLanguage)
              .filter((language): language is "zh" | "en" => language === "zh" || language === "en")}
            profileAnalyzed={profileAnalyzed}
            variants={groupItems.map((resume): ResumeLanguageVariant => ({
              id: resume.id,
              title: resume.title,
              language: resume.language ?? "en",
              sourceType: resume.sourceType,
              isPrimary: resume.isPrimary,
              updatedLabel: formatLocaleDate(resume.updatedAt, locale),
            }))}
          />)}
          <div className="resume-list-actions"><Link className="button button-secondary" href={`/resumes/import?language=${locale}`}><Upload size={16} />{pick(locale, "继续导入", "Import another")}</Link><Link className="button button-primary" href={`/resumes/new?language=${locale}`}><PenLine size={16} />{pick(locale, "新建简历", "New resume")}</Link></div>
        </section>
      )}
    </div>
  );
}
