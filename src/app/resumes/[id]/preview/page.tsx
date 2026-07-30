import Link from "next/link";
import { ArrowLeft, PenLine } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ResumePreview } from "@/components/resume-preview";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { getLocale, pick } from "@/lib/i18n";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function ResumePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [locale, user] = await Promise.all([getLocale(), getCurrentUser()]);
  const resume = user ? await db.select().from(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, user.id))).get() : undefined;
  if (!resume) notFound();
  return (
    <div className="page-shell preview-page">
      <Link className="back-link" href="/resumes"><ArrowLeft size={16} />{pick(locale, "返回简历工作室", "Back to resume studio")}</Link>
      <header className="page-header"><div><p className="eyebrow">RESUME PREVIEW</p><h1>{resume.title}</h1><p className="page-description">{pick(locale, "原版保留上传文件的视觉格式；其他模板使用可编辑的 JobPilot 内容重新排版。", "Original preserves the uploaded file's visual format; other templates lay out the editable JobPilot content.")}</p></div><Link className="button button-secondary" href={`/resumes/${id}/edit`}><PenLine size={16} />{pick(locale, "编辑内容", "Edit content")}</Link></header>
      <ResumePreview hasOriginal={Boolean(resume.originalStoragePath)} locale={locale} originalType={resume.sourceType} resumeId={id} />
    </div>
  );
}
