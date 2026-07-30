import Link from "next/link";
import { ChevronLeft, Download, Puzzle, ShieldCheck } from "lucide-react";
import { ExtensionPairingPanel } from "@/components/extension-pairing-panel";
import { getLocale, pick } from "@/lib/i18n";
import { getOrCreateExtensionPairingToken } from "@/lib/secrets";
import { isCloudDeployment } from "@/lib/deployment";
import { rotateExtensionPairingTokenAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ExtensionPage() {
  const [locale, token] = await Promise.all([getLocale(), getOrCreateExtensionPairingToken()]);
  return <div className="page-shell narrow-page"><Link className="back-link" href="/settings"><ChevronLeft size={16} />{pick(locale, "返回设置", "Back to Settings")}</Link><header className="page-header compact-header"><div><p className="eyebrow">CHROME EXTENSION</p><h1>{pick(locale, "一键保存岗位", "One-click job saver")}</h1><p className="page-description">{pick(locale, "在登录后的 LinkedIn、SEEK 或其他岗位详情页直接保存当前岗位。", "Save the current role directly from signed-in LinkedIn, SEEK, or other job detail pages.")}</p></div><a className="button button-primary" download href="/downloads/jobpilot-chrome-extension.zip"><Download size={16} />{pick(locale, "下载扩展", "Download extension")}</a></header><section className="extension-setup"><div className="extension-step"><span>01</span><div><h2>{pick(locale, "加载扩展", "Load extension")}</h2><p>{pick(locale, "解压下载文件，在 Chrome 扩展管理页开启开发者模式并选择“加载已解压的扩展程序”。", "Unzip the download, enable Developer mode on Chrome's Extensions page, and choose Load unpacked.")}</p></div><Puzzle size={20} /></div><div className="extension-step"><span>02</span><div><h2>{pick(locale, "账户配对", "Pair your account")}</h2><p>{pick(locale, "复制令牌，在扩展弹窗中粘贴一次。之后只需点击“Save to JobPilot”。", "Paste this token into the extension popup once. After that, use Save to JobPilot.")}</p><ExtensionPairingPanel locale={locale} token={token} /><form action={rotateExtensionPairingTokenAction}><button className="button button-ghost" type="submit">{pick(locale, "撤销并生成新令牌", "Revoke and create a new token")}</button></form></div><ShieldCheck size={20} /></div></section><p className="privacy-boundary"><ShieldCheck size={16} />{pick(locale, isCloudDeployment ? "令牌只对应当前账户；只有你主动点击保存时，扩展才读取并发送当前页面。" : "令牌和抓取内容只发送到本机 JobPilot。只有你主动点击保存时，扩展才读取当前页面。", isCloudDeployment ? "The token belongs only to your account. The extension reads and sends the current page only when you click Save." : "The token and captured content are sent only to local JobPilot. The extension reads a page only when you click Save.")}</p></div>;
}
