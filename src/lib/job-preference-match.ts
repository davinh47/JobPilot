type JobLike = {
  title: string;
  companyName: string;
  location: string | null;
  workplaceType: "remote" | "hybrid" | "onsite" | "unknown";
  employmentType?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  descriptionText: string;
};

export type JobSearchTargetLike = {
  id: string;
  targetTitle: string;
  seniorityLevel: "any" | "internship" | "entry" | "mid" | "senior" | "lead" | "executive";
  employmentType: "any" | "full_time" | "part_time" | "contract" | "temporary" | "internship";
  locationsJson?: string[];
  locationPreferencesJson?: Array<{
    location: string;
    requiresVisaSponsorship: boolean;
    workAuthorizationNotes: string;
  }>;
  remotePreference?: "any" | "remote" | "hybrid" | "onsite";
  minimumSalary?: number | null;
  salaryCurrency?: string;
  industriesJson?: string[];
  companyAllowlistJson?: string[];
  companyBlocklistJson?: string[];
  excludedKeywordsJson?: string[];
  requiresVisaSponsorship?: boolean;
  workAuthorizationNotes?: string | null;
  hardRequirementsJson?: string[];
};

export function locationPreferencesForTarget(target: JobSearchTargetLike | null) {
  if (!target) return [];
  if (target.locationPreferencesJson?.length) return target.locationPreferencesJson;
  return (target.locationsJson ?? []).map((location) => ({
    location,
    requiresVisaSponsorship: Boolean(target.requiresVisaSponsorship),
    workAuthorizationNotes: target.workAuthorizationNotes ?? "",
  }));
}

type PreferenceLike = {
  targetTitlesJson: string[];
  seniorityLevelsJson: string[];
  locationsJson: string[];
  excludedKeywordsJson: string[];
  companyBlocklistJson: string[];
  remotePreference: "any" | "remote" | "hybrid" | "onsite";
  jobSearchTargets?: JobSearchTargetLike[];
};

type SeniorityBand = "entry" | "mid" | "senior";

const SENIORITY_PATTERNS: Array<[SeniorityBand, RegExp]> = [
  ["senior", /\b(?:senior|sr\.?|lead|principal|staff|head|director|executive|vp|chief)\b|高级|资深|专家|负责人|主管|总监|首席/i],
  ["entry", /\b(?:junior|jr\.?|entry(?:[ -]?level)?|graduate|new grad|intern(?:ship)?)\b|初级|入门|应届|校招|毕业生|实习|助理/i],
  ["mid", /\b(?:mid(?:[ -]?level)?|intermediate)\b|中级/i],
];

function includesAny(value: string, terms: string[]) {
  const haystack = value.toLowerCase();
  return terms.some((term) => term.trim() && haystack.includes(term.trim().toLowerCase()));
}

const LOCATION_ALIASES = [
  ["北京", "beijing", "peking"],
  ["上海", "shanghai"],
  ["深圳", "shenzhen"],
  ["广州", "guangzhou", "canton"],
  ["香港", "hong kong", "hongkong", "hk"],
  ["悉尼", "sydney"],
  ["墨尔本", "melbourne"],
  ["布里斯班", "brisbane"],
  ["珀斯", "perth"],
  ["堪培拉", "canberra"],
  ["新加坡", "singapore"],
  ["澳大利亚", "澳洲", "australia"],
] as const;

function locationAliases(value: string) {
  const normalized = value.toLowerCase();
  const aliases = LOCATION_ALIASES.find((group) => group.some((alias) => normalized.includes(alias)));
  return aliases ?? [normalized];
}

function locationMatches(jobLocation: string, preferredLocation: string) {
  if (!jobLocation.trim() || !preferredLocation.trim()) return false;
  const jobAliases = locationAliases(jobLocation);
  const preferredAliases = locationAliases(preferredLocation);
  return jobAliases.some((jobAlias) => preferredAliases.some((preferredAlias) => jobAlias.includes(preferredAlias) || preferredAlias.includes(jobAlias)));
}

function hasExplicitLocation(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return Boolean(normalized) && !/^(?:unknown|not listed|not specified|unspecified|multiple locations|various locations|n\/a|未注明|未知|不限|多地|多个地点|全国)$/.test(normalized);
}

function titleContainsKnownLocation(value: string) {
  const normalized = value.toLowerCase();
  return LOCATION_ALIASES.some((group) => group.some((alias) => normalized.includes(alias)));
}

type RoleConcept = "ai" | "engineer" | "architect" | "data" | "scientist" | "product" | "design";

function roleConcepts(value: string) {
  const concepts = new Set<RoleConcept>();
  if (/\b(?:ai|ml)\b|artificial intelligence|machine learning|deep learning|generative ai|large language model|llm|人工智能|机器学习|深度学习|算法|大模型|智能体/i.test(value)) concepts.add("ai");
  if (/engineer|developer|engineering|工程师|开发/i.test(value)) concepts.add("engineer");
  if (/architect|architecture|建筑师|建筑设计/i.test(value)) concepts.add("architect");
  if (/\bdata\b|数据/i.test(value)) concepts.add("data");
  if (/scientist|科学家/i.test(value)) concepts.add("scientist");
  if (/product|产品/i.test(value)) concepts.add("product");
  if (/designer|design|设计师/i.test(value)) concepts.add("design");
  return concepts;
}

function roleTitleMatches(jobTitle: string, targetTitle: string) {
  if (includesAny(jobTitle, [targetTitle]) || includesAny(targetTitle, jobTitle.split(/\W+/).filter((word) => word.length > 3))) return true;
  const targetConcepts = roleConcepts(targetTitle);
  const jobConcepts = roleConcepts(jobTitle);
  return targetConcepts.size > 0 && [...targetConcepts].every((concept) => jobConcepts.has(concept));
}

function detectedSeniority(value: string) {
  return SENIORITY_PATTERNS.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
}

function preferredSeniorityBands(values: string[]) {
  return new Set(values.flatMap((value) => SENIORITY_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([band]) => band)));
}

export function senioritySearchTerms(values: string[]) {
  const bands = preferredSeniorityBands(values);
  return [
    ...(bands.has("entry") ? ["junior", "entry level", "graduate", "初级", "应届"] : []),
    ...(bands.has("mid") ? ["mid level", "intermediate", "中级"] : []),
    ...(bands.has("senior") ? ["senior", "lead", "principal", "高级", "资深"] : []),
  ];
}

export function querySeniorityAffinity(query: string, values: string[]) {
  const preferred = preferredSeniorityBands(values);
  if (!preferred.size) return 0;
  const detected = detectedSeniority(query);
  if (!detected) return 0;
  return preferred.has(detected) ? 2 : -1;
}

function employmentTypeMatches(value: string, expected: JobSearchTargetLike["employmentType"]) {
  if (expected === "any" || !value.trim()) return true;
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  const patterns: Record<Exclude<JobSearchTargetLike["employmentType"], "any">, RegExp> = {
    full_time: /full_?time|permanent|全职|正式/,
    part_time: /part_?time|兼职/,
    contract: /contract|freelance|合同|外包/,
    temporary: /temporary|temp|casual|临时/,
    internship: /intern|实习/,
  };
  return patterns[expected].test(normalized);
}

function matchAgainstTarget(job: JobLike, preference: PreferenceLike | undefined, target: JobSearchTargetLike | null, locale: "zh" | "en") {
  const titles = target ? [target.targetTitle] : preference?.targetTitlesJson ?? [];
  const locationPreferences = target
    ? locationPreferencesForTarget(target)
    : (preference?.locationsJson ?? []).map((location) => ({ location, requiresVisaSponsorship: false, workAuthorizationNotes: "" }));
  const locations = locationPreferences.map((location) => location.location);
  const excluded = target?.excludedKeywordsJson ?? preference?.excludedKeywordsJson ?? [];
  const blocked = target?.companyBlocklistJson ?? preference?.companyBlocklistJson ?? [];
  const preferredCompanies = target?.companyAllowlistJson ?? [];
  const industries = target?.industriesJson ?? [];
  const remotePreference = target?.remotePreference ?? preference?.remotePreference ?? "any";
  const preferredBands = preferredSeniorityBands(target && target.seniorityLevel !== "any" ? [target.seniorityLevel] : target ? [] : preference?.seniorityLevelsJson ?? []);
  const jobBand = detectedSeniority(job.title);
  const titleHit = !titles.length || titles.some((title) => roleTitleMatches(job.title, title));
  const locationEvidence = [job.location, job.title].filter(Boolean).join(" ");
  const remoteSignal = job.workplaceType === "remote" || /\bremote\b|远程/i.test(locationEvidence);
  const matchedLocationPreference = locationPreferences.find((location) => locationMatches(locationEvidence, location.location)) ?? null;
  const locationKnown = hasExplicitLocation(job.location) || titleContainsKnownLocation(job.title);
  const locationUnknown = locations.length > 0 && !matchedLocationPreference && !remoteSignal && !locationKnown;
  const locationHit = !locations.length || Boolean(matchedLocationPreference) || remoteSignal || locationUnknown;
  const requiresVisaSponsorship = matchedLocationPreference?.requiresVisaSponsorship ?? Boolean(target?.requiresVisaSponsorship);
  const workAuthorizationNotes = matchedLocationPreference?.workAuthorizationNotes || target?.workAuthorizationNotes || null;
  const effectiveWorkplaceType = job.workplaceType === "unknown" && remoteSignal ? "remote" : job.workplaceType;
  const workplaceUnknown = remotePreference !== "any" && effectiveWorkplaceType === "unknown";
  const remoteHit = remotePreference === "any" || remotePreference === effectiveWorkplaceType || workplaceUnknown;
  const seniorityHit = !preferredBands.size || !jobBand || preferredBands.has(jobBand);
  const employmentKnown = Boolean(job.employmentType?.trim());
  const employmentHit = !target || employmentTypeMatches(job.employmentType ?? "", target.employmentType);
  const excludedHit = includesAny(`${job.title}\n${job.descriptionText}`, excluded);
  const blockedHit = includesAny(job.companyName, blocked);
  const salaryKnown = job.salaryMax != null && Boolean(job.salaryCurrency);
  const salaryComparable = salaryKnown && target?.minimumSalary != null && job.salaryCurrency?.toUpperCase() === target.salaryCurrency?.toUpperCase();
  const salaryHit = !salaryComparable || (job.salaryMax ?? 0) >= (target?.minimumSalary ?? 0);
  const preferredCompanyHit = includesAny(job.companyName, preferredCompanies);
  const industryHit = includesAny(`${job.title}\n${job.descriptionText}`, industries);
  const passed = titleHit && locationHit && remoteHit && seniorityHit && employmentHit && salaryHit && !excludedHit && !blockedHit;
  const locationScore = !locations.length || matchedLocationPreference || remoteSignal ? 85 : locationUnknown ? 55 : 20;
  const locationPoints = locationScore >= 80 ? 15 : locationUnknown ? 8 : 0;
  const remotePoints = remotePreference === "any" || remotePreference === effectiveWorkplaceType ? 10 : workplaceUnknown ? 5 : 0;
  const score = Math.max(0, Math.min(100, (titleHit ? 35 : 5) + locationPoints + remotePoints + (seniorityHit ? 15 : 0) + (employmentHit ? 10 : 0) + (preferredCompanyHit ? 5 : 0) + (industryHit ? 5 : 0) + (job.descriptionText.length > 300 ? 10 : 5)));
  return {
    passed,
    score,
    locationScore,
    seniorityScore: !preferredBands.size || !jobBand ? 70 : seniorityHit ? 90 : 15,
    matchedTargetId: target?.id ?? null,
    matchedTargetTitle: target?.targetTitle ?? titles[0] ?? null,
    matchedLocation: matchedLocationPreference?.location ?? null,
    requiresVisaSponsorship,
    workAuthorizationNotes,
    gaps: [!titleHit ? (locale === "zh" ? "目标岗位名称" : "Target title") : "", !locationHit ? (locale === "zh" ? "目标地点" : "Location") : "", !remoteHit ? (locale === "zh" ? "办公方式偏好" : "Workplace preference") : "", !seniorityHit ? (locale === "zh" ? "职级要求" : "Seniority level") : "", !employmentHit ? (locale === "zh" ? "工作类型" : "Employment type") : "", !salaryHit ? (locale === "zh" ? "最低薪资" : "Minimum salary") : ""].filter(Boolean),
    uncertainties: [locationUnknown ? (locale === "zh" ? "岗位来源未提供可核验的工作地点" : "The job source does not provide a verifiable work location") : "", workplaceUnknown ? (locale === "zh" ? "岗位来源未提供可核验的办公方式" : "The job source does not provide a verifiable workplace type") : "", target?.minimumSalary != null && !salaryComparable ? (locale === "zh" ? "岗位未提供薪资，或薪资币种不同" : "Salary is missing or uses a different currency") : "", industries.length && !industryHit ? (locale === "zh" ? "暂时无法通过确定性规则确认行业" : "Industry could not be confirmed deterministically") : "", requiresVisaSponsorship ? (locale === "zh" ? "该地点的签证担保仍需核验来源" : "Visa sponsorship for this location requires source verification") : "", target?.hardRequirementsJson?.length ? (locale === "zh" ? "其他硬性要求仍需核验来源" : "Additional hard requirements require source verification") : "", locale === "zh" ? "技能匹配需要结合简历证据分析" : "Skills require resume evidence analysis", target?.employmentType !== "any" && !employmentKnown ? (locale === "zh" ? "岗位来源未提供工作类型" : "Employment type not supplied by this source") : ""].filter(Boolean),
  };
}

export function deterministicMatch(job: JobLike, preference: PreferenceLike | undefined, locale: "zh" | "en" = "en") {
  const targets = preference?.jobSearchTargets?.length ? preference.jobSearchTargets : [null];
  return targets.map((target) => matchAgainstTarget(job, preference, target, locale)).sort((a, b) => Number(b.passed) - Number(a.passed) || b.score - a.score)[0];
}

export function isAutomaticRecommendation(job: JobLike, preference: PreferenceLike | undefined, match: { overallScore: number; hardFilterPassed: boolean; modelName?: string | null; promptVersion?: string | null } | undefined) {
  const deterministic = deterministicMatch(job, preference);
  const deterministicOnlyMatch = match?.modelName == null && match?.promptVersion?.startsWith("deterministic-");
  return deterministic.passed && (deterministicOnlyMatch || match?.hardFilterPassed !== false);
}
