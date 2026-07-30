"use client";

import Link from "next/link";
import { ArrowUpRight, BriefcaseBusiness, LogIn, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { jobPlatforms } from "@/lib/platform-search";

type Props = {
  locale: "zh" | "en";
  targets: Array<{ id: string; targetTitle: string; seniorityLevel: "any" | "internship" | "entry" | "mid" | "senior" | "lead" | "executive"; locations: string[] }>;
};

export function PlatformSearchPanel({ locale, targets }: Props) {
  const availableTargets = targets.length ? targets : [{ id: "example", targetTitle: locale === "zh" ? "产品经理" : "Product Manager", seniorityLevel: "any" as const, locations: [] }];
  const [targetId, setTargetId] = useState(availableTargets[0].id);
  const [location, setLocation] = useState(availableTargets[0].locations[0] ?? "");
  const target = availableTargets.find((item) => item.id === targetId) ?? availableTargets[0];
  const availableLocations = target.locations.length ? target.locations : [""];
  const seniorityLabels = locale === "zh"
    ? { any: "不限", internship: "实习", entry: "初级", mid: "中级", senior: "高级", lead: "负责人", executive: "总监及以上" }
    : { any: "Any", internship: "Internship", entry: "Entry level", mid: "Mid level", senior: "Senior", lead: "Lead", executive: "Director+" };
  const searchTitle = `${target.targetTitle}${target.seniorityLevel === "any" ? "" : ` ${seniorityLabels[target.seniorityLevel]}`}`;
  const links = useMemo(() => jobPlatforms.map((platform) => ({ ...platform, href: platform.buildUrl(searchTitle, location) })), [searchTitle, location]);

  return (
    <section className="source-list-section platform-search-section">
      <div className="section-heading">
        <div><p className="eyebrow">JOB PLATFORMS</p><h2>{locale === "zh" ? "求职平台搜索" : "Job platform searches"}</h2></div>
        <Link className="button button-secondary" href="/jobs/new"><Plus size={16} />{locale === "zh" ? "导入找到的岗位" : "Import a found job"}</Link>
      </div>
      <div className="platform-search-toolbar">
        <label>{locale === "zh" ? "岗位目标" : "Role target"}<select value={targetId} onChange={(event) => { const nextId = event.target.value; const nextTarget = availableTargets.find((item) => item.id === nextId); setTargetId(nextId); setLocation(nextTarget?.locations[0] ?? ""); }}>{availableTargets.map((item) => <option key={item.id} value={item.id}>{item.targetTitle} · {seniorityLabels[item.seniorityLevel]}</option>)}</select></label>
        <label>{locale === "zh" ? "地点" : "Location"}<select value={location} onChange={(event) => setLocation(event.target.value)}>{availableLocations.map((item) => <option key={item || "anywhere"} value={item}>{item || (locale === "zh" ? "不限地点" : "Any location")}</option>)}</select></label>
      </div>
      <div className="platform-search-grid">
        {links.map((platform) => (
          <article key={platform.id}>
            <span className="platform-mark"><BriefcaseBusiness size={18} /></span>
            <div><h3>{platform.name}</h3><p>{locale === "zh" ? platform.marketsZh : platform.marketsEn}</p></div>
            <span className="platform-access">{platform.requiresLogin ? <LogIn size={13} /> : null}{locale === "zh" ? (platform.requiresLogin ? "需平台登录" : "平台搜索") : (platform.requiresLogin ? "Sign-in required" : "Platform search")}</span>
            <a className="icon-link" href={platform.href} target="_blank" rel="noreferrer" title={locale === "zh" ? `打开 ${platform.name}` : `Open ${platform.name}`}><ArrowUpRight size={17} /></a>
          </article>
        ))}
      </div>
      <p className="platform-search-note">{locale === "zh" ? "这些入口会在平台网站打开搜索，登录和浏览仍由你完成。JobPilot 不读取平台账号；找到合适岗位后，将链接和 JD 导入即可去重、匹配并跟踪申请。" : "These links open searches on each platform. You remain in control of sign-in and browsing; JobPilot never reads your platform account. Import the URL and description to deduplicate, match, and track a role."}</p>
    </section>
  );
}
