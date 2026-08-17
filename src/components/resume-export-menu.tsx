import { Download, FileText } from "lucide-react";
import type { Locale } from "@/lib/i18n";

export function ResumeExportMenu({ locale, resumeId, compact = false, originalType }: { locale: Locale; resumeId: string; compact?: boolean; originalType?: string }) {
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const templates = [
    { id: "classic", zh: "经典", en: "Classic" },
    { id: "modern", zh: "现代", en: "Modern" },
    { id: "compact", zh: "紧凑", en: "Compact" },
  ];

  return (
    <details className={`export-menu${compact ? " export-menu-compact" : ""}`}>
      <summary className={compact ? "icon-link" : "button button-secondary"} title={text("导出简历", "Export resume")}>
        <Download size={16} />{compact ? null : text("导出", "Export")}
      </summary>
      <div className="export-popover">
        {originalType && originalType !== "editor" ? <><p>{text("上传原件", "Uploaded original")}</p><a href={`/resumes/${resumeId}/source`}><FileText size={15} /><span><strong>{text("原始格式", "Original format")}</strong><small>{originalType.toUpperCase()}</small></span></a></> : null}
        <p>{text("Word 模板", "Word templates")}</p>
        {templates.map((template) => <a href={`/resumes/${resumeId}/export?format=docx&template=${template.id}`} key={`docx-${template.id}`}><FileText size={15} /><span><strong>{locale === "zh" ? template.zh : template.en}</strong><small>DOCX</small></span></a>)}
        <p>{text("PDF 模板", "PDF templates")}</p>
        {templates.map((template) => <a href={`/resumes/${resumeId}/export?format=pdf&template=${template.id}`} key={`pdf-${template.id}`}><FileText size={15} /><span><strong>{locale === "zh" ? template.zh : template.en}</strong><small>PDF</small></span></a>)}
        <a className="export-text-link" href={`/resumes/${resumeId}/export?format=txt`}><FileText size={15} /><span><strong>{text("纯文本", "Plain text")}</strong><small>TXT</small></span></a>
      </div>
    </details>
  );
}
