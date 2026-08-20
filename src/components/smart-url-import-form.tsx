"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, WandSparkles } from "lucide-react";
import type { Locale } from "@/lib/i18n";

export function SmartUrlImportForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const url = String(new FormData(event.currentTarget).get("url") ?? "");
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/jobs/smart-import", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, locale }) });
      const result = await response.json() as { ok: boolean; error?: string; jobUrl?: string };
      if (!result.ok || !result.jobUrl) setError(result.error ?? text("无法导入这个岗位页面。", "Unable to import this job page."));
      else router.push(result.jobUrl);
    } catch {
      setError(text("网络请求失败，请稍后重试。", "The network request failed. Try again."));
    } finally {
      setPending(false);
    }
  };
  return <form className="smart-url-form" onSubmit={submit}><label>{text("岗位网址", "Job URL")}<span className="input-with-icon"><Link2 size={16} /><input name="url" placeholder="https://company.com/jobs/..." required type="url" /></span></label><button className="button button-primary" disabled={pending}><WandSparkles size={16} />{pending ? text("正在读取…", "Reading…") : text("智能导入", "Smart import")}</button>{error ? <p className="form-error" role="alert">{error}</p> : null}</form>;
}
