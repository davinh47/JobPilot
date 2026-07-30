"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BriefcaseBusiness, Check, ChevronDown, Eye, FileText, GripVertical, Lightbulb, ListChecks, Plus, Save, Sparkles, Trash2, WandSparkles, X } from "lucide-react";
import { createResume, saveResumeVersion, type FormState } from "@/app/actions";
import { polishResumeField, queueResumeOptimization, restructureResume } from "@/app/resumes/ai-actions";
import { ResumeExportMenu } from "@/components/resume-export-menu";
import { wakeBackgroundWorker } from "@/lib/background-worker-client";
import type { Locale } from "@/lib/i18n";
import { createResumeEntry, defaultResumeSectionTypes, editableResumeEntryDescription, normalizePlatformResume, unifiedResumeEntryDescriptionPatch, type PlatformResume, type ResumeEntry, type ResumeSection, type ResumeSectionType } from "@/lib/resume-format";
import type { ResumeOptimizationResult } from "@/lib/resume-optimization";
import { reorderResumeEntries } from "@/lib/resume-order";

const initialState: FormState = {};
type JobOption = { id: string; label: string };
type FieldSuggestion = { targetId: string; label: string; revisedText: string; changes: string[] };
type OptimizationProposal = ResumeOptimizationResult;

function sectionTitle(type: ResumeSectionType, locale: Locale) {
  const labels: Record<ResumeSectionType, [string, string]> = {
    experience_projects: ["工作与项目经历", "Experience & Projects"], experience: ["工作经历", "Experience"], education: ["教育经历", "Education"], projects: ["项目经历", "Projects"], skills: ["技能", "Skills"], certifications: ["证书与认证", "Certifications"], other: ["其他经历", "Other"],
  };
  return labels[type][locale === "zh" ? 0 : 1];
}

function entryName(type: ResumeSectionType, locale: Locale) {
  const labels: Record<ResumeSectionType, [string, string]> = {
    experience_projects: ["经历", "entry"], experience: ["工作经历", "experience"], education: ["学历", "education"], projects: ["项目", "project"], skills: ["技能组", "skill group"], certifications: ["证书", "certification"], other: ["条目", "entry"],
  };
  return labels[type][locale === "zh" ? 0 : 1];
}

function optimizationTargetLabel(content: PlatformResume, targetId: string, locale: Locale) {
  if (targetId === "summary") return locale === "zh" ? "职业简介" : "Professional summary";
  const [entryId, field] = targetId.split(":");
  const entry = content.sections.flatMap((section) => section.entries ?? []).find((item) => item.id === entryId);
  const title = entry?.position || entry?.projectName || entry?.degree || entry?.name || entry?.title || entry?.organization || entry?.school;
  const fieldLabel = field === "highlights"
    ? (locale === "zh" ? "成果与要点" : "Highlights")
    : (locale === "zh" ? "描述" : "Description");
  return title ? `${title} · ${fieldLabel}` : fieldLabel;
}

function FieldLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return <span className="resume-field-label"><span>{children}</span>{action}</span>;
}

function SkillsTextarea({ entry, label, onChange }: { entry: ResumeEntry; label: string; onChange: (patch: Partial<ResumeEntry>) => void }) {
  const [draft, setDraft] = useState(() => entry.skills.join(", "));
  return <label>{label}<textarea
    aria-label={label}
    className="compact-resizable-textarea"
    onChange={(event) => {
      const value = event.target.value;
      setDraft(value);
      onChange({ skills: value.split(/[,，\n]+/).map((item) => item.trim()).filter(Boolean) });
    }}
    rows={1}
    value={draft}
  /></label>;
}

function EntryEditor({ entry, index, locale, aiEnabled, polishPending, canDelete, canSort, onChange, onDelete, onPolish }: { entry: ResumeEntry; index: number; locale: Locale; aiEnabled: boolean; polishPending: boolean; canDelete: boolean; canSort: boolean; onChange: (patch: Partial<ResumeEntry>) => void; onDelete: () => void; onPolish: (targetId: string, label: string, value: string) => void }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id, disabled: !canSort });
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const input = (field: keyof ResumeEntry, label: string, placeholder = "") => <label>{label}<input onChange={(event) => onChange({ [field]: event.target.value })} placeholder={placeholder} value={String(entry[field] ?? "")} /></label>;
  const polishButton = (targetId: string, label: string, value: string) => aiEnabled ? <button aria-label={text(`AI 润色${label}`, `AI polish ${label}`)} className="inline-ai-button" disabled={polishPending || !value.trim()} onClick={() => onPolish(targetId, label, value)} title={value.trim() ? text("使用 AI 润色", "Polish with AI") : text("填写内容后即可润色", "Add content to enable AI polish")} type="button"><WandSparkles size={14} />{text("AI 润色", "AI polish")}</button> : null;
  const unifiedDescription = ["experience_projects", "experience", "projects", "other"].includes(entry.kind);
  const descriptionValue = unifiedDescription ? editableResumeEntryDescription(entry) : entry.description;
  const descriptionTarget = `${entry.id}:${unifiedDescription ? "details" : "description"}`;
  const description = <label><FieldLabel action={polishButton(descriptionTarget, `${sectionTitle(entry.kind, locale)} ${text("描述", "description")}`, descriptionValue)}>{text("描述", "Description")}</FieldLabel><textarea onChange={(event) => onChange(unifiedDescription ? unifiedResumeEntryDescriptionPatch(event.target.value) : { description: event.target.value })} rows={unifiedDescription ? 8 : 5} value={descriptionValue} /></label>;
  const dates = ["experience_projects", "experience", "education", "projects"].includes(entry.kind) ? <div className="resume-date-row">{input("startDate", text("开始时间", "Start date"), "2022-03")}<label>{text("结束时间", "End date")}<input disabled={entry.current} onChange={(event) => onChange({ endDate: event.target.value })} placeholder={text("至今", "Present")} value={entry.endDate} /></label><label className="resume-current-check"><input checked={entry.current} onChange={(event) => onChange({ current: event.target.checked, endDate: event.target.checked ? "" : entry.endDate })} type="checkbox" />{text("至今", "Current")}</label></div> : null;

  return <article
    className={`resume-entry-card${isDragging ? " is-dragging" : ""}`}
    ref={setNodeRef}
    style={{ transform: CSS.Transform.toString(transform), transition }}
  >
    <header><div><button
      {...attributes}
      {...listeners}
      aria-label={text(`拖动第 ${index + 1} 个条目排序`, `Reorder entry ${index + 1}`)}
      className="resume-drag-handle"
      disabled={!canSort}
      ref={setActivatorNodeRef}
      title={text("拖动排序；键盘按空格后使用方向键", "Drag to reorder; press Space then use arrow keys")}
      type="button"
    ><GripVertical size={17} /></button><span>{String(index + 1).padStart(2, "0")}</span><strong>{entryName(entry.kind, locale)}</strong></div><button aria-label={text("删除条目", "Delete entry")} className="icon-button" disabled={!canDelete} onClick={onDelete} title={text("删除条目", "Delete entry")} type="button"><Trash2 size={16} /></button></header>
    <div className="resume-entry-fields">
      {entry.kind === "experience_projects" ? <><label>{text("经历类型", "Entry type")}<select onChange={(event) => onChange({ category: event.target.value })} value={entry.category === "project" ? "project" : "experience"}><option value="experience">{text("工作经历", "Work experience")}</option><option value="project">{text("项目经历", "Project")}</option></select></label>{entry.category === "project" ? <><div className="form-row two-columns">{input("projectName", text("项目名称", "Project name"))}{input("role", text("角色", "Role"))}</div>{input("url", text("项目链接", "Project URL"))}</> : <><div className="form-row two-columns">{input("organization", text("公司/机构", "Company / organization"))}{input("position", text("职位", "Position"))}</div>{input("location", text("地点", "Location"))}</>}{dates}{description}</> : null}
      {entry.kind === "experience" ? <><div className="form-row two-columns">{input("organization", text("公司/机构", "Company / organization"))}{input("position", text("职位", "Position"))}</div>{input("location", text("地点", "Location"))}{dates}{description}</> : null}
      {entry.kind === "education" ? <><div className="form-row two-columns">{input("school", text("学校", "School"))}{input("location", text("地点", "Location"))}</div><div className="form-row two-columns">{input("degree", text("学位", "Degree"))}{input("fieldOfStudy", text("专业", "Field of study"))}</div>{dates}{description}</> : null}
      {entry.kind === "projects" ? <><div className="form-row two-columns">{input("projectName", text("项目名称", "Project name"))}{input("role", text("角色", "Role"))}</div>{input("url", text("项目链接", "Project URL"))}{dates}{description}</> : null}
      {entry.kind === "skills" ? <><div className="form-row two-columns">{input("category", text("技能类别", "Skill category"), text("例如：数据分析", "e.g. Data analysis"))}<SkillsTextarea entry={entry} label={text("技能（逗号或换行分隔）", "Skills (comma or newline separated)")} onChange={onChange} /></div></> : null}
      {entry.kind === "certifications" ? <><div className="form-row two-columns">{input("name", text("证书名称", "Certification"))}{input("issuer", text("颁发机构", "Issuer"))}</div><div className="form-row two-columns">{input("date", text("获得时间", "Date"), "2024-06")}{input("url", text("证书链接", "Credential URL"))}</div>{description}</> : null}
      {entry.kind === "other" ? <><div className="form-row two-columns">{input("title", text("标题", "Title"))}{input("subtitle", text("补充信息", "Subtitle"))}</div><div className="form-row two-columns">{input("date", text("时间", "Date"))}{input("url", text("链接", "URL"))}</div>{description}</> : null}
    </div>
  </article>;
}

function SortableEntryList({ contextId, entries, locale, aiEnabled, polishPending, onChange, onDelete, onPolish, onReorder }: {
  contextId: string;
  entries: ResumeEntry[];
  locale: Locale;
  aiEnabled: boolean;
  polishPending: boolean;
  onChange: (entryId: string, patch: Partial<ResumeEntry>) => void;
  onDelete: (entryId: string) => void;
  onPolish: (targetId: string, label: string, value: string) => void;
  onReorder: (activeId: string, overId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  };

  return <DndContext collisionDetection={closestCenter} id={`resume-section-${contextId}`} onDragEnd={handleDragEnd} sensors={sensors}>
    <SortableContext items={entries.map((entry) => entry.id)} strategy={verticalListSortingStrategy}>
      <div className="resume-entry-list">
        {entries.map((entry, index) => <EntryEditor
          aiEnabled={aiEnabled}
          canDelete={entries.length > 1}
          canSort={entries.length > 1}
          entry={entry}
          index={index}
          key={entry.id}
          locale={locale}
          polishPending={polishPending}
          onChange={(patch) => onChange(entry.id, patch)}
          onDelete={() => onDelete(entry.id)}
          onPolish={onPolish}
        />)}
      </div>
    </SortableContext>
  </DndContext>;
}

export function ResumeEditor({ locale, resumeId, expectedVersionId, resumeLanguage = locale, resumeGroupId = "", title: initialTitle, content: initialContent, aiEnabled, jobs, initialOptimization = null, savedChangeSummary, mode = "edit" }: { locale: Locale; resumeId?: string; expectedVersionId?: string; resumeLanguage?: "zh" | "en"; resumeGroupId?: string; title: string; content: PlatformResume; aiEnabled: boolean; jobs: JobOption[]; initialOptimization?: ResumeOptimizationResult | null; savedChangeSummary?: string | null; mode?: "create" | "edit" }) {
  const router = useRouter();
  const isCreate = mode === "create";
  const [state, action, pendingSave] = useActionState(isCreate ? createResume : saveResumeVersion, initialState);
  const [content, setContent] = useState(() => normalizePlatformResume(initialContent));
  const [title, setTitle] = useState(initialTitle);
  const [newSectionType, setNewSectionType] = useState<ResumeSectionType>("experience_projects");
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [fieldSuggestion, setFieldSuggestion] = useState<FieldSuggestion | null>(null);
  const [optimization, setOptimization] = useState<OptimizationProposal | null>(initialOptimization);
  const [acceptedOptimizationTargets, setAcceptedOptimizationTargets] = useState(() => new Set(initialOptimization?.edits.map((edit) => edit.targetId) ?? []));
  const [acceptOptimizationOrdering, setAcceptOptimizationOrdering] = useState(true);
  const [appliedOptimization, setAppliedOptimization] = useState<OptimizationProposal | null>(null);
  const [optimizationQueued, setOptimizationQueued] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiPending, startAiTransition] = useTransition();
  const [structurePending, startStructureTransition] = useTransition();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;

  const updateSection = (sectionId: string, updater: (section: ResumeSection) => ResumeSection) => setContent((current) => ({ ...current, sections: current.sections.map((section) => section.id === sectionId ? updater(section) : section) }));
  const updateEntry = (sectionId: string, entryId: string, patch: Partial<ResumeEntry>) => updateSection(sectionId, (section) => ({ ...section, entries: (section.entries ?? []).map((entry) => entry.id === entryId ? { ...entry, ...patch } : entry) }));
  const addEntry = (sectionId: string, type: ResumeSectionType) => updateSection(sectionId, (section) => ({ ...section, entries: [...(section.entries ?? []), createResumeEntry(type)] }));
  const removeEntry = (sectionId: string, entryId: string) => updateSection(sectionId, (section) => ({ ...section, entries: (section.entries ?? []).filter((entry) => entry.id !== entryId) }));
  const reorderEntry = (sectionId: string, activeId: string, overId: string) => updateSection(sectionId, (section) => {
    const entries = section.entries ?? [];
    const reordered = reorderResumeEntries(entries, activeId, overId);
    return reordered === entries ? section : { ...section, entries: reordered };
  });
  const addSection = () => setContent((current) => ({ ...current, sections: [...current.sections, { id: crypto.randomUUID(), type: newSectionType, title: sectionTitle(newSectionType, resumeLanguage), content: "", entries: [createResumeEntry(newSectionType)] }] }));
  const removeSection = (sectionId: string) => setContent((current) => ({ ...current, sections: current.sections.filter((section) => section.id !== sectionId) }));
  const changeSectionType = (sectionId: string, type: ResumeSectionType) => updateSection(sectionId, (section) => ({
    ...section,
    type,
    entries: (section.entries ?? []).map((entry) => ({ ...createResumeEntry(type), ...entry, kind: type })),
  }));

  const applyFieldText = (targetId: string, value: string) => {
    if (targetId === "summary") return setContent((current) => ({ ...current, summary: value }));
    const [entryId, field] = targetId.split(":");
    setContent((current) => ({ ...current, sections: current.sections.map((section) => ({ ...section, entries: (section.entries ?? []).map((entry) => entry.id !== entryId ? entry : field === "highlights" ? { ...entry, highlights: value.split("\n").map((item) => item.replace(/^[-*\u2022]\s*/, "").trim()).filter(Boolean) } : field === "details" ? { ...entry, ...unifiedResumeEntryDescriptionPatch(value) } : { ...entry, description: value }) })) }));
  };

  const requestPolish = (targetId: string, label: string, value: string) => startAiTransition(async () => {
    setAiError(""); setFieldSuggestion(null);
    const result = await polishResumeField({ resumeId: resumeId ?? null, text: value, contextLabel: label, locale: resumeLanguage, jobId: jobId || null });
    if (!result.ok) setAiError(result.error ?? text("AI 润色失败，请稍后重试。", "AI polishing failed. Try again."));
    else setFieldSuggestion({ targetId, label, revisedText: result.revisedText, changes: result.changeSummary });
  });

  const requestOptimization = () => {
    if (!jobId || !resumeId) return;
    startAiTransition(async () => {
      setAiError(""); setOptimization(null); setAcceptedOptimizationTargets(new Set()); setOptimizationQueued(false);
      const result = await queueResumeOptimization({ resumeId, jobId, locale: resumeLanguage, content });
      if (!result.ok) setAiError(result.error ?? text("AI 优化失败，请稍后重试。", "AI optimization failed. Try again."));
      else {
        setOptimizationQueued(true);
        wakeBackgroundWorker();
      }
    });
  };

  const requestRestructure = () => startStructureTransition(async () => {
    if (!resumeId) return;
    setAiError("");
    const result = await restructureResume({
      resumeId,
      locale: resumeLanguage,
      sectionTemplate: content.sections.map((section) => ({ ...section, content: "", entries: [] })),
    });
    if (!result.ok) setAiError(result.error ?? text("AI 重新整理失败，请稍后重试。", "AI reorganization failed. Try again."));
    else {
      router.replace(result.href);
      router.refresh();
    }
  });

  const applyOptimization = () => {
    if (!optimization) return;
    const acceptedEdits = optimization.edits.filter((edit) => acceptedOptimizationTargets.has(edit.targetId));
    const appliesOrdering = acceptOptimizationOrdering && Boolean(optimization.sectionOrder.length || optimization.entryOrders.length);
    if (!acceptedEdits.length && !appliesOrdering) return;
    setContent((current) => {
      let sections = current.sections.map((section) => ({ ...section, entries: (section.entries ?? []).map((entry) => ({ ...entry })) }));
      let summary = current.summary;
      for (const edit of acceptedEdits) {
        if (edit.targetId === "summary") summary = edit.revisedText;
        else {
          const [entryId, field] = edit.targetId.split(":");
          sections = sections.map((section) => ({ ...section, entries: (section.entries ?? []).map((entry) => entry.id !== entryId ? entry : field === "highlights" ? { ...entry, highlights: edit.revisedText.split("\n").map((item) => item.replace(/^[-*\u2022]\s*/, "").trim()).filter(Boolean) } : { ...entry, description: edit.revisedText }) }));
        }
      }
      if (appliesOrdering) {
        for (const order of optimization.entryOrders) sections = sections.map((section) => section.id !== order.sectionId ? section : { ...section, entries: [...(section.entries ?? [])].sort((a, b) => { const ai = order.entryIds.indexOf(a.id); const bi = order.entryIds.indexOf(b.id); return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi); }) });
        sections = [...sections].sort((a, b) => { const ai = optimization.sectionOrder.indexOf(a.id); const bi = optimization.sectionOrder.indexOf(b.id); return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi); });
      }
      return { ...current, summary, sections };
    });
    setAppliedOptimization({
      ...optimization,
      edits: acceptedEdits,
      sectionOrder: appliesOrdering ? optimization.sectionOrder : [],
      entryOrders: appliesOrdering ? optimization.entryOrders : [],
    });
    setOptimization(null);
  };

  const optimizationChangeSummary = appliedOptimization ? [
    text(`针对岗位优化：${appliedOptimization.jobLabel}`, `Job-specific optimization: ${appliedOptimization.jobLabel}`),
    text(`调整思路：${appliedOptimization.strategySummary}`, `Rationale: ${appliedOptimization.strategySummary}`),
    ...appliedOptimization.edits.map((edit) => `- ${optimizationTargetLabel(content, edit.targetId, locale)}: ${edit.reason}`),
    ...appliedOptimization.suggestions.map((suggestion) => text(`- 建议补充：${suggestion}`, `- Suggested follow-up: ${suggestion}`)),
  ].join("\n") : "";

  return <form action={action} className="resume-platform-editor">
    {resumeId ? <><input name="resumeId" type="hidden" value={resumeId} /><input name="expectedVersionId" type="hidden" value={expectedVersionId} /></> : null}<input name="locale" type="hidden" value={locale} /><input name="resumeLanguage" type="hidden" value={resumeLanguage} /><input name="resumeGroupId" type="hidden" value={resumeGroupId} /><input name="structuredContent" type="hidden" value={JSON.stringify(content)} /><input name="optimizationJobId" type="hidden" value={appliedOptimization?.jobId ?? ""} /><input name="changeSummary" type="hidden" value={optimizationChangeSummary} />
    <div className="editor-toolbar"><div><strong>{text("平台结构化格式", "Structured JobPilot format")}</strong></div><div>{resumeId ? <><Link className="button button-secondary" href={`/resumes/${resumeId}/preview`}><Eye size={16} />{text("预览", "Preview")}</Link><ResumeExportMenu locale={locale} resumeId={resumeId} /></> : null}<button className="button button-primary" disabled={pendingSave} type="submit"><Save size={16} />{pendingSave ? text(isCreate ? "正在创建…" : "保存中…", isCreate ? "Creating…" : "Saving…") : text(isCreate ? "创建基础简历" : appliedOptimization ? "另存为岗位简历" : "保存修改", isCreate ? "Create base resume" : appliedOptimization ? "Save as job resume" : "Save changes")}</button></div></div>

    {aiEnabled && resumeId ? <><section className="resume-ai-workbench resume-structure-workbench"><div className="resume-ai-heading"><span><FileText size={18} /></span><div><p className="eyebrow">AI STRUCTURE</p><h2>{text("按原件重新整理结构", "Reorganize from source")}</h2><p>{text("重新读取上传原文，并按照你当前设置的模块和名称创建一个可检查的新版本。", "Re-read the uploaded source and create a reviewable version using your current sections and labels.")}</p></div></div><div className="resume-ai-controls"><button className="button button-secondary" disabled={structurePending || aiPending} onClick={requestRestructure} type="button"><WandSparkles size={16} />{structurePending ? text("正在重新整理…", "Reorganizing…") : text("AI 重新整理结构", "AI reorganize structure")}</button></div></section><section className="resume-ai-workbench"><div className="resume-ai-heading"><span><Sparkles size={18} /></span><div><p className="eyebrow">JOB-SPECIFIC AI</p><h2>{text("按申请岗位优化", "Optimize for an application")}</h2><p>{text("任务会在后台运行，完成后通过通知返回审阅。", "Runs in the background and notifies you when the proposal is ready.")}</p></div></div>{jobs.length ? <div className="resume-ai-controls"><label>{text("目标岗位", "Target job")}<span className="select-with-icon"><BriefcaseBusiness size={16} /><select onChange={(event) => { setJobId(event.target.value); setOptimizationQueued(false); }} value={jobId}>{jobs.map((job) => <option key={job.id} value={job.id}>{job.label}</option>)}</select><ChevronDown size={15} /></span></label><button className="button button-primary" disabled={aiPending || structurePending || !jobId || optimizationQueued} onClick={requestOptimization} type="button"><Sparkles size={16} />{aiPending ? text("正在提交…", "Queueing…") : optimizationQueued ? text("已在后台分析", "Running in background") : text("生成优化建议", "Generate suggestions")}</button></div> : <p className="inline-empty"><BriefcaseBusiness size={17} />{text("将岗位加入申请进度后，即可按 JD 优化简历。", "Add a job to the pipeline to optimize against its description.")}</p>}</section></> : null}

    {aiError ? <p className="form-error" role="alert">{aiError}</p> : null}
    {optimizationQueued ? <p className="form-success" role="status">{text("优化任务已提交。你可以继续编辑或前往其他页面，完成后 JobPilot 会弹出通知。", "Optimization is running in the background. You can keep editing or leave this page; JobPilot will notify you when it is ready.")}</p> : null}
    {savedChangeSummary ? <section className="ai-proposal-panel optimization-applied saved-optimization-summary"><header><div><Check size={17} /><strong>{text("已保存版本的调整说明", "Saved version rationale")}</strong></div><span className="status-pill">{text("已保存", "Saved")}</span></header><p>{savedChangeSummary}</p></section> : null}
    {fieldSuggestion ? <section className="ai-proposal-panel"><header><div><WandSparkles size={17} /><strong>{fieldSuggestion.label}</strong></div><button className="icon-button" onClick={() => setFieldSuggestion(null)} title={text("关闭", "Close")} type="button"><X size={15} /></button></header><textarea readOnly rows={7} value={fieldSuggestion.revisedText} /><ul>{fieldSuggestion.changes.map((change) => <li key={change}>{change}</li>)}</ul><div><button className="button button-secondary" onClick={() => setFieldSuggestion(null)} type="button">{text("保留原文", "Keep original")}</button><button className="button button-primary" onClick={() => { applyFieldText(fieldSuggestion.targetId, fieldSuggestion.revisedText); setFieldSuggestion(null); }} type="button"><Check size={15} />{text("应用到草稿", "Apply to draft")}</button></div></section> : null}
    {optimization ? <section className="ai-proposal-panel optimization-proposal"><header><div><ListChecks size={17} /><strong>{optimization.jobLabel}</strong></div><button className="icon-button" onClick={() => setOptimization(null)} title={text("关闭", "Close")} type="button"><X size={15} /></button></header><p className="proposal-kicker">{text("调整思路", "Rationale")}</p><p>{optimization.strategySummary}</p><div className="optimization-change-list">{optimization.edits.map((edit) => <article key={edit.targetId}><label className="proposal-accept-control"><input checked={acceptedOptimizationTargets.has(edit.targetId)} onChange={(event) => setAcceptedOptimizationTargets((current) => { const next = new Set(current); if (event.target.checked) next.add(edit.targetId); else next.delete(edit.targetId); return next; })} type="checkbox" /><span>{text("接受此项", "Accept edit")}</span></label><strong>{edit.reason}</strong><small>{optimizationTargetLabel(content, edit.targetId, locale)}</small></article>)}</div>{optimization.sectionOrder.length || optimization.entryOrders.length ? <label className="proposal-accept-control proposal-order-control"><input checked={acceptOptimizationOrdering} onChange={(event) => setAcceptOptimizationOrdering(event.target.checked)} type="checkbox" /><span>{text("同时接受模块与条目排序建议", "Also accept section and entry ordering")}</span></label> : null}{optimization.suggestions.length ? <div className="optimization-notes"><Lightbulb size={16} /><ul>{optimization.suggestions.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}<div><button className="button button-secondary" onClick={() => setOptimization(null)} type="button">{text("全部拒绝", "Reject all")}</button><button className="button button-primary" disabled={!acceptedOptimizationTargets.size && !(acceptOptimizationOrdering && Boolean(optimization.sectionOrder.length || optimization.entryOrders.length))} onClick={applyOptimization} type="button"><Check size={15} />{text(`应用已选 ${acceptedOptimizationTargets.size} 项`, `Apply ${acceptedOptimizationTargets.size} selected`)}</button></div></section> : null}
    {appliedOptimization ? <section className="ai-proposal-panel optimization-proposal optimization-applied"><header><div><Check size={17} /><strong>{text("岗位优化已应用到当前草稿", "Job optimization applied to this draft")}</strong></div><span className="status-pill">{text("待保存", "Unsaved")}</span></header><p className="proposal-kicker">{text("调整思路", "Rationale")}</p><p>{appliedOptimization.strategySummary}</p><div className="optimization-change-list">{appliedOptimization.edits.map((edit) => <article key={edit.targetId}><strong>{edit.reason}</strong><small>{optimizationTargetLabel(content, edit.targetId, locale)}</small></article>)}</div><p className="proposal-save-note">{text("保存后会在简历工作室建立一份独立的岗位简历，并保留这些调整原因。", "Saving creates a separate job-specific resume in Resume Studio and keeps this rationale.")}</p></section> : null}

    <section className="editor-section"><div className="editor-section-heading"><span>01</span><div><h2>{text("基本信息", "Basics")}</h2><p>{text("联系方式只保存在本机，不会进入公开搜索词。", "Contact details remain local and are never used in public search queries.")}</p></div></div><div className="job-form"><label>{text("简历名称", "Resume name")}<input name="title" onChange={(event) => setTitle(event.target.value)} required value={title} /></label><div className="form-row two-columns"><label>{text("姓名", "Full name")}<input onChange={(event) => setContent((current) => ({ ...current, basics: { ...current.basics, fullName: event.target.value } }))} required value={content.basics.fullName} /></label><label>{text("职业标题", "Professional headline")}<input onChange={(event) => setContent((current) => ({ ...current, basics: { ...current.basics, headline: event.target.value } }))} value={content.basics.headline} /></label></div><div className="form-row two-columns"><label>{text("邮箱", "Email")}<input onChange={(event) => setContent((current) => ({ ...current, basics: { ...current.basics, email: event.target.value } }))} type="email" value={content.basics.email} /></label><label>{text("电话", "Phone")}<input onChange={(event) => setContent((current) => ({ ...current, basics: { ...current.basics, phone: event.target.value } }))} value={content.basics.phone} /></label></div><div className="form-row two-columns"><label>{text("地点", "Location")}<input onChange={(event) => setContent((current) => ({ ...current, basics: { ...current.basics, location: event.target.value } }))} value={content.basics.location} /></label><label>{text("链接", "Links")}<textarea aria-label={text("链接", "Links")} className="compact-resizable-textarea" onChange={(event) => setContent((current) => ({ ...current, basics: { ...current.basics, links: event.target.value } }))} rows={1} value={content.basics.links} /></label></div><label>{text("其他信息", "Other information")}<textarea onChange={(event) => setContent((current) => ({ ...current, basics: { ...current.basics, additionalInfo: event.target.value } }))} placeholder={text("例如：国籍、签证状态、工作许可等", "e.g. nationality, visa status, or work authorization")} rows={3} value={content.basics.additionalInfo} /></label></div></section>

    <section className="editor-section"><div className="editor-section-heading"><span>02</span><div><h2>{text("职业简介", "Summary")}</h2><p>{text("概括方向、经验和最有说服力的优势。", "Summarize your direction, experience, and strongest evidence.")}</p></div></div><div className="job-form"><label><FieldLabel action={aiEnabled ? <button aria-label={text("AI 润色职业简介", "AI polish professional summary")} className="inline-ai-button" disabled={aiPending || !content.summary.trim()} onClick={() => requestPolish("summary", text("职业简介", "Professional summary"), content.summary)} title={content.summary.trim() ? text("使用 AI 润色", "Polish with AI") : text("填写内容后即可润色", "Add content to enable AI polish")} type="button"><WandSparkles size={14} />{text("AI 润色", "AI polish")}</button> : null}>{text("简介内容", "Summary text")}</FieldLabel><textarea onChange={(event) => setContent((current) => ({ ...current, summary: event.target.value }))} rows={7} value={content.summary} /></label></div></section>

    <section className="resume-modules-heading"><div><p className="eyebrow">RESUME MODULES</p><h2>{text("详细经历", "Detailed history")}</h2></div><div><select aria-label={text("新增模块类型", "New module type")} onChange={(event) => setNewSectionType(event.target.value as ResumeSectionType)} value={newSectionType}>{defaultResumeSectionTypes.map((type) => <option key={type} value={type}>{sectionTitle(type, locale)}</option>)}</select><button className="button button-secondary" onClick={addSection} type="button"><Plus size={16} />{text("添加模块", "Add module")}</button></div></section>

    {content.sections.map((section, sectionIndex) => <section className="editor-section resume-module" key={section.id}><div className="editor-section-heading"><span>{String(sectionIndex + 3).padStart(2, "0")}</span><div><input aria-label={text("模块标题", "Module title")} className="resume-section-title-input" onChange={(event) => updateSection(section.id, (current) => ({ ...current, title: event.target.value }))} value={section.title} /><label className="resume-section-type-label">{text("模块分类", "Section type")}<select aria-label={text("模块分类", "Section type")} onChange={(event) => changeSectionType(section.id, event.target.value as ResumeSectionType)} value={section.type}>{defaultResumeSectionTypes.map((type) => <option key={type} value={type}>{sectionTitle(type, locale)}</option>)}</select></label></div><div className="resume-module-actions"><button className="button button-secondary" onClick={() => addEntry(section.id, section.type)} type="button"><Plus size={15} />{text(`添加${entryName(section.type, locale)}`, `Add ${entryName(section.type, locale)}`)}</button><button aria-label={text("删除模块", "Delete module")} className="icon-button" disabled={content.sections.length === 1} onClick={() => removeSection(section.id)} title={text("删除模块", "Delete module")} type="button"><Trash2 size={16} /></button></div></div><SortableEntryList aiEnabled={aiEnabled} contextId={section.id} entries={section.entries ?? []} locale={locale} onChange={(entryId, patch) => updateEntry(section.id, entryId, patch)} onDelete={(entryId) => removeEntry(section.id, entryId)} onPolish={requestPolish} onReorder={(activeId, overId) => reorderEntry(section.id, activeId, overId)} polishPending={aiPending} /></section>)}

    {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}<div className="editor-footer"><p>{isCreate ? text("创建后仍可继续增删模块、预览和导出。", "After creation, you can keep editing sections, preview, and export.") : appliedOptimization ? text("岗位优化会另存为独立简历；当前基础简历不会被覆盖。", "Job optimization is saved as a separate resume; the current base resume is not overwritten.") : text("每份简历保留首版和最近 9 版；上传原件始终不变。", "Each resume keeps its first revision and nine latest revisions; the uploaded source never changes.")}</p><button className="button button-primary" disabled={pendingSave} type="submit"><Save size={16} />{text(isCreate ? "创建基础简历" : appliedOptimization ? "另存为岗位简历" : "保存修改", isCreate ? "Create base resume" : appliedOptimization ? "Save as job resume" : "Save changes")}</button></div>
  </form>;
}
