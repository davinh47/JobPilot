"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { ExternalLink, LayoutGrid, List, Pencil, Plus, Save, Settings2, X } from "lucide-react";
import { addApplicationStatus, deleteApplication, updateApplicationDetails, updateApplicationStatusLabels, updateApplicationStatusOptimistic } from "@/app/actions";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import type { Locale } from "@/lib/i18n";
import { initials } from "@/lib/utils";

type Status = { id: string; slug: string; label: string; labelZh: string; labelEn: string; color: string };
type PipelineRow = {
  applicationId: string;
  status: string;
  companyName: string;
  title: string;
  jobId: string;
  url: string | null;
  location: string | null;
  deadline: string;
  deadlineValue: string;
  appliedAt: string;
  appliedAtValue: string;
  nextAction: string;
};

type PipelineRowPatch = Partial<Omit<PipelineRow, "applicationId" | "jobId">>;
type ApplicationDetailsDraft = {
  companyName: string;
  title: string;
  location: string;
  canonicalUrl: string;
  applicationDeadline: string;
  appliedAt: string;
  nextAction: string;
};

function displayDate(value: string, locale: Locale) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00.000Z`);
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function ApplicationEditDialog({ error, locale, onClose, onSave, row, saving }: {
  error: string;
  locale: Locale;
  onClose: () => void;
  onSave: (draft: ApplicationDetailsDraft) => void;
  row: PipelineRow;
  saving: boolean;
}) {
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [draft, setDraft] = useState<ApplicationDetailsDraft>({
    companyName: row.companyName,
    title: row.title,
    location: row.location ?? "",
    canonicalUrl: row.url ?? "",
    applicationDeadline: row.deadlineValue,
    appliedAt: row.appliedAtValue,
    nextAction: row.nextAction,
  });
  const update = (field: keyof ApplicationDetailsDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  return <div className="pipeline-edit-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) onClose(); }}>
    <form aria-modal="true" className="pipeline-edit-dialog" onSubmit={(event) => { event.preventDefault(); onSave(draft); }} role="dialog">
      <header><div><p className="eyebrow">APPLICATION DETAILS</p><h2>{text("编辑申请条目", "Edit application")}</h2></div><button aria-label={text("关闭", "Close")} className="icon-button" disabled={saving} onClick={onClose} type="button"><X size={17} /></button></header>
      <div className="pipeline-edit-fields">
        <div className="form-row two-columns"><label>{text("公司", "Company")}<input onChange={(event) => update("companyName", event.target.value)} required value={draft.companyName} /></label><label>{text("岗位", "Role")}<input onChange={(event) => update("title", event.target.value)} required value={draft.title} /></label></div>
        <div className="form-row two-columns"><label>{text("地点", "Location")}<input onChange={(event) => update("location", event.target.value)} value={draft.location} /></label><label>{text("岗位网页", "Job URL")}<input onChange={(event) => update("canonicalUrl", event.target.value)} placeholder="https://..." type="url" value={draft.canonicalUrl} /></label></div>
        <div className="form-row two-columns"><label>{text("截止日期", "Application deadline")}<input onChange={(event) => update("applicationDeadline", event.target.value)} type="date" value={draft.applicationDeadline} /></label><label>{text("申请日期", "Applied date")}<input onChange={(event) => update("appliedAt", event.target.value)} type="date" value={draft.appliedAt} /></label></div>
        <label>{text("下一步", "Next action")}<input onChange={(event) => update("nextAction", event.target.value)} placeholder={text("例如：准备作品集、联系推荐人", "e.g. prepare portfolio or contact a referee")} value={draft.nextAction} /></label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <footer><button className="button button-secondary" disabled={saving} onClick={onClose} type="button">{text("取消", "Cancel")}</button><button className="button button-primary" disabled={saving} type="submit">{saving ? text("保存中…", "Saving…") : text("保存修改", "Save changes")}</button></footer>
    </form>
  </div>;
}

function StatusManagerDialog({ locale, onClose, statuses }: {
  locale: Locale;
  onClose: () => void;
  statuses: Status[];
}) {
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [drafts, setDrafts] = useState(() => statuses.map((status) => ({ ...status })));
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [savedStatusId, setSavedStatusId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, startSaving] = useTransition();
  const update = (statusId: string, field: "labelZh" | "labelEn", value: string) => {
    setDrafts((current) => current.map((status) => status.id === statusId ? { ...status, [field]: value } : status));
    setSavedStatusId(null);
  };
  const save = (status: Status) => {
    setPendingStatusId(status.id);
    setSavedStatusId(null);
    setError("");
    startSaving(async () => {
      const result = await updateApplicationStatusLabels({ statusId: status.id, labelZh: status.labelZh, labelEn: status.labelEn });
      if (result.ok) setSavedStatusId(status.id);
      else setError(text("状态名称保存失败，请检查后重试。", "Unable to save the status names. Check them and try again."));
      setPendingStatusId(null);
    });
  };
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  return <div className="pipeline-edit-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) onClose(); }}>
    <section aria-modal="true" className="status-manager-dialog" role="dialog">
      <header><div><p className="eyebrow">PIPELINE LABELS</p><h2>{text("管理申请状态", "Manage application statuses")}</h2></div><button aria-label={text("关闭", "Close")} className="icon-button" disabled={saving} onClick={onClose} type="button"><X size={17} /></button></header>
      <p className="status-manager-note">{text("可以修改默认和自建状态的显示名称。内部流程标识不会改变，已有申请记录也会保留。", "Rename default and custom statuses without changing their workflow identity or existing applications.")}</p>
      <div className="status-manager-list">
        {drafts.map((status) => <form className="status-manager-row" key={status.id} onSubmit={(event) => { event.preventDefault(); save(status); }}>
          <span aria-hidden="true" className={`status-color-dot status-color-dot-${status.color}`} />
          <label>{text("中文名称", "Chinese name")}<input maxLength={30} onChange={(event) => update(status.id, "labelZh", event.target.value)} required value={status.labelZh} /></label>
          <label>{text("英文名称", "English name")}<input maxLength={30} onChange={(event) => update(status.id, "labelEn", event.target.value)} required value={status.labelEn} /></label>
          <button className="button button-secondary compact-button" disabled={saving && pendingStatusId === status.id} type="submit"><Save size={15} />{saving && pendingStatusId === status.id ? text("保存中…", "Saving…") : savedStatusId === status.id ? text("已保存", "Saved") : text("保存", "Save")}</button>
        </form>)}
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <footer><button className="button button-primary" disabled={saving} onClick={onClose} type="button">{text("完成", "Done")}</button></footer>
    </section>
  </div>;
}

export function PipelineWorkspace({ locale, rows, statuses }: { locale: Locale; rows: PipelineRow[]; statuses: Status[] }) {
  const [view, setView] = useState<"board" | "list">("board");
  const [addingStatus, setAddingStatus] = useState(false);
  const [managingStatuses, setManagingStatuses] = useState(false);
  const [optimisticRows, updateOptimisticRow] = useOptimistic(rows, (current, update: { applicationId: string; patch: PipelineRowPatch }) => current.map((row) => row.applicationId === update.applicationId ? { ...row, ...update.patch } : row));
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState("");
  const [editing, setEditing] = useState<PipelineRow | null>(null);
  const [editError, setEditError] = useState("");
  const [statusPending, startStatusTransition] = useTransition();
  const [editPending, startEditTransition] = useTransition();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const changeStatus = (row: PipelineRow, status: string) => {
    if (status === row.status) return;
    const appliedAtValue = status === "applied" && !row.appliedAtValue
      ? new Date().toISOString().slice(0, 10)
      : row.appliedAtValue;
    setPendingStatusId(row.applicationId);
    setStatusError("");
    startStatusTransition(async () => {
      updateOptimisticRow({ applicationId: row.applicationId, patch: { status, appliedAtValue } });
      const result = await updateApplicationStatusOptimistic({ applicationId: row.applicationId, jobId: row.jobId, status });
      if (!result.ok) setStatusError(text("申请状态保存失败，请重试。", "Unable to save the application status. Try again."));
      setPendingStatusId(null);
    });
  };
  const saveDetails = (draft: ApplicationDetailsDraft) => {
    if (!editing) return;
    setEditError("");
    startEditTransition(async () => {
      updateOptimisticRow({
        applicationId: editing.applicationId,
        patch: {
          companyName: draft.companyName,
          title: draft.title,
          location: draft.location,
          url: draft.canonicalUrl,
          deadlineValue: draft.applicationDeadline,
          appliedAtValue: draft.appliedAt,
          deadline: draft.applicationDeadline ? displayDate(draft.applicationDeadline, locale) : "—",
          appliedAt: draft.appliedAt ? displayDate(draft.appliedAt, locale) : "—",
          nextAction: draft.nextAction,
        },
      });
      const result = await updateApplicationDetails({
        applicationId: editing.applicationId,
        jobId: editing.jobId,
        ...draft,
      });
      if (!result.ok) setEditError(text("请检查填写内容和网页链接格式。", "Check the fields and job URL format."));
      else setEditing(null);
    });
  };

  return (
    <div className="page-shell wide-page">
      <header className="page-header">
        <div><p className="eyebrow">APPLICATIONS</p><h1>{text("申请进度", "Application pipeline")}</h1><p className="page-description">{text("用看板推进阶段，用列表快速比较截止日期、申请日期和岗位信息。", "Move work through stages on the board, or compare deadlines and application details in the list.")}</p></div>
        <Link className="button button-primary" href="/matches"><Plus size={16} />{text("从岗位发现添加", "Add from discovery")}</Link>
      </header>

      <div className="pipeline-toolbar">
        <div className="segmented-control view-toggle" aria-label={text("视图模式", "View mode")} data-tour="pipeline-views">
          <button className={view === "board" ? "active" : ""} onClick={() => setView("board")} type="button"><LayoutGrid size={15} />{text("看板", "Board")}</button>
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} type="button"><List size={15} />{text("列表", "List")}</button>
        </div>
        {addingStatus ? (
          <form action={addApplicationStatus} className="inline-status-form">
            <input autoFocus maxLength={30} name="label" placeholder={text("新状态名称", "New status name")} required />
            <button className="button button-primary" type="submit">{text("添加", "Add")}</button>
            <button className="button button-secondary" onClick={() => setAddingStatus(false)} type="button">{text("取消", "Cancel")}</button>
          </form>
        ) : <div className="pipeline-status-actions"><button className="button button-secondary" onClick={() => setManagingStatuses(true)} type="button"><Settings2 size={16} />{text("管理状态", "Manage statuses")}</button><button className="button button-secondary" onClick={() => setAddingStatus(true)} type="button"><Plus size={16} />{text("新建状态", "New status")}</button></div>}
      </div>

      {view === "board" ? (
        <div className="pipeline-board" style={{ gridTemplateColumns: `repeat(${Math.max(statuses.length, 1)}, minmax(210px, 1fr))` }}>
          {statuses.map((status) => {
            const stageRows = optimisticRows.filter((row) => row.status === status.slug);
            return (
              <section className={`pipeline-column status-color-${status.color}`} key={status.id}>
                <header><h2><span className="status-color-dot" />{status.label}</h2><span>{stageRows.length}</span></header>
                <div className="pipeline-items">
                  {stageRows.map((row) => (
                    <article className="pipeline-card" key={row.applicationId}>
                      <Link href={`/jobs/${row.jobId}`}><span className="company-avatar small">{initials(row.companyName)}</span><strong>{row.title}</strong><small>{row.companyName}</small></Link>
                      <div className="card-status-form"><select aria-label={text("申请状态", "Application status")} disabled={statusPending && pendingStatusId === row.applicationId} onChange={(event) => changeStatus(row, event.target.value)} value={row.status}>{statuses.map((option) => <option key={option.id} value={option.slug}>{option.label}</option>)}</select></div>
                      <div className="pipeline-card-actions"><button aria-label={text("编辑申请条目", "Edit application")} className="icon-button" onClick={() => { setEditError(""); setEditing(row); }} title={text("编辑申请条目", "Edit application")} type="button"><Pencil size={15} /></button><form action={deleteApplication} className="pipeline-card-delete"><input name="applicationId" type="hidden" value={row.applicationId} /><ConfirmDeleteButton cancelLabel={text("取消", "Cancel")} confirmLabel={text("移出申请进度", "Remove application")} description={text(`将删除 ${row.companyName} · ${row.title} 的申请时间线、材料和面试记录。岗位及其网页快照会保留，并重新出现在岗位推荐中。`, `This removes the application timeline, materials, and interviews for ${row.companyName} · ${row.title}. The job and its snapshots remain and return to discovery.`)} title={text("移出申请进度？", "Remove from pipeline?")} triggerLabel={text("删除申请记录", "Delete application record")} /></form></div>
                    </article>
                  ))}
                  {stageRows.length === 0 ? <span className="column-empty">{text("暂无岗位", "No jobs")}</span> : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <section className="data-table pipeline-list-table">
          <div className="table-head pipeline-list-grid"><span>{text("公司", "Company")}</span><span>{text("岗位", "Role")}</span><span>{text("地点", "Location")}</span><span>{text("网页", "Link")}</span><span>{text("截止日期", "Deadline")}</span><span>{text("申请日期", "Applied")}</span><span>{text("申请状态", "Status")}</span><span aria-label={text("操作", "Actions")} /></div>
          {optimisticRows.map((row) => (
            <div className="table-row pipeline-list-grid" key={row.applicationId}>
              <strong>{row.companyName}</strong>
              <Link href={`/jobs/${row.jobId}`}>{row.title}</Link>
              <span>{row.location || "—"}</span>
              <span>{row.url ? <a className="icon-link" href={row.url} rel="noreferrer" target="_blank" title={text("打开岗位网页", "Open job page")}><ExternalLink size={16} /></a> : "—"}</span>
              <span>{displayDate(row.deadlineValue, locale)}</span>
              <span>{displayDate(row.appliedAtValue, locale)}</span>
              <div className="list-status-form"><select disabled={statusPending && pendingStatusId === row.applicationId} onChange={(event) => changeStatus(row, event.target.value)} value={row.status}>{statuses.map((option) => <option key={option.id} value={option.slug}>{option.label}</option>)}</select></div>
              <div className="pipeline-list-actions"><button aria-label={text("编辑申请条目", "Edit application")} className="icon-button" onClick={() => { setEditError(""); setEditing(row); }} title={text("编辑申请条目", "Edit application")} type="button"><Pencil size={15} /></button><form action={deleteApplication} className="pipeline-list-delete"><input name="applicationId" type="hidden" value={row.applicationId} /><ConfirmDeleteButton cancelLabel={text("取消", "Cancel")} confirmLabel={text("移出申请进度", "Remove application")} description={text(`将删除 ${row.companyName} · ${row.title} 的申请时间线、材料和面试记录。岗位及其网页快照会保留，并重新出现在岗位推荐中。`, `This removes the application timeline, materials, and interviews for ${row.companyName} · ${row.title}. The job and its snapshots remain and return to discovery.`)} title={text("移出申请进度？", "Remove from pipeline?")} triggerLabel={text("删除申请记录", "Delete application record")} /></form></div>
            </div>
          ))}
          {optimisticRows.length === 0 ? <div className="table-empty-row">{text("还没有岗位加入申请进度。", "No jobs have been added to the pipeline yet.")}</div> : null}
        </section>
      )}
      {statusError ? <p className="form-error pipeline-status-error" role="alert">{statusError}</p> : null}
      {editing ? <ApplicationEditDialog error={editError} key={editing.applicationId} locale={locale} onClose={() => { if (!editPending) setEditing(null); }} onSave={saveDetails} row={editing} saving={editPending} /> : null}
      {managingStatuses ? <StatusManagerDialog locale={locale} onClose={() => setManagingStatuses(false)} statuses={statuses} /> : null}
    </div>
  );
}
