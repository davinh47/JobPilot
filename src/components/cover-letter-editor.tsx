"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Download, FileText, Save } from "lucide-react";
import { confirmCoverLetter, saveCoverLetter, type MaterialFormState } from "@/app/materials/actions";
import { cleanCoverLetterContent, coverLetterParagraphs, coverLetterSenderLines, type CoverLetterDocumentMeta } from "@/lib/cover-letter-format";
import type { Locale } from "@/lib/i18n";

const initialState: MaterialFormState = {};

export function CoverLetterEditor({ materialId, locale, initialTitle, initialContent, ready, documentMeta }: { materialId: string; locale: Locale; initialTitle: string; initialContent: string; ready: boolean; documentMeta: CoverLetterDocumentMeta }) {
  const [state, action, pending] = useActionState(saveCoverLetter, initialState);
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  return <div className="cover-letter-workspace">
    <section className="cover-letter-editor-panel">
      <form action={action} className="cover-letter-edit-form"><input name="materialId" type="hidden" value={materialId} /><input name="locale" type="hidden" value={locale} /><label>{text("材料名称", "Material name")}<input name="title" onChange={(event) => setTitle(event.target.value)} value={title} /></label><label>{text("正文", "Letter content")}<textarea name="content" onChange={(event) => setContent(event.target.value)} rows={28} value={content} /></label>{state.error ? <p className="form-error">{state.error}</p> : null}{state.success ? <p className="form-success">{state.success}</p> : null}<div className="cover-letter-editor-actions"><button className="button button-primary" disabled={pending}><Save size={16} />{pending ? text("保存中…", "Saving…") : text("保存草稿", "Save draft")}</button></div></form>
      <div className="cover-letter-secondary-actions"><details className="export-menu"><summary className="button button-secondary"><Download size={16} />{text("导出", "Export")}</summary><div className="export-popover"><a href={`/materials/${materialId}/export?format=docx`}><FileText size={15} /><span><strong>Word</strong><small>DOCX</small></span></a><a href={`/materials/${materialId}/export?format=pdf`}><FileText size={15} /><span><strong>PDF</strong><small>PDF</small></span></a><a href={`/materials/${materialId}/export?format=txt`}><FileText size={15} /><span><strong>{text("纯文本", "Plain text")}</strong><small>TXT</small></span></a></div></details><form action={confirmCoverLetter}><input name="materialId" type="hidden" value={materialId} /><button className="button button-secondary" disabled={ready}><CheckCircle2 size={16} />{ready ? text("检查完成", "Review complete") : text("检查完成并标记就绪", "Mark review complete")}</button></form></div>
    </section>
    <section className="cover-letter-preview-panel"><div className="cover-letter-paper" aria-label={text("求职信预览", "Cover letter preview")}><header className="cover-letter-letterhead"><div className="cover-letter-letterhead-identity">{coverLetterSenderLines(documentMeta).map((line, index) => <span className={index === 0 ? "cover-letter-sender-name" : undefined} key={`${index}-${line}`}>{line}</span>)}</div></header><div className="cover-letter-body">{coverLetterParagraphs(cleanCoverLetterContent(content, documentMeta)).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></div></section>
  </div>;
}
