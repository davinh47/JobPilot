import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { AddJobForm } from "@/components/add-job-form";
import { SmartUrlImportForm } from "@/components/smart-url-import-form";
import { getLocale, pick } from "@/lib/i18n";

export default async function NewJobPage() {
  const locale = await getLocale();
  return (
    <div className="page-shell narrow-page">
      <Link className="back-link" href="/matches"><ChevronLeft size={16} />{pick(locale, "返回岗位发现", "Back to discovery")}</Link>
      <header className="page-header compact-header">
        <div><p className="eyebrow">SMART INTAKE</p><h1>{pick(locale, "导入岗位", "Import a job")}</h1><p className="page-description">{pick(locale, "先尝试读取岗位网址；登录后才能看到的页面可使用 Chrome 一键保存。", "Start with the job URL. Use the Chrome one-click saver for pages that require sign-in.")}</p></div>
      </header>
      <div className="form-surface">
        <div className="trust-note"><ShieldCheck size={18} /><span><strong>{pick(locale, "JD 会被当作不可信输入。", "Job descriptions are treated as untrusted input.")}</strong>{pick(locale, "其中的指令不会被执行，只会用于岗位分析。", "Instructions inside them are never executed and are only used for analysis.")}</span></div>
        <SmartUrlImportForm locale={locale} />
        <div className="form-divider"><span>{pick(locale, "或手动填写", "or enter manually")}</span></div>
        <AddJobForm locale={locale} />
      </div>
    </div>
  );
}
