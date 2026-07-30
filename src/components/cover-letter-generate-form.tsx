"use client";

import { useFormStatus } from "react-dom";
import { FilePenLine, LoaderCircle } from "lucide-react";
import { generateCoverLetter } from "@/app/jobs/[id]/cover-letter-actions";
import type { Locale } from "@/lib/i18n";

function GenerateButton({ disabled, locale }: { disabled: boolean; locale: Locale }) {
  const { pending } = useFormStatus();
  return <details className="generation-menu" onClick={(event) => { if (disabled || pending) event.preventDefault(); }}>
    <summary aria-disabled={disabled || pending}>{pending ? <LoaderCircle className="spin" size={17} /> : <FilePenLine size={17} />}{pending ? (locale === "zh" ? "生成中…" : "Generating…") : (locale === "zh" ? "生成求职信" : "Generate cover letter")}</summary>
    <div>
      <button name="outputLanguage" type="submit" value="zh">{locale === "zh" ? "中文版" : "Chinese"}</button>
      <button name="outputLanguage" type="submit" value="en">{locale === "zh" ? "英文版" : "English"}</button>
    </div>
  </details>;
}

export function CoverLetterGenerateForm({ jobId, locale, enabled }: { jobId: string; locale: Locale; enabled: boolean }) {
  return <form action={generateCoverLetter} className="cover-letter-generate-form"><input name="jobId" type="hidden" value={jobId} /><select aria-label={locale === "zh" ? "求职信语气" : "Cover letter tone"} defaultValue="professional" name="tone"><option value="professional">{locale === "zh" ? "专业" : "Professional"}</option><option value="concise">{locale === "zh" ? "简洁" : "Concise"}</option><option value="warm">{locale === "zh" ? "自然亲切" : "Warm"}</option></select><GenerateButton disabled={!enabled} locale={locale} /></form>;
}
