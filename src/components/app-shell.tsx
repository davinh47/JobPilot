"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Bell, Cloud, Compass, FileText, Gauge, GitFork, Languages, LogOut, Menu, Rss, Settings, Sparkles, UserRound, X } from "lucide-react";
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
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
  const isActive = (href: string) => pathname.startsWith(href)
    || (href === "/matches" && (pathname.startsWith("/jobs") || pathname === "/preferences"))
    || (href === "/automation" && ["/search-plan", "/watch-rules", "/extension"].includes(pathname));
  const secondaryRouteActive = secondaryNavigation.some(({ href }) => isActive(href));
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const menuTrigger = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
      if (event.key !== "Tab") return;
      const items = menuRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)');
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
      menuTrigger?.focus();
    };
  }, [mobileMenuOpen]);
  const switchLanguage = () => {
    startLanguageTransition(async () => {
      await setLocalePreference(locale === "zh" ? "en" : "zh");
      router.refresh();
    });
  };
  return (
    <div className="app-frame">
      <a className="skip-link" href="#workspace-content">{locale === "zh" ? "跳至主要内容" : "Skip to content"}</a>
      <header className="workspace-header">
        <Link className="workspace-brand" href="/" prefetch={false} aria-label={locale === "zh" ? "JobPilot 首页" : "JobPilot home"}>
          JobPilot<ArrowUpRight size={27} strokeWidth={3} aria-hidden="true" />
        </Link>
        <nav className="workspace-nav" aria-label={locale === "zh" ? "主要导航" : "Primary navigation"}>
          {navigation.map(({ href, label, icon: Icon, tour }) => (
            <Link aria-current={isActive(href) ? "page" : undefined} aria-label={label} className={`workspace-nav-link ${isActive(href) ? "active" : ""}`} data-tour={tour} href={href} key={href} prefetch={false}>
              <Icon size={20} strokeWidth={1.8} /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="workspace-utilities">
          <Link className="workspace-notifications" href="/notifications" aria-label={locale === "zh" ? "通知" : "Notifications"} aria-current={isActive("/notifications") ? "page" : undefined} title={locale === "zh" ? "通知" : "Notifications"}><Bell size={21} />{liveUnreadCount > 0 ? <b>{Math.min(liveUnreadCount, 99)}</b> : null}</Link>
          <button className="workspace-language" aria-label={locale === "zh" ? "切换到英文" : "Switch to Chinese"} title={locale === "zh" ? "切换到英文" : "Switch to Chinese"} disabled={languagePending} onClick={switchLanguage} type="button"><Languages size={19} /></button>
          <button ref={menuButtonRef} aria-controls="mobile-navigation" aria-expanded={mobileMenuOpen} aria-label={locale === "zh" ? "更多导航" : "More navigation"} className={`workspace-more ${secondaryRouteActive ? "active" : ""}`} onClick={() => setMobileMenuOpen((open) => !open)} type="button"><span>{locale === "zh" ? "更多" : "More"}</span>{mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}</button>
          <Link className="workspace-settings" aria-label={locale === "zh" ? "设置" : "Settings"} aria-current={isActive("/settings") ? "page" : undefined} href="/settings"><Settings size={20} /><span>{locale === "zh" ? "设置" : "Settings"}</span></Link>
        </div>
        {mobileMenuOpen ? <div className="workspace-menu-layer"><button aria-label={locale === "zh" ? "关闭导航" : "Close navigation"} className="workspace-menu-backdrop" onClick={() => setMobileMenuOpen(false)} type="button" /><section ref={menuRef} id="mobile-navigation" aria-label={locale === "zh" ? "更多导航" : "More navigation"} className="workspace-menu"><header><strong>{locale === "zh" ? "账户与工具" : "Account & tools"}</strong><button aria-label={locale === "zh" ? "关闭导航" : "Close navigation"} onClick={() => setMobileMenuOpen(false)} type="button"><X size={20} /></button></header><nav>{secondaryNavigation.map(({ href, label, icon: Icon, notification }) => <Link aria-current={isActive(href) ? "page" : undefined} className={isActive(href) ? "active" : ""} href={href} key={href} onClick={() => setMobileMenuOpen(false)} prefetch={false}><Icon size={19} /><span>{label}</span>{notification && liveUnreadCount > 0 ? <b>{Math.min(liveUnreadCount, 99)}</b> : null}</Link>)}<button disabled={languagePending} onClick={() => { setMobileMenuOpen(false); switchLanguage(); }} type="button"><Languages size={19} /><span>{locale === "zh" ? "Switch to English" : "切换到中文"}</span></button>{cloud ? <><div className="workspace-account" title={userEmail ?? undefined}><Cloud size={15} /><span>{locale === "zh" ? "私有云账户" : "Private cloud account"}{userEmail ? <small>{userEmail}</small> : null}</span></div><form action={signOut}><button type="submit"><LogOut size={19} /><span>{locale === "zh" ? "退出登录" : "Sign out"}</span></button></form></> : <div className="workspace-account"><span className="status-dot" />{locale === "zh" ? "数据保存在本机" : "Stored on this device"}</div>}</nav></section></div> : null}
      </header>
      <main className="main-content" id="workspace-content" tabIndex={-1}>
        <div className="main-view">{children}</div>
        <footer className="site-footer">
          <span>© {new Date().getFullYear()} JobPilot</span><span className="workspace-storage">{cloud ? (locale === "zh" ? "私有云账户" : "Private cloud account") : (locale === "zh" ? "数据保存在本机" : "Stored on this device")}</span>
          <span aria-hidden="true">·</span>
          <a href={`${githubUrl}/blob/main/LICENSE`} rel="noreferrer" target="_blank">MIT License</a>
          <span aria-hidden="true">·</span>
          <a href={githubUrl} rel="noreferrer" target="_blank"><GitFork size={14} />{locale === "zh" ? "开源版本" : "Open-source edition"}</a>
        </footer>
      </main>
      <NotificationWatcher locale={locale} onCountChange={setLiveUnreadCount} />
      <BackgroundJobRunner />
      <JobPilotAssistant locale={locale} />
      <OnboardingTour locale={locale} />
    </div>
  );
}
