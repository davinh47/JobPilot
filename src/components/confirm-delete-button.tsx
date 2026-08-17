"use client";

import { useEffect, useId, useState } from "react";
import { EyeOff, Trash2, X } from "lucide-react";
import { useFormStatus } from "react-dom";

export function ConfirmDeleteButton({ triggerLabel, title, description, confirmLabel, cancelLabel, triggerStyle = "icon", confirmAction }: { triggerLabel: string; title: string; description: string; confirmLabel: string; cancelLabel: string; triggerStyle?: "icon" | "button" | "delete-button"; confirmAction?: (formData: FormData) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const { pending } = useFormStatus();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return <>
    <button aria-label={triggerLabel} className={triggerStyle === "icon" ? "icon-button delete-trigger" : `button button-secondary compact-button ${triggerStyle === "button" ? "ignore-job-button" : "delete-action-button"}`} onClick={() => setOpen(true)} title={triggerLabel} type="button">{triggerStyle === "button" ? <EyeOff size={15} /> : <Trash2 size={16} />}{triggerStyle === "icon" ? null : triggerLabel}</button>
    {open ? <div className="confirm-delete-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <div aria-labelledby={titleId} aria-modal="true" className="confirm-delete-dialog" role="dialog">
        <button aria-label={cancelLabel} className="icon-button confirm-delete-close" onClick={() => setOpen(false)} type="button"><X size={17} /></button>
        <span className="confirm-delete-icon"><Trash2 size={20} /></span>
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
        <div><button className="button button-secondary" disabled={pending} onClick={() => setOpen(false)} type="button">{cancelLabel}</button><button autoFocus className="button button-danger" disabled={pending} formAction={confirmAction} type="submit">{pending ? "..." : confirmLabel}</button></div>
      </div>
    </div> : null}
  </>;
}
