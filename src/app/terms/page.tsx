import { getLocale, pick } from "@/lib/i18n";

export default async function TermsPage() {
  const locale = await getLocale();
  return <main className="legal-page"><a href="/login">← JobPilot</a><h1>{pick(locale, "使用条款", "Terms of use")}</h1><p>{pick(locale, "JobPilot 提供求职整理和 AI 辅助功能，不保证岗位有效、录用结果或 AI 内容完全准确。提交材料前请检查所有事实、日期、数字和联系方式。", "JobPilot provides job-search organization and AI assistance. It does not guarantee listing availability, hiring outcomes, or complete accuracy of AI output. Review all facts, dates, numbers, and contact details before submitting materials.")}</p><p>{pick(locale, "用户不得利用服务进行未经授权的访问、批量滥用招聘网站或违反第三方平台条款的自动化。", "Users may not use the service for unauthorized access, abusive scraping, or automation that violates third-party platform terms.")}</p></main>;
}
