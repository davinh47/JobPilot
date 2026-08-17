import Link from "next/link";
import { ArrowRight, ClipboardPlus } from "lucide-react";
import type { Locale } from "@/lib/i18n";

export function EmptyState({ locale }: { locale: Locale }) {
  return (
    <section className="empty-state">
      <div className="empty-icon"><ClipboardPlus size={24} /></div>
      <h2>{locale === "zh" ? "从一个真实岗位开始" : "Start with a real job"}</h2>
      <p>{locale === "zh" ? "粘贴岗位链接和 JD，或等待 AI 自动发现符合监控条件的岗位。" : "Paste a job link and description, or let AI discovery find roles that match your watch criteria."}</p>
      <Link className="button button-primary" href="/jobs/new">{locale === "zh" ? "添加第一个岗位" : "Add your first job"} <ArrowRight size={16} /></Link>
    </section>
  );
}
