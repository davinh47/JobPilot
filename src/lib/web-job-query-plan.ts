import type { careerPreferences, companyRecommendations, jobSearchTargets, SearchMatrixItem } from "@/db/schema";
import { querySeniorityAffinity, senioritySearchTerms } from "@/lib/job-preference-match";

export function buildQueries(
  preferences: typeof careerPreferences.$inferSelect,
  targets: Array<typeof jobSearchTargets.$inferSelect>,
  companies: Array<typeof companyRecommendations.$inferSelect>,
  maxQueries: number,
  matrix: SearchMatrixItem[] | undefined,
) {
  const sanitize = (value: string) => value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, " ").replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, " ").replace(/["<>]/g, " ").replace(/\s+/g, " ").trim();
  const roleTargets = targets.length ? targets : preferences.targetTitlesJson.map((targetTitle, position) => ({ id: `legacy-${position}`, targetTitle, seniorityLevel: "any" as const, employmentType: "any" as const, locationsJson: preferences.locationsJson, remotePreference: preferences.remotePreference, minimumSalary: preferences.minimumSalary, salaryCurrency: preferences.salaryCurrency, industriesJson: preferences.industriesJson, companyAllowlistJson: preferences.companyAllowlistJson, companyBlocklistJson: preferences.companyBlocklistJson, excludedKeywordsJson: preferences.excludedKeywordsJson, requiresVisaSponsorship: preferences.requiresVisaSponsorship, workAuthorizationNotes: preferences.workAuthorizationNotes, hardRequirementsJson: preferences.hardRequirementsJson }));
  const primaryQueries: string[] = [];
  const locationFallbackQueries: string[] = [];
  const fallbackQueries: string[] = [];
  const targetQuery = (target: (typeof roleTargets)[number], location: string | undefined) => {
    const title = sanitize(target.targetTitle);
    if (!title) return "";
    const seniority = target.seniorityLevel === "any" ? [] : senioritySearchTerms([target.seniorityLevel]);
    const englishSeniority = seniority.filter((term) => /^[\x00-\x7F]+$/.test(term)).slice(0, 2).join(" ");
    const employment = ({ any: "", full_time: "full time", part_time: "part time", contract: "contract", temporary: "temporary", internship: "internship" } as const)[target.employmentType];
    const workplace = target.remotePreference === "any" ? "" : target.remotePreference;
    const industry = sanitize(target.industriesJson[0] ?? "");
    return `"${title}" ${englishSeniority ? `${englishSeniority} ` : ""}${employment ? `${employment} ` : ""}${workplace ? `${workplace} ` : ""}${location ? `"${location}" ` : ""}${industry ? `"${industry}" ` : ""}jobs careers`;
  };
  for (const target of roleTargets) {
    const locations = target.locationsJson.map(sanitize).filter(Boolean).slice(0, 3);
    const queryLocations = locations.length ? locations : [undefined];
    for (const location of queryLocations) {
      const query = targetQuery(target, location);
      if (query) primaryQueries.push(query);
    }
  }
  const rankedMatrix = (matrix ?? []).flatMap((item, index) => {
    const target = roleTargets.find((candidate) => candidate.id === item.targetId);
    if (!target || !item.platforms.includes("public_web")) return [];
    return [{ item, index, affinity: querySeniorityAffinity(item.query, target.seniorityLevel === "any" ? [] : [target.seniorityLevel]) }];
  }).filter(({ affinity }) => affinity >= 0).sort((a, b) => b.affinity - a.affinity || a.index - b.index);
  const matrixQueries = rankedMatrix.map(({ item }) => sanitize(item.query)).filter(Boolean);
  for (const target of roleTargets) {
    const title = sanitize(target.targetTitle);
    if (!title) continue;
    const locations = target.locationsJson.map(sanitize).filter(Boolean).slice(0, 3);
    const location = locations[0] ?? "";
    const seniorityTerms = target.seniorityLevel === "any" ? [] : senioritySearchTerms([target.seniorityLevel]);
    const englishSeniority = seniorityTerms.find((term) => /^[\x00-\x7F]+$/.test(term)) ?? "";
    const localSeniority = seniorityTerms.find((term) => !/^[\x00-\x7F]+$/.test(term)) ?? "";
    const queryLocations = locations.length ? locations : [""];
    for (const queryLocation of queryLocations) locationFallbackQueries.push(`${title} ${englishSeniority} ${queryLocation} jobs apply`);
    fallbackQueries.push(`${title} ${localSeniority} ${location} 招聘 职位`);
    fallbackQueries.push(`"${title}" ${location ? `"${location}" ` : ""}site:jobs.lever.co OR site:boards.greenhouse.io OR site:jobs.ashbyhq.com OR site:myworkdayjobs.com OR site:careers.smartrecruiters.com`);
    fallbackQueries.push(`${title} ${location} site:zhaopin.com OR site:nowcoder.com OR site:liepin.com OR site:zhipin.com`);
    fallbackQueries.push(`${title} ${location} hiring vacancies`);
    const company = sanitize(target.companyAllowlistJson[0] ?? "");
    if (company) fallbackQueries.push(`"${company}" "${title}" ${location ? `"${location}" ` : ""}careers jobs`);
  }
  void companies;
  const queryLimit = Math.max(maxQueries, roleTargets.length);
  return Array.from(new Set([...primaryQueries, ...locationFallbackQueries, ...fallbackQueries, ...matrixQueries].map((query) => query.replace(/\s+/g, " ").trim()).filter(Boolean))).slice(0, queryLimit);
}
