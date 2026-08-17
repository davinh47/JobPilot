"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import type { Locale } from "@/lib/i18n";

const STORAGE_KEY = "jobpilot:interface-tour:v3";
export const ONBOARDING_OPEN_EVENT = "jobpilot:open-onboarding";

const steps = [
  {
    route: "/matches",
    selector: '[data-tour="nav-discovery"]',
    placement: "right",
    titleZh: "从岗位发现开始",
    titleEn: "Start with job discovery",
    bodyZh: "这里集中显示自动发现和你手动添加的岗位。已经加入申请进度的岗位会从发现列表中移出。",
    bodyEn: "This is where automatically discovered and manually added jobs appear. Roles move out after you add them to the pipeline.",
  },
  {
    route: "/matches",
    selector: '[data-tour="discovery-preferences"]',
    titleZh: "先设置你的求职目标",
    titleEn: "Set your search goals first",
    bodyZh: "目标岗位、地点、远程方式、薪资和签证要求会同时用于网络搜索、硬过滤和 AI 匹配。",
    bodyEn: "Target titles, locations, work mode, salary, and visa requirements drive web search, hard filters, and AI matching.",
  },
  {
    route: "/matches",
    selector: '[data-tour="discovery-add-job"]',
    titleZh: "也可以自己添加岗位",
    titleEn: "You can add jobs yourself",
    bodyZh: "粘贴岗位链接或完整 JD，JobPilot 会保存岗位快照；开启 AI 后还可以分析匹配度和能力缺口。",
    bodyEn: "Paste a job URL or full description. JobPilot saves a snapshot and can analyze fit and gaps when AI is enabled.",
  },
  {
    route: "/pipeline",
    selector: '[data-tour="pipeline-views"]',
    titleZh: "用两种视图跟进申请",
    titleEn: "Track applications in two views",
    bodyZh: "看板适合按阶段推进，列表适合比较公司、岗位、截止日期和申请日期。你还可以建立自己的状态栏。",
    bodyEn: "Use the board to move applications through stages, or the list to compare companies, roles, deadlines, and dates. Custom stages are supported.",
  },
  {
    route: "/resumes",
    selector: '[data-tour="resume-actions"]',
    titleZh: "导入或在线建立简历",
    titleEn: "Import or create a resume",
    bodyZh: "导入文件后会转换为可编辑的 JobPilot 模块，也可以从空白开始。原件和每个定制版本都会保留。",
    bodyEn: "Imports become editable JobPilot sections, or you can start from scratch. Originals and every tailored version are preserved.",
  },
  {
    route: "/settings",
    selector: '[data-tour="ai-settings"]',
    titleZh: "AI 辅助完全可选",
    titleEn: "AI assistance is optional",
    bodyZh: "在这里开启模型并配置 API Key。不开启 AI 时，简历编辑、人工添加岗位和申请进度仍然完整可用。",
    bodyEn: "Enable a model and configure its API key here. Resume editing, manual job entry, and pipeline tracking still work without AI.",
  },
  {
    route: "/settings",
    selector: '[data-tour="assistant-launcher"]',
    titleZh: "随时问 JobPilot 助手",
    titleEn: "Ask JobPilot Assistant anytime",
    bodyZh: "它可以回答界面使用问题、提供简历建议，并把你描述的修改整理成待确认草稿。只有你确认后，修改才会写入简历。",
    bodyEn: "It can explain the interface, suggest resume improvements, and turn requested edits into reviewable drafts. Nothing is written to your resume until you confirm it.",
  },
  {
    route: "/settings",
    selector: '[data-tour="chrome-extension"]',
    titleZh: "从浏览器一键保存岗位",
    titleEn: "Save jobs from your browser",
    bodyZh: "安装并配对 Chrome 扩展后，可在 LinkedIn、SEEK 等登录后的岗位详情页一键保存。扩展只在你主动点击保存时读取当前页面。",
    bodyEn: "Install and pair the Chrome extension to save roles from signed-in pages such as LinkedIn or SEEK. It reads the current page only when you explicitly click Save.",
  },
] as const;

type TargetRect = { top: number; left: number; width: number; height: number; bottom: number };

function routeMatches(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`) || pathname.startsWith(`${route}?`);
}

export function OnboardingTour({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const current = steps[step];
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;

  const finish = useCallback((returnHome = false) => {
    window.localStorage.setItem(STORAGE_KEY, "complete");
    setOpen(false);
    setTargetRect(null);
    if (returnHome) router.push("/matches");
  }, [router]);

  useEffect(() => {
    const showTimer = window.localStorage.getItem(STORAGE_KEY) !== "complete" ? window.setTimeout(() => {
      setStep(0);
      setOpen(true);
    }, 250) : undefined;
    const reopen = () => {
      setStep(0);
      setTargetRect(null);
      setOpen(true);
    };
    window.addEventListener(ONBOARDING_OPEN_EVENT, reopen);
    return () => {
      if (showTimer !== undefined) window.clearTimeout(showTimer);
      window.removeEventListener(ONBOARDING_OPEN_EVENT, reopen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [finish, open]);

  useEffect(() => {
    if (!open) return;
    if (!routeMatches(pathname, current.route)) {
      router.push(current.route);
      return;
    }

    let attempts = 0;
    const locate = () => {
      const target = document.querySelector<HTMLElement>(current.selector);
      if (!target) {
        attempts += 1;
        if (attempts < 30) window.setTimeout(locate, 100);
        return;
      }
      target.scrollIntoView({ block: "center", inline: "nearest" });
      window.requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        const padding = 7;
        setTargetRect({
          top: Math.max(6, rect.top - padding),
          left: Math.max(6, rect.left - padding),
          width: Math.min(window.innerWidth - 12, rect.width + padding * 2),
          height: rect.height + padding * 2,
          bottom: rect.bottom + padding,
        });
        nextButtonRef.current?.focus();
      });
    };
    const locateTimer = window.setTimeout(locate, 80);
    const updatePosition = () => {
      const target = document.querySelector<HTMLElement>(current.selector);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const padding = 7;
      setTargetRect({ top: Math.max(6, rect.top - padding), left: Math.max(6, rect.left - padding), width: Math.min(window.innerWidth - 12, rect.width + padding * 2), height: rect.height + padding * 2, bottom: rect.bottom + padding });
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.clearTimeout(locateTimer);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [current, open, pathname, router]);

  const moveTo = (nextStep: number) => {
    setTargetRect(null);
    setStep(nextStep);
  };

  if (!open) return null;

  const tooltipWidth = typeof window === "undefined" ? 360 : Math.min(360, window.innerWidth - 24);
  const spaceBelow = targetRect ? window.innerHeight - targetRect.bottom : 0;
  const sidePlacement = targetRect && "placement" in current && current.placement === "right" && window.innerWidth > 760;
  const verticalPosition = targetRect
    ? spaceBelow >= 250
      ? { top: targetRect.bottom + 14 }
      : targetRect.top >= 250
        ? { bottom: window.innerHeight - targetRect.top + 14 }
        : { bottom: 12 }
    : {};
  const tooltipStyle = targetRect ? sidePlacement ? {
    width: tooltipWidth,
    left: Math.min(targetRect.left + targetRect.width + 14, window.innerWidth - tooltipWidth - 12),
    top: Math.max(12, Math.min(targetRect.top, window.innerHeight - 250)),
  } : {
    width: tooltipWidth,
    left: Math.max(12, Math.min(targetRect.left, window.innerWidth - tooltipWidth - 12)),
    ...verticalPosition,
  } : undefined;

  return (
    <div className="interface-tour" role="presentation">
      <div className="tour-click-catcher" />
      {targetRect ? <div aria-hidden="true" className="tour-spotlight" style={{ top: targetRect.top, left: targetRect.left, width: targetRect.width, height: targetRect.height }} /> : null}
      <section aria-describedby="tour-description" aria-labelledby="tour-title" aria-modal="true" className={`tour-tooltip ${targetRect ? "anchored" : "loading"}`} role="dialog" style={tooltipStyle}>
        <header>
          <span>{text(`界面引导 ${step + 1}/${steps.length}`, `INTERFACE TOUR ${step + 1}/${steps.length}`)}</span>
          <button aria-label={text("退出引导", "Exit tour")} onClick={() => finish()} title={text("退出引导", "Exit tour")} type="button"><X size={17} /></button>
        </header>
        {targetRect ? (
          <div className="tour-tooltip-content">
            <h2 id="tour-title">{locale === "zh" ? current.titleZh : current.titleEn}</h2>
            <p id="tour-description">{locale === "zh" ? current.bodyZh : current.bodyEn}</p>
          </div>
        ) : <div className="tour-loading"><span />{text("正在打开对应界面…", "Opening this workspace…")}</div>}
        <footer>
          <button className="tour-skip" onClick={() => finish()} type="button">{text("跳过引导", "Skip tour")}</button>
          <div>
            {step > 0 ? <button aria-label={text("上一步", "Previous step")} className="tour-icon-button" onClick={() => moveTo(step - 1)} title={text("上一步", "Previous step")} type="button"><ArrowLeft size={17} /></button> : null}
            {step < steps.length - 1 ? <button className="button button-primary" onClick={() => moveTo(step + 1)} ref={nextButtonRef} type="button">{text("下一步", "Next")}<ArrowRight size={16} /></button> : <button className="button button-primary" onClick={() => finish(true)} ref={nextButtonRef} type="button"><Check size={16} />{text("完成", "Finish")}</button>}
          </div>
        </footer>
      </section>
    </div>
  );
}

export function ReplayOnboardingButton({ locale }: { locale: Locale }) {
  return <button className="button button-secondary compact-button" onClick={() => window.dispatchEvent(new Event(ONBOARDING_OPEN_EVENT))} type="button">{locale === "zh" ? "重新演示" : "Replay tour"}</button>;
}
