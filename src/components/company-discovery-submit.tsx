"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useFormStatus } from "react-dom";

export function CompanyDiscoverySubmit({
  disabled,
  running,
  label,
  pendingLabel,
}: {
  disabled?: boolean;
  running?: boolean;
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  const active = pending || running;
  return <button className="button button-primary" disabled={disabled || active} type="submit">
    {active ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
    {active ? pendingLabel : label}
  </button>;
}
