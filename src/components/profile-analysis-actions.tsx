"use client";

import { LoaderCircle, Save, Sparkles } from "lucide-react";
import { useFormStatus } from "react-dom";
import { saveProfileContextAction } from "@/app/profile/actions";

export function ProfileAnalysisActions({
  analyzeLabel,
  analyzePendingLabel,
  canAnalyze,
  saveLabel,
  savePendingLabel,
}: {
  analyzeLabel: string;
  analyzePendingLabel: string;
  canAnalyze: boolean;
  saveLabel: string;
  savePendingLabel: string;
}) {
  const { data, pending } = useFormStatus();
  const intent = pending ? data?.get("profileAction") : null;
  const isAnalyzing = intent === "analyze";
  const isSaving = intent === "save";

  return <div className="profile-analysis-actions">
    <button
      className="button button-secondary"
      disabled={pending}
      formAction={saveProfileContextAction}
      name="profileAction"
      type="submit"
      value="save"
    >
      {isSaving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
      {isSaving ? savePendingLabel : saveLabel}
    </button>
    <button
      className="button button-primary"
      disabled={!canAnalyze || pending}
      name="profileAction"
      type="submit"
      value="analyze"
    >
      {isAnalyzing ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
      {isAnalyzing ? analyzePendingLabel : analyzeLabel}
    </button>
  </div>;
}
