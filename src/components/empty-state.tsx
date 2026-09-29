import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, SlidersHorizontal } from "lucide-react";
import type { Locale } from "@/lib/i18n";

export function EmptyState({ locale, filtered = false, resetHref = "/matches" }: { locale: Locale; filtered?: boolean; resetHref?: string }) {
  return (
    <section className="empty-state">
      <span className="empty-icon" aria-hidden="true">{filtered ? <SlidersHorizontal size={24} /> : <BriefcaseBusiness size={24} />}</span>
      <h2>{filtered ? (locale === "zh" ? "当前筛选下没有岗位" : "No roles match this filter") : (locale === "zh" ? "从一个真实岗位开始" : "Start with a real job")}</h2>
      <p>{filtered ? (locale === "zh" ? "试试查看全部岗位，或调整求职条件。已有岗位和申请记录不会受到影响。" : "View all roles or adjust your search criteria. Your saved jobs and applications are unchanged.") : (locale === "zh" ? "粘贴岗位链接和 JD，或在来源与自动化中开始搜索。" : "Paste a job link and description, or start a search in Sources & automation.")}</p>
      <Link className="button button-primary" href={filtered ? resetHref : "/jobs/new"}>{filtered ? (locale === "zh" ? "查看全部岗位" : "View all roles") : (locale === "zh" ? "添加第一个岗位" : "Add your first job")} <ArrowRight size={16} /></Link>
    </section>
  );
}
