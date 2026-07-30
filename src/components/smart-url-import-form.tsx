"use client";

import { useActionState } from "react";
import { Link2, WandSparkles } from "lucide-react";
import { smartImportUrl, type FormState } from "@/app/actions";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

export function SmartUrlImportForm({ locale }: { locale: Locale }) {
  const [state, action, pending] = useActionState(smartImportUrl, initialState);
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  return <form action={action} className="smart-url-form"><input name="locale" type="hidden" value={locale} /><label>{text("岗位网址", "Job URL")}<span className="input-with-icon"><Link2 size={16} /><input name="url" placeholder="https://company.com/jobs/..." required type="url" /></span></label><button className="button button-primary" disabled={pending}><WandSparkles size={16} />{pending ? text("正在读取…", "Reading…") : text("智能导入", "Smart import")}</button>{state.error ? <p className="form-error" role="alert">{state.error}</p> : null}</form>;
}
