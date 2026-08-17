"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { analyzeJobMatch } from "@/app/jobs/[id]/ai-actions";
import { wakeBackgroundWorker } from "@/lib/background-worker-client";
import type { Locale } from "@/lib/i18n";

export function JobMatchButton({ jobId, locale, hasMatch, initiallyQueued, enabled }: { jobId: string; locale: Locale; hasMatch: boolean; initiallyQueued: boolean; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [queued, setQueued] = useState(initiallyQueued);
  const [error, setError] = useState("");
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;

  const requestMatch = () => startTransition(async () => {
    setError("");
    const result = await analyzeJobMatch({ jobId, locale });
    if (!result.ok) {
      setError(result.error ?? text("匹配分析提交失败，请稍后重试。", "Could not queue the match analysis. Try again."));
      return;
    }
    setQueued(true);
    wakeBackgroundWorker();
  });

  return <div className="job-match-action">
    <button className="button button-primary" disabled={!enabled || pending || queued} onClick={requestMatch} title={!enabled ? text("先在设置中启用 AI 并配置当前提供商 Key", "Enable AI and configure the selected provider key first") : undefined} type="button">
      {pending || queued ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
      {pending ? text("正在提交…", "Queueing…") : queued ? text("已在后台分析", "Running in background") : hasMatch ? text("重新分析", "Analyze again") : text("分析匹配度", "Analyze match")}
    </button>
    {error ? <span aria-live="polite" className="form-error">{error}</span> : null}
  </div>;
}
