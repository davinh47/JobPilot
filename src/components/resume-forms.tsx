"use client";

import { useActionState } from "react";
import { FileUp, Save } from "lucide-react";
import { createResume, importResume, type FormState } from "@/app/actions";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

export function CreateResumeForm({ locale, resumeLanguage = locale, resumeGroupId = "" }: { locale: Locale; resumeLanguage?: "zh" | "en"; resumeGroupId?: string }) {
  const [state, action, pending] = useActionState(createResume, initialState);
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  return (
    <form action={action} className="job-form resume-editor-form">
      <input name="locale" type="hidden" value={locale} />
      <input name="resumeLanguage" type="hidden" value={resumeLanguage} />
      <input name="resumeGroupId" type="hidden" value={resumeGroupId} />
      <label>{text("简历名称", "Resume name")}<input name="title" placeholder={text("例如：产品经理基础简历", "e.g. Product manager base resume")} required /></label>
      <div className="form-row two-columns"><label>{text("姓名", "Full name")}<input name="fullName" required /></label><label>{text("职业标题", "Professional headline")}<input name="headline" placeholder="Senior Product Manager" /></label></div>
      <div className="form-row two-columns"><label>{text("邮箱", "Email")}<input name="email" type="email" /></label><label>{text("电话", "Phone")}<input name="phone" /></label></div>
      <label>{text("职业简介", "Professional summary")}<textarea name="summary" placeholder={text("用几句话概括你的方向、年限和核心优势。", "Summarize your direction, experience, and strongest evidence.")} required rows={5} /></label>
      <label>{text("工作与项目经历", "Experience and projects")}<textarea name="experience" placeholder={text("按公司/项目填写职位、时间、职责和成果。不要担心格式，后续可以结构化整理。", "List roles or projects with dates, responsibilities, and outcomes. Structure can be refined later.")} required rows={14} /></label>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <div className="form-actions"><p>{text("姓名、邮箱和电话只保存在本机，不会加入公开搜索。", "Your name, email, and phone stay local and are never added to public searches.")}</p><button className="button button-primary" disabled={pending} type="submit"><Save size={16} />{pending ? text("正在创建…", "Creating…") : text("创建基础简历", "Create base resume")}</button></div>
    </form>
  );
}

export function ImportResumeForm({ locale, resumeLanguage, resumeGroupId = "" }: { locale: Locale; resumeLanguage: "zh" | "en"; resumeGroupId?: string }) {
  const [state, action, pending] = useActionState(importResume, initialState);
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  return (
    <form action={action} className="import-form">
      <input name="locale" type="hidden" value={locale} />
      <input name="resumeLanguage" type="hidden" value={resumeLanguage} />
      <input name="resumeGroupId" type="hidden" value={resumeGroupId} />
      <label className="file-drop"><FileUp size={28} /><strong>{text("选择 PDF、DOCX 或 TXT 简历", "Choose a PDF, DOCX, or TXT resume")}</strong><span>{text("最大 10 MB", "Up to 10 MB")}</span><input accept=".pdf,.docx,.txt" name="file" required type="file" /></label>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <button className="button button-primary" disabled={pending} type="submit"><FileUp size={16} />{pending ? text("正在导入…", "Importing…") : text("导入简历", "Import resume")}</button>
    </form>
  );
}
