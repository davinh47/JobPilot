"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EyeOff, Trash2, X } from "lucide-react";
import { useFormStatus } from "react-dom";

export function ConfirmDeleteButton({ triggerLabel, title, description, confirmLabel, cancelLabel, triggerStyle = "icon", confirmAction }: { triggerLabel: string; title: string; description: string; confirmLabel: string; cancelLabel: string; triggerStyle?: "icon" | "button" | "delete-button"; confirmAction?: (formData: FormData) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { pending } = useFormStatus();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>(".button-secondary")?.focus();
    return () => { dialog?.close(); trigger?.focus(); };
  }, [open]);

  return <>
    <button ref={triggerRef} aria-label={triggerLabel} className={triggerStyle === "icon" ? "icon-button delete-trigger" : `button button-secondary compact-button ${triggerStyle === "button" ? "ignore-job-button" : "delete-action-button"}`} onClick={() => setOpen(true)} title={triggerLabel} type="button">{triggerStyle === "button" ? <EyeOff size={15} /> : <Trash2 size={16} />}{triggerStyle === "icon" ? null : triggerLabel}</button>
    {open ? <dialog ref={dialogRef} aria-labelledby={titleId} className="confirm-delete-dialog" onCancel={() => setOpen(false)} onClick={(event) => { if (event.currentTarget === event.target) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setOpen(false); } }}>
        <button aria-label={cancelLabel} className="icon-button confirm-delete-close" onClick={() => setOpen(false)} type="button"><X size={17} /></button>
        <span className="confirm-delete-icon"><Trash2 size={20} /></span>
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
        <div><button autoFocus className="button button-secondary" disabled={pending} onClick={() => setOpen(false)} type="button">{cancelLabel}</button><button className="button button-danger" disabled={pending} formAction={confirmAction} type="submit">{pending ? "..." : confirmLabel}</button></div>
    </dialog> : null}
  </>;
}
