"use client";

import { useActionState } from "react";
import { ArrowRight, Link2 } from "lucide-react";
import { addJob, type FormState } from "@/app/actions";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

export function AddJobForm({ locale }: { locale: Locale }) {
  const [state, action, pending] = useActionState(addJob, initialState);
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;

  return (
    <form action={action} className="job-form">
      <input name="locale" type="hidden" value={locale} />
      <div className="form-row two-columns">
        <label>{text("职位名称", "Job title")}<input name="title" placeholder="Senior Product Manager" required /></label>
        <label>{text("公司名称", "Company")}<input name="companyName" placeholder="Acme" required /></label>
      </div>
      <div className="form-row two-columns">
        <label>{text("地点", "Location")}<input name="location" placeholder={text("例如：上海 / Remote", "e.g. New York / Remote")} /></label>
        <label>{text("办公方式", "Workplace")}
          <select name="workplaceType" defaultValue="unknown">
            <option value="unknown">{text("尚不确定", "Unknown")}</option>
            <option value="remote">{text("远程", "Remote")}</option>
            <option value="hybrid">{text("混合", "Hybrid")}</option>
            <option value="onsite">{text("现场", "On-site")}</option>
          </select>
        </label>
      </div>
      <div className="form-row two-columns">
      <label>{text("岗位链接", "Job link")}
        <span className="input-with-icon"><Link2 size={16} /><input name="canonicalUrl" type="url" placeholder="https://company.com/jobs/..." /></span>
      </label>
      <label>{text("申请截止日期", "Application deadline")}<input name="applicationDeadline" type="date" /></label>
      </div>
      <label>{text("职位描述（JD）", "Job description")}
        <textarea name="descriptionText" rows={14} placeholder={text("粘贴完整职位描述。这里的内容会作为不可变来源快照保存。", "Paste the full job description. It will be stored as an immutable source snapshot.")} required />
      </label>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <div className="form-actions">
        <p>{text("岗位会先进入发现池，不会自动加入申请进度。", "The job enters discovery first and is not automatically added to your pipeline.")}</p>
        <button className="button button-primary" disabled={pending} type="submit">
          {pending ? text("正在保存…", "Saving…") : text("保存并分析", "Save and analyze")}<ArrowRight size={16} />
        </button>
      </div>
    </form>
  );
}
