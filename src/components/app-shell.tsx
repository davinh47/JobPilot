"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, BriefcaseBusiness, Cloud, Compass, FileText, Gauge, GitFork, Languages, LogOut, Menu, MessageCircleMore, Rss, Settings, Sparkles, UserRound, X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { BackgroundJobRunner } from "@/components/background-job-runner";
import { OnboardingTour } from "@/components/onboarding-tour";
import { NotificationWatcher } from "@/components/notification-watcher";
import { setLocalePreference } from "@/app/locale-actions";
import { signOut } from "@/app/auth/actions";

const JobPilotAssistant = dynamic(
  () => import("@/components/jobpilot-assistant").then((module) => module.JobPilotAssistant),
  { ssr: false },
);

export function AppShell({ children, locale, cloud = false, userEmail = null }: { children: React.ReactNode; locale: Locale; cloud?: boolean; userEmail?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [languagePending, startLanguageTransition] = useTransition();
  const [liveUnreadCount, setLiveUnreadCount] = useState(0);
  const [assistantRequested, setAssistantRequested] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const githubUrl = process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/davinh47/JobPilot";
  const navigation = [
    { href: "/matches", label: locale === "zh" ? "岗位发现" : "Job discovery", icon: Compass, tour: "nav-discovery" },
    { href: "/pipeline", label: locale === "zh" ? "申请进度" : "Pipeline", icon: Gauge, tour: "nav-pipeline" },
    { href: "/resumes", label: locale === "zh" ? "简历工作室" : "Resume studio", icon: FileText, tour: "nav-resumes" },
    { href: "/interviews", label: locale === "zh" ? "面试中心" : "Interview center", icon: Sparkles, tour: "nav-interviews" },
  ];
  const secondaryNavigation = [
    { href: "/automation", label: locale === "zh" ? "岗位来源与自动化" : "Sources & automation", icon: Rss },
    { href: "/notifications", label: locale === "zh" ? "通知" : "Notifications", icon: Bell, notification: true },
    { href: "/profile", label: locale === "zh" ? "个人档案" : "Profile", icon: UserRound },
    { href: "/settings", label: locale === "zh" ? "设置" : "Settings", icon: Settings },
  ];
  const secondaryRouteActive = secondaryNavigation.some(({ href }) => pathname.startsWith(href));
  const switchLanguage = () => {
    startLanguageTransition(async () => {
      await setLocalePreference(locale === "zh" ? "en" : "zh");
      router.refresh();
    });
  };
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand" href="/" prefetch={false} aria-label="JobPilot 首页">
          <span className="brand-mark"><BriefcaseBusiness size={18} /></span>
          <span>JobPilot</span>
        </Link>

        <nav className="primary-nav" aria-label={locale === "zh" ? "主要导航" : "Primary navigation"}>
          <p className="nav-caption">{locale === "zh" ? "工作台" : "WORKSPACE"}</p>
          {navigation.map(({ href, label, icon: Icon, tour }) => (
            <Link aria-label={label} className={`nav-item ${pathname.startsWith(href) ? "active" : ""}`} data-tour={tour} href={href} key={href} prefetch={false}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <button aria-expanded={mobileMenuOpen} aria-label={locale === "zh" ? "更多导航" : "More navigation"} className={`mobile-menu-toggle ${secondaryRouteActive ? "active" : ""}`} onClick={() => setMobileMenuOpen((open) => !open)} type="button">{mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}</button>

        {mobileMenuOpen ? <div className="mobile-nav-layer"><button aria-label={locale === "zh" ? "关闭导航" : "Close navigation"} className="mobile-nav-backdrop" onClick={() => setMobileMenuOpen(false)} type="button" /><section aria-label={locale === "zh" ? "更多导航" : "More navigation"} className="mobile-nav-menu"><header><div><p>{locale === "zh" ? "更多" : "MORE"}</p><strong>{locale === "zh" ? "账户与工具" : "Account & tools"}</strong></div><button aria-label={locale === "zh" ? "关闭导航" : "Close navigation"} onClick={() => setMobileMenuOpen(false)} type="button"><X size={18} /></button></header><nav>{secondaryNavigation.map(({ href, label, icon: Icon, notification }) => <Link aria-current={pathname.startsWith(href) ? "page" : undefined} className={`nav-item ${pathname.startsWith(href) ? "active" : ""}`} href={href} key={href} onClick={() => setMobileMenuOpen(false)} prefetch={false}><Icon size={18} /><span>{label}</span>{notification && liveUnreadCount > 0 ? <b>{Math.min(liveUnreadCount, 99)}</b> : null}</Link>)}<button className="nav-item mobile-nav-language" disabled={languagePending} onClick={() => { setMobileMenuOpen(false); switchLanguage(); }} type="button"><Languages size={18} /><span>{locale === "zh" ? "Switch to English" : "切换到中文"}</span></button>{cloud ? <><div className="mobile-account-state" title={userEmail ?? undefined}><Cloud size={15} /><span><strong>{locale === "zh" ? "私有云账户" : "Private cloud account"}</strong>{userEmail ? <small>{userEmail}</small> : null}</span></div><form action={signOut}><button className="nav-item mobile-sign-out" type="submit"><LogOut size={18} /><span>{locale === "zh" ? "退出登录" : "Sign out"}</span></button></form></> : <div className="mobile-account-state"><span className="status-dot" /><span><strong>{locale === "zh" ? "数据保存在本机" : "Stored on this device"}</strong></span></div>}</nav></section></div> : null}

        <div className="sidebar-footer">
          <Link className="nav-item" href="/automation" prefetch={false}><Rss size={18} /><span>{locale === "zh" ? "岗位来源与自动化" : "Sources & automation"}</span></Link>
          <Link className="nav-item notification-nav" href="/notifications" prefetch={false}><Bell size={18} /><span>{locale === "zh" ? "通知" : "Notifications"}</span>{liveUnreadCount > 0 ? <b>{Math.min(liveUnreadCount, 99)}</b> : null}</Link>
          <Link className="nav-item" href="/profile" prefetch={false}><UserRound size={18} /><span>{locale === "zh" ? "个人档案" : "Profile"}</span></Link>
          <Link className="nav-item" href="/settings" prefetch={false}><Settings size={18} /><span>{locale === "zh" ? "设置" : "Settings"}</span></Link>
          <button className="nav-item language-switch" disabled={languagePending} onClick={switchLanguage} type="button"><Languages size={18} /><span>{locale === "zh" ? "English" : "中文"}</span></button>
          {cloud ? <><div className="local-badge cloud-badge" title={userEmail ?? undefined}><Cloud size={13} />{locale === "zh" ? "私有云账户" : "Private cloud account"}</div><form action={signOut}><button className="nav-item sign-out-button" type="submit"><LogOut size={18} /><span>{locale === "zh" ? "退出登录" : "Sign out"}</span></button></form></> : <div className="local-badge"><span className="status-dot" />{locale === "zh" ? "数据保存在本机" : "Stored on this device"}</div>}
        </div>
      </aside>
      <main className="main-content">
        <div className="main-view">{children}</div>
        <footer className="site-footer">
          <span>© {new Date().getFullYear()} JobPilot</span>
          <span aria-hidden="true">·</span>
          <a href={`${githubUrl}/blob/main/LICENSE`} rel="noreferrer" target="_blank">MIT License</a>
          <span aria-hidden="true">·</span>
          <a href={githubUrl} rel="noreferrer" target="_blank"><GitFork size={14} />{locale === "zh" ? "开源版本" : "Open-source edition"}</a>
        </footer>
      </main>
      <NotificationWatcher locale={locale} onCountChange={setLiveUnreadCount} />
      {cloud ? <BackgroundJobRunner /> : null}
      {assistantRequested
        ? <JobPilotAssistant initialOpen locale={locale} />
        : <button aria-label={locale === "zh" ? "打开 JobPilot 助手" : "Open JobPilot Assistant"} className="assistant-launcher" data-tour="assistant-launcher" onClick={() => setAssistantRequested(true)} title={locale === "zh" ? "JobPilot 助手" : "JobPilot Assistant"} type="button"><MessageCircleMore size={22} /></button>}
      <OnboardingTour locale={locale} />
    </div>
  );
}
