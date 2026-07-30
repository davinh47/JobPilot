import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { JobPreferencesForm } from "@/components/job-preferences-form";
import { db } from "@/db";
import { queryBatch } from "@/db/batch";
import { getCurrentUser } from "@/lib/current-user";
import { careerPreferences, jobSearchTargets } from "@/db/schema";
import { getLocale, pick } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const locale = await getLocale();
  const user = await getCurrentUser();
  const [preferenceRows, targets] = user ? await queryBatch([
    db.select().from(careerPreferences).where(eq(careerPreferences.userId, user.id)).limit(1),
    db.select().from(jobSearchTargets).where(eq(jobSearchTargets.userId, user.id)).orderBy(asc(jobSearchTargets.position)),
  ]) : [[], []];
  const preferences = preferenceRows[0];
  return (
    <div className="page-shell preferences-page">
      <Link className="back-link" href="/matches"><ChevronLeft size={16} />{pick(locale, "返回岗位发现", "Back to job discovery")}</Link>
      <header className="page-header compact-header"><div><p className="eyebrow">SEARCH PROFILE</p><h1>{pick(locale, "岗位搜索偏好", "Job search preferences")}</h1><p className="page-description">{pick(locale, "这些条件同时用于网络搜索、硬过滤和岗位匹配；用户设置始终优先于 AI 推断。", "These preferences drive web search, hard filters, and job matching. User settings always override AI inference.")}</p></div></header>
      <JobPreferencesForm locale={locale} preferences={{
        targets: targets.map((target) => {
          const savedLocations = target.locationPreferencesJson.length ? target.locationPreferencesJson : target.locationsJson.map((location) => ({ location, requiresVisaSponsorship: target.requiresVisaSponsorship, workAuthorizationNotes: target.workAuthorizationNotes ?? "" }));
          const editableLocations = savedLocations.length ? savedLocations : [{ location: "", requiresVisaSponsorship: false, workAuthorizationNotes: "" }];
          return {
            id: target.id,
            targetTitle: target.targetTitle,
            seniorityLevel: target.seniorityLevel,
            employmentType: target.employmentType,
            locations: editableLocations.map((location, index) => ({ id: `${target.id}-location-${index}`, ...location })),
            remotePreference: target.remotePreference,
            minimumSalary: target.minimumSalary,
            salaryCurrency: target.salaryCurrency,
            industries: target.industriesJson,
            companyAllowlist: target.companyAllowlistJson,
            companyBlocklist: target.companyBlocklistJson,
            excludedKeywords: target.excludedKeywordsJson,
            hardRequirements: target.hardRequirementsJson,
          };
        }), searchEnabled: preferences?.searchEnabled ?? false, searchFrequencyMinutes: preferences?.searchFrequencyMinutes ?? 1440,
      }} />
    </div>
  );
}
