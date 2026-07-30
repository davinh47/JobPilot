"use client";

import { useActionState, useState } from "react";
import { Plus, Radar, Save, Trash2 } from "lucide-react";
import { saveCareerPreferences, type FormState } from "@/app/actions";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

type TargetPreference = {
  id: string;
  targetTitle: string;
  seniorityLevel: "any" | "internship" | "entry" | "mid" | "senior" | "lead" | "executive";
  employmentType: "any" | "full_time" | "part_time" | "contract" | "temporary" | "internship";
  locations: Array<{
    id: string;
    location: string;
    requiresVisaSponsorship: boolean;
    workAuthorizationNotes: string;
  }>;
  remotePreference: "any" | "remote" | "hybrid" | "onsite";
  minimumSalary: number | null;
  salaryCurrency: string;
  industries: string[];
  companyAllowlist: string[];
  companyBlocklist: string[];
  excludedKeywords: string[];
  hardRequirements: string[];
};

type Preferences = {
  targets: TargetPreference[];
  searchEnabled: boolean;
  searchFrequencyMinutes: number;
};

function blankTarget(id: string): TargetPreference {
  return {
    id,
    targetTitle: "",
    seniorityLevel: "any",
    employmentType: "any",
    locations: [{ id: `${id}-location-0`, location: "", requiresVisaSponsorship: false, workAuthorizationNotes: "" }],
    remotePreference: "any",
    minimumSalary: null,
    salaryCurrency: "USD",
    industries: [],
    companyAllowlist: [],
    companyBlocklist: [],
    excludedKeywords: [],
    hardRequirements: [],
  };
}

function parseList(value: string) {
  return value.split(/\n/);
}

export function JobPreferencesForm({ locale, preferences }: { locale: Locale; preferences: Preferences }) {
  const [state, action, pending] = useActionState(saveCareerPreferences, initialState);
  const [searchEnabled, setSearchEnabled] = useState(preferences.searchEnabled);
  const [targets, setTargets] = useState(() => preferences.targets.length ? preferences.targets : [blankTarget("new-0")]);
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const listValue = (values: string[]) => values.join("\n");
  const updateTarget = (id: string, values: Partial<TargetPreference>) => setTargets((current) => current.map((target) => target.id === id ? { ...target, ...values } : target));
  const updateLocation = (targetId: string, locationId: string, values: Partial<TargetPreference["locations"][number]>) => setTargets((current) => current.map((target) => target.id === targetId ? { ...target, locations: target.locations.map((location) => location.id === locationId ? { ...location, ...values } : location) } : target));
  const addLocation = (targetId: string) => setTargets((current) => current.map((target) => target.id === targetId && target.locations.length < 10 ? { ...target, locations: [...target.locations, { id: `${targetId}-location-${Date.now()}`, location: "", requiresVisaSponsorship: false, workAuthorizationNotes: "" }] } : target));
  const removeLocation = (targetId: string, locationId: string) => setTargets((current) => current.map((target) => target.id === targetId ? { ...target, locations: target.locations.length === 1 ? target.locations : target.locations.filter((location) => location.id !== locationId) } : target));
  const addTarget = () => setTargets((current) => current.length >= 8 ? current : [...current, blankTarget(`new-${Date.now()}`)]);
  const removeTarget = (id: string) => setTargets((current) => current.length === 1 ? current : current.filter((target) => target.id !== id));

  return (
    <form action={action} className="preference-form">
      <input name="locale" type="hidden" value={locale} />
      <section className="preference-section role-targets-section">
        <div className="preference-heading"><span>01</span><div><h2>{text("岗位目标", "Role targets")}</h2><p>{text("每个目标都有独立的地点、薪资、行业和公司条件；每个地点可以分别设置是否需要签证支持。符合其中任一目标且值得考虑的岗位都会进入发现。", "Each target has its own locations, compensation, industry, and company criteria. Visa sponsorship can be set separately for every location. Roles worth considering against any target appear in discovery.")}</p></div></div>
        <div className="target-preference-list">
          {targets.map((target, index) => (
            <article className="target-preference-item" key={target.id}>
              <input name="targetId" type="hidden" value={target.id.startsWith("new-") ? "" : target.id} />
              <input name="targetLocationPreferences" type="hidden" value={JSON.stringify(target.locations.map(({ location, requiresVisaSponsorship, workAuthorizationNotes }) => ({ location, requiresVisaSponsorship, workAuthorizationNotes })))} />
              <header className="target-preference-header"><span className="target-preference-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{target.targetTitle || text("新岗位目标", "New role target")}</strong><small>{text("以下条件只用于这个岗位目标", "The criteria below apply only to this role target")}</small></div><button aria-label={text(`删除目标 ${index + 1}`, `Remove target ${index + 1}`)} className="icon-button target-remove-button" disabled={targets.length === 1} onClick={() => removeTarget(target.id)} title={text("删除这个岗位目标", "Remove this role target")} type="button"><Trash2 size={16} /></button></header>

              <div className="target-preference-fields target-basic-fields">
                <label>{text("岗位名称", "Job title")}<input autoComplete="off" name="targetTitle" onChange={(event) => updateTarget(target.id, { targetTitle: event.target.value })} placeholder={text("例如：AI Engineer", "e.g. AI Engineer")} required value={target.targetTitle} /></label>
                <label>{text("职级", "Seniority")}<select name="targetSeniority" onChange={(event) => updateTarget(target.id, { seniorityLevel: event.target.value as TargetPreference["seniorityLevel"] })} value={target.seniorityLevel}><option value="any">{text("不限", "Any")}</option><option value="internship">{text("实习", "Internship")}</option><option value="entry">{text("初级 / 应届", "Entry / graduate")}</option><option value="mid">{text("中级", "Mid level")}</option><option value="senior">{text("高级", "Senior")}</option><option value="lead">{text("负责人 / 专家", "Lead / principal")}</option><option value="executive">{text("总监及以上", "Director+")}</option></select></label>
                <label>{text("工作类型", "Employment type")}<select name="targetEmploymentType" onChange={(event) => updateTarget(target.id, { employmentType: event.target.value as TargetPreference["employmentType"] })} value={target.employmentType}><option value="any">{text("不限", "Any")}</option><option value="full_time">{text("全职", "Full-time")}</option><option value="part_time">{text("兼职", "Part-time")}</option><option value="contract">{text("合同工", "Contract")}</option><option value="temporary">{text("临时", "Temporary")}</option><option value="internship">{text("实习", "Internship")}</option></select></label>
              </div>

              <div className="target-field-group"><h3>{text("地点、签证与薪资", "Locations, authorization and compensation")}</h3>
                <div className="target-location-preference-list">
                  {target.locations.map((location, locationIndex) => <div className="target-location-preference-row" key={location.id}>
                    <label>{text(`地点 ${locationIndex + 1}`, `Location ${locationIndex + 1}`)}<input onChange={(event) => updateLocation(target.id, location.id, { location: event.target.value })} placeholder={text("例如：悉尼", "e.g. Sydney")} value={location.location} /></label>
                    <label className="checkbox-row target-location-visa"><input checked={location.requiresVisaSponsorship} onChange={(event) => updateLocation(target.id, location.id, { requiresVisaSponsorship: event.target.checked })} type="checkbox" />{text("需要雇主签证支持", "Sponsorship required")}</label>
                    <label>{text("工作许可说明（可选）", "Work authorization note (optional)")}<input onChange={(event) => updateLocation(target.id, location.id, { workAuthorizationNotes: event.target.value })} placeholder={location.requiresVisaSponsorship ? text("例如：需要办理中国工作签证", "e.g. Requires employer sponsorship") : text("例如：澳大利亚公民", "e.g. Australian citizen")} value={location.workAuthorizationNotes} /></label>
                    <button aria-label={text(`删除地点 ${locationIndex + 1}`, `Remove location ${locationIndex + 1}`)} className="icon-button" disabled={target.locations.length === 1} onClick={() => removeLocation(target.id, location.id)} title={text("删除地点", "Remove location")} type="button"><Trash2 size={15} /></button>
                  </div>)}
                  <button className="button button-secondary target-add-location" disabled={target.locations.length >= 10} onClick={() => addLocation(target.id)} type="button"><Plus size={15} />{text("添加地点", "Add location")}</button>
                </div>
                <div className="target-preference-fields target-location-fields">
                <label>{text("办公方式", "Workplace preference")}<select name="targetRemotePreference" onChange={(event) => updateTarget(target.id, { remotePreference: event.target.value as TargetPreference["remotePreference"] })} value={target.remotePreference}><option value="any">{text("不限", "Any")}</option><option value="remote">{text("远程", "Remote")}</option><option value="hybrid">{text("混合", "Hybrid")}</option><option value="onsite">{text("现场", "On-site")}</option></select></label>
                <label>{text("最低年薪", "Minimum annual salary")}<input min="0" name="targetMinimumSalary" onChange={(event) => updateTarget(target.id, { minimumSalary: event.target.value ? Number(event.target.value) : null })} step="1000" type="number" value={target.minimumSalary ?? ""} /></label>
                <label>{text("币种", "Currency")}<select name="targetSalaryCurrency" onChange={(event) => updateTarget(target.id, { salaryCurrency: event.target.value })} value={target.salaryCurrency}><option value="USD">USD</option><option value="CNY">CNY</option><option value="HKD">HKD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="CAD">CAD</option><option value="AUD">AUD</option><option value="SGD">SGD</option></select></label>
              </div></div>

              <div className="target-field-group"><h3>{text("行业与公司", "Industries and companies")}</h3><div className="target-preference-fields target-company-fields">
                <label>{text("目标行业", "Target industries")}<textarea name="targetIndustries" onChange={(event) => updateTarget(target.id, { industries: parseList(event.target.value) })} placeholder={text("建筑设计\n城市规划", "Architecture\nUrban planning")} rows={3} value={listValue(target.industries)} /></label>
                <label>{text("优先公司", "Preferred companies")}<textarea name="targetCompanyAllowlist" onChange={(event) => updateTarget(target.id, { companyAllowlist: parseList(event.target.value) })} rows={3} value={listValue(target.companyAllowlist)} /></label>
                <label>{text("排除公司", "Blocked companies")}<textarea name="targetCompanyBlocklist" onChange={(event) => updateTarget(target.id, { companyBlocklist: parseList(event.target.value) })} rows={3} value={listValue(target.companyBlocklist)} /></label>
                <label>{text("排除关键词", "Excluded keywords")}<textarea name="targetExcludedKeywords" onChange={(event) => updateTarget(target.id, { excludedKeywords: parseList(event.target.value) })} placeholder={text("销售\n外包", "Sales\nOutsourcing")} rows={3} value={listValue(target.excludedKeywords)} /></label>
              </div></div>

              <div className="target-field-group"><h3>{text("其他硬性条件", "Other hard requirements")}</h3><div className="target-preference-fields target-requirement-fields">
                <label>{text("其他硬性条件", "Other hard requirements")}<textarea name="targetHardRequirements" onChange={(event) => updateTarget(target.id, { hardRequirements: parseList(event.target.value) })} placeholder={text("不接受出差超过 20%\n必须支持远程", "No more than 20% travel\nMust support remote work")} rows={3} value={listValue(target.hardRequirements)} /></label>
              </div></div>
            </article>
          ))}
          <button className="button button-secondary add-target-button" disabled={targets.length >= 8} onClick={addTarget} type="button"><Plus size={16} />{text("添加另一套岗位目标", "Add another role target")}</button>
        </div>
      </section>

      <section className="preference-section automation-preference">
        <div className="preference-heading"><span><Radar size={16} /></span><div><h2>{text("自动发现频率", "Automatic discovery schedule")}</h2><p>{text("这是唯一的全局设置；搜索时会分别执行上面的每个岗位目标。", "This is the only global setting. Each role target above is searched independently.")}</p></div><label className="switch-control"><input checked={searchEnabled} name="searchEnabled" onChange={(event) => setSearchEnabled(event.target.checked)} type="checkbox" /><span /><strong>{searchEnabled ? text("已开启", "On") : text("已关闭", "Off")}</strong></label></div>
        <div className="job-form"><label>{text("搜索频率", "Search frequency")}<select defaultValue={preferences.searchFrequencyMinutes} name="searchFrequencyMinutes"><option value="360">{text("每 6 小时", "Every 6 hours")}</option><option value="720">{text("每 12 小时", "Every 12 hours")}</option><option value="1440">{text("每天", "Daily")}</option><option value="4320">{text("每 3 天", "Every 3 days")}</option><option value="10080">{text("每周", "Weekly")}</option></select></label></div>
      </section>

      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
      <div className="preference-footer"><p>{text("公开搜索只使用岗位条件，不会包含姓名、电话或邮箱。", "Public searches use only job criteria and never include your name, phone, or email.")}</p><button className="button button-primary" disabled={pending} type="submit"><Save size={16} />{pending ? text("保存中…", "Saving…") : text("保存搜索偏好", "Save search preferences")}</button></div>
    </form>
  );
}
