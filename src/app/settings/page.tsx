import { eq } from "drizzle-orm";
import Link from "next/link";
import { CircleHelp, Download, Laptop, Puzzle, Rss, ShieldCheck, UserX } from "lucide-react";
import { AiSettingsForm } from "@/components/ai-settings-form";
import { ReplayOnboardingButton } from "@/components/onboarding-tour";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { isCloudDeployment } from "@/lib/deployment";
import { deleteCloudAccount } from "@/app/account/actions";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { appSettings } from "@/db/schema";
import { getLocale, pick } from "@/lib/i18n";
import { readLocalSecrets } from "@/lib/secrets";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const locale = await getLocale();
  const user = await getCurrentUser();
  const [settings, secrets] = await Promise.all([
    user ? db.select({
      aiEnabled: appSettings.aiEnabled,
      aiProvider: appSettings.aiProvider,
      aiModel: appSettings.aiModel,
      aiModelStrategy: appSettings.aiModelStrategy,
    }).from(appSettings).where(eq(appSettings.userId, user.id)).get() : undefined,
    readLocalSecrets(user?.id),
  ]);
  const deepseekKeyConfigured = Boolean(secrets.deepseekApiKey);
  const openaiKeyConfigured = Boolean(secrets.openaiApiKey);
  return (
    <div className="page-shell narrow-page">
      <header className="page-header"><div><p className="eyebrow">SETTINGS</p><h1>{pick(locale, "设置", "Settings")}</h1><p className="page-description">{pick(locale, "管理 AI 辅助、语言、隐私和自动化边界。", "Manage AI assistance, language, privacy, and automation boundaries.")}</p></div></header>
      <div className="settings-stack">
        <AiSettingsForm cloudDeployment={isCloudDeployment} deepseekKeyConfigured={deepseekKeyConfigured} enabled={settings?.aiEnabled ?? false} locale={locale} model={settings?.aiModel ?? "deepseek-v4-flash"} modelStrategy={settings?.aiModelStrategy ?? "balanced"} openaiKeyConfigured={openaiKeyConfigured} provider={settings?.aiProvider ?? "deepseek"} />
        <div className="settings-list"><section><span className="settings-icon"><Download size={19} /></span><div><h2>{pick(locale, "导出我的数据", "Export my data")}</h2><p>{pick(locale, "下载结构化 JSON 备份；API Key、配对 token、速率限制和派生搜索索引不会导出。", "Download a structured JSON backup. API keys, pairing tokens, rate limits, and derived search indexes are excluded.")}</p></div><a className="button button-secondary compact-button" href="/api/account/export">{pick(locale, "下载 JSON", "Download JSON")}</a></section><section><span className="settings-icon"><CircleHelp size={19} /></span><div><h2>{pick(locale, "界面操作引导", "Interface tour")}</h2><p>{pick(locale, "在真实页面上逐步介绍岗位发现、申请进度、简历、AI 设置、助手和 Chrome 扩展。", "Walk through job discovery, the pipeline, resumes, AI settings, the assistant, and the Chrome extension directly in the interface.")}</p></div><ReplayOnboardingButton locale={locale} /></section><section><span className="settings-icon"><Laptop size={19} /></span><div><h2>{pick(locale, isCloudDeployment ? "账户数据" : "本地数据", isCloudDeployment ? "Account data" : "Local data")}</h2><p>{pick(locale, isCloudDeployment ? "简历和申请数据按账户隔离；API Key 加密保存。" : "SQLite 数据库、原始材料和 API Key 保存在当前设备。", isCloudDeployment ? "Resume and application data is isolated by account; API keys are stored encrypted." : "The SQLite database, source materials, and API key stay on this device.")}</p></div><span className="status-pill status-active">{pick(locale, "已启用", "Enabled")}</span></section><section data-tour="chrome-extension"><span className="settings-icon"><Puzzle size={19} /></span><div><h2>{pick(locale, "Chrome 一键保存", "Chrome one-click saver")}</h2><p>{pick(locale, "保存登录后才能访问的岗位详情页。", "Save job detail pages that require a signed-in browser.")}</p></div><Link className="button button-secondary compact-button" href="/extension">{pick(locale, "安装与配对", "Install & pair")}</Link></section><section><span className="settings-icon"><Rss size={19} /></span><div><h2>{pick(locale, "岗位源与 Worker", "Sources & worker")}</h2><p>{pick(locale, "管理公开 ATS 来源、同步任务与应用内通知。", "Manage public ATS sources, sync jobs, and in-app notifications.")}</p></div><Link className="button button-secondary compact-button" href="/automation">{pick(locale, "管理", "Manage")}</Link></section><section><span className="settings-icon"><ShieldCheck size={19} /></span><div><h2>{pick(locale, "自动化边界", "Automation boundary")}</h2><p>{pick(locale, "不会自动提交申请或发送邮件。", "JobPilot never submits applications or sends email automatically.")}</p></div><span className="status-pill status-active">{pick(locale, "受保护", "Protected")}</span></section>{isCloudDeployment ? <section><span className="settings-icon"><UserX size={19} /></span><div><h2>{pick(locale, "删除账户", "Delete account")}</h2><p>{pick(locale, "永久删除账户、简历原件、申请记录和已保存的 API Key。", "Permanently delete the account, resume originals, application history, and saved API keys.")}</p></div><form><ConfirmDeleteButton cancelLabel={pick(locale, "取消", "Cancel")} confirmAction={deleteCloudAccount} confirmLabel={pick(locale, "永久删除", "Delete permanently")} description={pick(locale, "这项操作无法撤销。所有云端数据都会永久删除。", "This cannot be undone. All cloud data will be permanently deleted.")} title={pick(locale, "删除 JobPilot 账户？", "Delete your JobPilot account?")} triggerLabel={pick(locale, "删除账户", "Delete account")} triggerStyle="delete-button" /></form></section> : null}</div>
      </div>
    </div>
  );
}
