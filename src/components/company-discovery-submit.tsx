"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useFormStatus } from "react-dom";

export function CompanyDiscoverySubmit({
  disabled,
  label,
  pendingLabel,
}: {
  disabled?: boolean;
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return <button className="button button-primary" disabled={disabled || pending} type="submit">
    {pending ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
    {pending ? pendingLabel : label}
  </button>;
}
