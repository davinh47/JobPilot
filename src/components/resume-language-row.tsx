"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Brain, Eye, FilePlus2, FileText, Languages, LoaderCircle, PenLine, Sparkles, Star, Upload } from "lucide-react";
import { deleteResume, setPrimaryResume } from "@/app/actions";
import { requestResumeTranslation } from "@/app/resumes/ai-actions";
import { analyzeProfileFromResumeAction } from "@/app/profile/actions";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { ResumeExportMenu } from "@/components/resume-export-menu";
import type { Locale } from "@/lib/i18n";

export type ResumeLanguageVariant = {
  id: string;
  title: string;
  language: "zh" | "en";
  sourceType: "pdf" | "docx" | "txt" | "editor";
  isPrimary: boolean;
  updatedLabel: string;
};

function GenerateProfileButton({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  return <button className="button button-secondary compact-button" disabled={pending} type="submit">{pending ? <LoaderCircle className="spin" size={15} /> : <Brain size={15} />}{pending ? text("正在生成…", "Generating…") : text("生成 AI 画像", "Generate AI profile")}</button>;
}

export function ResumeLanguageRow({
  locale,
  groupId,
  variants,
  allowLanguagePairing,
  aiReady,
  pendingLanguages,
  profileAnalyzed,
}: {
  locale: Locale;
  groupId: string;
  variants: ResumeLanguageVariant[];
  allowLanguagePairing: boolean;
  aiReady: boolean;
  pendingLanguages: Array<"zh" | "en">;
  profileAnalyzed: boolean;
}) {
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const byLanguage = useMemo(() => new Map(variants.map((variant) => [variant.language, variant])), [variants]);
  const preferred = byLanguage.get(locale) ?? variants.find((variant) => variant.isPrimary) ?? variants[0]!;
  const [selectedLanguage, setSelectedLanguage] = useState<"zh" | "en">(preferred.language);
  const selected = byLanguage.get(selectedLanguage) ?? preferred;
  const missingLanguage = selectedLanguage === "zh" ? "en" : "zh";
  const groupIsPrimary = variants.some((variant) => variant.isPrimary);
  const isTranslationPending = pendingLanguages.includes(missingLanguage);
  const languageName = (language: "zh" | "en") => language === "zh" ? "中文" : "English";

  return <article className="resume-row resume-language-row">
    <span className="resume-file-icon"><FileText size={20} /></span>
    <div className="resume-row-copy">
      <div className="resume-title-line"><h2>{selected.title}</h2><span className="resume-language-label">{selected.language === "zh" ? "中文" : "EN"}</span></div>
      <p>{selected.sourceType === "editor" ? text("在线创建", "Created online") : text(`已保留 ${selected.sourceType.toUpperCase()} 原件`, `${selected.sourceType.toUpperCase()} original preserved`)} · {text("当前编辑版", "Current editable copy")} · {selected.updatedLabel}</p>
    </div>
    <div className="resume-row-actions">
      {groupIsPrimary ? <span className="status-pill status-active">{text("基础简历", "Primary")}</span> : <form action={setPrimaryResume}><input name="resumeId" type="hidden" value={selected.id} /><button className="button button-secondary compact-button" title={text("设为基础简历", "Set as primary resume")}><Star size={15} />{text("设为基础", "Set primary")}</button></form>}
      {allowLanguagePairing || variants.length > 1 ? <div aria-label={text("简历语言版本", "Resume language version")} className="segmented-control resume-language-switch">
        {(["zh", "en"] as const).map((language) => <button
          className={selected.language === language ? "active" : ""}
          disabled={!byLanguage.has(language)}
          key={language}
          onClick={() => setSelectedLanguage(language)}
          title={byLanguage.has(language) ? text(`切换到${languageName(language)}版`, `Switch to ${languageName(language)} version`) : text(`尚未添加${languageName(language)}版`, `${languageName(language)} version is not available`)}
          type="button"
        >{language === "zh" ? "中" : "EN"}</button>)}
      </div> : <span className="resume-language-single">{selected.language === "zh" ? "中文" : "EN"}</span>}
      {allowLanguagePairing && !byLanguage.has(missingLanguage) ? <details className="resume-language-menu">
        <summary className="button button-secondary compact-button"><Languages size={15} />{text(`添加${languageName(missingLanguage)}版`, `Add ${languageName(missingLanguage)} version`)}</summary>
        <div className="resume-language-popover">
          <Link href={`/resumes/import?language=${missingLanguage}&group=${groupId}`}><Upload size={16} /><span><strong>{text("上传已有简历", "Upload existing resume")}</strong><small>PDF · DOCX · TXT</small></span></Link>
          <Link href={`/resumes/new?language=${missingLanguage}&group=${groupId}`}><FilePlus2 size={16} /><span><strong>{text("在线建立", "Create manually")}</strong><small>{text("从空白结构开始", "Start from structured fields")}</small></span></Link>
          {aiReady ? <form action={requestResumeTranslation}><input name="resumeId" type="hidden" value={selected.id} /><input name="targetLanguage" type="hidden" value={missingLanguage} /><button disabled={isTranslationPending}><span>{isTranslationPending ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}</span><span><strong>{isTranslationPending ? text("正在后台生成", "Generating in background") : text("AI 生成另一语言版", "Generate with AI")}</strong><small>{text("完成后通知并等待检查", "Review required before use")}</small></span></button></form> : <Link href="/settings"><Sparkles size={16} /><span><strong>{text("开启 AI 后生成", "Enable AI generation")}</strong><small>{text("前往 AI 设置", "Open AI settings")}</small></span></Link>}
        </div>
      </details> : null}
      <ResumeExportMenu compact locale={locale} originalType={selected.sourceType} resumeId={selected.id} />
      {groupIsPrimary
        ? profileAnalyzed
          ? <Link className="button button-secondary compact-button" href="/profile"><Brain size={15} />{text("查看 AI 画像", "View AI profile")}</Link>
          : aiReady
            ? <form action={analyzeProfileFromResumeAction}><GenerateProfileButton locale={locale} /></form>
            : <Link className="button button-secondary compact-button" href="/profile"><Brain size={15} />{text("AI 画像", "AI profile")}</Link>
        : null}
      <Link className="button button-secondary compact-button" href={`/resumes/${selected.id}/preview`}><Eye size={15} />{text("预览", "Preview")}</Link>
      <Link className="button button-secondary compact-button" href={`/resumes/${selected.id}/edit`}><PenLine size={15} />{text("编辑", "Edit")}</Link>
      <form action={deleteResume}><input name="resumeId" type="hidden" value={selected.id} /><ConfirmDeleteButton
        cancelLabel={text("取消", "Cancel")}
        confirmLabel={text("确认删除", "Delete resume")}
        description={text(`将删除“${selected.title}”的${languageName(selected.language)}当前编辑版${selected.sourceType === "editor" ? "" : "和上传原件"}。同组的另一语言版本不会被删除。${selected.isPrimary ? "系统会自动选择另一份基础简历，并清除旧的 AI 画像。" : ""}`, `This deletes the current ${languageName(selected.language)} editable copy${selected.sourceType === "editor" ? "" : " and uploaded original"} of “${selected.title}”. Its paired language version is not deleted.${selected.isPrimary ? " Another resume becomes primary and the old AI profile is cleared." : ""}`)}
        title={text("删除这个语言版本？", "Delete this language version?")}
        triggerLabel={text("删除简历", "Delete resume")}
      /></form>
    </div>
  </article>;
}
