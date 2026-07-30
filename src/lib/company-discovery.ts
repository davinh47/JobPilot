import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentRuns, appSettings, candidateProfiles, careerPreferences, companyRecommendations, jobSearchTargets, sourceConnectors, users } from "@/db/schema";
import { detectConnectorInHtml, detectConnectorUrl } from "@/lib/job-sources/detect";
import { requestAiWebJson, searchAiWeb } from "@/lib/ai-web-search";
import { selectAiModel } from "@/lib/ai-models";
import { fetchPublicPage } from "@/lib/public-web";
import { aiLanguageInstruction, localeFromStored, type Locale } from "@/lib/i18n";
import { locationPreferencesForTarget } from "@/lib/job-preference-match";
import { promptVersion } from "@/lib/prompt-registry";

export const companyDiscoveryLimits = {
  companiesPerTarget: 6,
  totalCompanies: 8,
  webSearchUses: 8,
  verificationResults: 10,
} as const;

const companyStrategySchema = z.object({
  strategySummary: z.string().min(10).max(1600),
  companies: z.array(z.object({
    name: z.string().min(2).max(120),
    reason: z.string().min(10).max(700),
    roleFamilies: z.array(z.string().min(2).max(100)).max(8),
    locations: z.array(z.string().min(2).max(100)).max(8),
    confidence: z.number().min(0).max(1),
    uncertainties: z.array(z.string().min(2).max(240)).max(6),
    officialWebsite: z.url(),
    careersUrl: z.url(),
    evidence: z.array(z.object({ url: z.url(), note: z.string().min(4).max(300) })).min(1).max(5),
  })).min(1).max(companyDiscoveryLimits.companiesPerTarget),
});

const NON_OFFICIAL_HOSTS = ["linkedin.com", "indeed.com", "glassdoor.com", "seek.com", "wikipedia.org", "crunchbase.com", "zhipin.com", "liepin.com", "51job.com"];
const PLACEHOLDER_HOSTS = ["example.com", "example.org", "example.net", "localhost"];
const PLACEHOLDER_TEXT = /^(?:no\s*data|unknown|n\/?a|none|not\s+available|example|placeholder|test\s+company|无数据|暂无|未知|示例(?:公司)?|占位)$/i;
const PLACEHOLDER_REASON = /(?:no\s+data|no\s+evidence|not\s+available|placeholder|search result contained no|无数据|暂无数据|没有(?:可用)?数据|未找到证据|占位)/i;

function normalizedCompany(value: string) {
  return value.toLowerCase()
    .replace(/\b(inc|corp|corporation|company|co|ltd|limited|group|plc|pty)\b/g, "")
    .replace(/(?:有限公司|股份有限公司|有限责任公司|集团|控股)$/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function sanitizePublicResearchText(value: string) {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[redacted]")
    .replace(/https?:\/\/\S+/gi, "[redacted]")
    .replace(/@[A-Za-z0-9_.-]{2,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function publicResearchTarget(target: {
  title: string;
  seniority: string;
  employmentType: string;
  locations: string[];
  remote: string;
  industries: string[];
  preferredCompanies: string[];
  blockedCompanies: string[];
}) {
  const cleanList = (values: string[], limit: number) => values
    .map(sanitizePublicResearchText)
    .filter((value) => value && value !== "[redacted]")
    .slice(0, limit);
  return {
    title: sanitizePublicResearchText(target.title),
    seniority: sanitizePublicResearchText(target.seniority),
    employmentType: sanitizePublicResearchText(target.employmentType),
    locations: cleanList(target.locations, 6),
    remote: sanitizePublicResearchText(target.remote),
    industries: cleanList(target.industries, 6),
    preferredCompanies: cleanList(target.preferredCompanies, 8),
    blockedCompanies: cleanList(target.blockedCompanies, 8),
  };
}

function plausibleResult(companyName: string, result: { title: string; url: string; description: string }) {
  const company = normalizedCompany(companyName);
  if (company.length < 2) return false;
  const haystack = normalizedCompany(`${new URL(result.url).hostname} ${result.title} ${result.description}`);
  return haystack.includes(company);
}

function organizationHost(value: string) {
  try {
    const parts = new URL(value).hostname.toLowerCase().replace(/^www\./, "").split(".");
    const usesCountrySuffix = parts.length >= 3 && parts.at(-1)?.length === 2 && ["com", "co", "net", "org"].includes(parts.at(-2) ?? "");
    return parts.slice(Math.max(0, parts.length - (usesCountrySuffix ? 3 : 2))).join(".");
  } catch {
    return "";
  }
}

function officialDomainResult(officialWebsite: string, resultUrl: string) {
  const official = organizationHost(officialWebsite);
  const result = organizationHost(resultUrl);
  return Boolean(official && result && official === result);
}

export function companyVerificationQuery(companyName: string, target: { title?: string; locations?: string[] } = {}) {
  const safeCompany = companyName.replace(/["<>]/g, "").trim();
  const title = target.title?.replace(/["<>]/g, "").trim();
  const locations = target.locations?.map((location) => location.replace(/["<>]/g, "").trim()).filter(Boolean).slice(0, 3) ?? [];
  return [
    `"${safeCompany}" official careers jobs`,
    title ? `"${safeCompany}" "${title}" careers jobs` : "",
    locations.length ? `"${safeCompany}" (${locations.map((location) => `"${location}"`).join(" OR ")}) careers jobs` : "",
    `"${safeCompany}" (site:boards.greenhouse.io OR site:job-boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com)`,
  ].filter(Boolean).join(" OR ");
}

export function isUsableCompanyCandidate(company: {
  name: string;
  reason: string;
  confidence: number;
  officialWebsite: string;
  careersUrl: string;
  evidence: Array<{ url: string; note: string }>;
}) {
  if (PLACEHOLDER_TEXT.test(company.name.trim()) || PLACEHOLDER_REASON.test(company.reason)) return false;
  if (!(company.confidence > 0)) return false;
  const urls = [company.officialWebsite, company.careersUrl, ...company.evidence.map((item) => item.url)];
  if (urls.some((value) => {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return PLACEHOLDER_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
    } catch {
      return true;
    }
  })) return false;
  return company.evidence.some((item) => !PLACEHOLDER_REASON.test(item.note));
}

async function verifyCompany(
  userId: string,
  company: z.infer<typeof companyStrategySchema>["companies"][number],
  locale: Locale,
  target: { title?: string; locations?: string[] },
  agentRunId: string,
  requireConnector = false,
) {
  const supplied = [
    { title: `${company.name} careers`, url: company.careersUrl, description: company.reason, searchVerified: false },
    ...company.evidence.map((item) => ({ title: `${company.name} careers evidence`, url: item.url, description: item.note, searchVerified: false })),
  ];
  async function verify(results: Array<{ title: string; url: string; description: string; searchVerified: boolean }>) {
    for (const result of results) {
      let parsedUrl: URL;
      try { parsedUrl = new URL(result.url); } catch { continue; }
      const host = parsedUrl.hostname.toLowerCase();
      if (NON_OFFICIAL_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) continue;
      if (!plausibleResult(company.name, result)) continue;
      const direct = detectConnectorUrl(result.url);
      try {
        const page = await fetchPublicPage(result.url);
        if (page.status < 200 || page.status >= 400 || !page.contentType.includes("html")) throw new Error("Careers page did not return readable HTML.");
        if (!plausibleResult(company.name, { title: result.title, url: page.url, description: `${result.description} ${page.text.slice(0, 60_000)}` })) throw new Error("Careers page did not preserve enough company identity.");
        const connector = direct ?? detectConnectorInHtml(page.text, page.url);
        if (requireConnector && !connector) continue;
        return {
          officialWebsite: company.officialWebsite,
          careersUrl: page.url,
          connector,
          evidence: [...company.evidence, { url: page.url, note: connector ? (locale === "zh" ? `JobPilot 已读取实时招聘页面并识别出 ${connector.provider}。` : `JobPilot fetched the live careers page and detected ${connector.provider}.`) : (locale === "zh" ? "JobPilot 已读取实时官方招聘页面，并将其加入自动网络发现。" : "JobPilot fetched the live official careers page and added it to automatic web discovery.") }],
        };
      } catch {
        if (!result.searchVerified) continue;
        if (!direct && !officialDomainResult(company.officialWebsite, result.url)) continue;
        if (requireConnector && !direct) continue;
        return {
          officialWebsite: company.officialWebsite,
          careersUrl: result.url,
          connector: direct,
          evidence: [...company.evidence, {
            url: result.url,
            note: direct
              ? (locale === "zh" ? `原生联网搜索已确认该公司的公开 ${direct.provider} 招聘页；页面阻止了常规抓取。` : `Native web search confirmed the company's public ${direct.provider} board; the page blocked a regular fetch.`)
              : (locale === "zh" ? "原生联网搜索已确认该公司官方域名下的招聘页；页面阻止了常规抓取。" : "Native web search confirmed a careers page on the company's official domain; the page blocked a regular fetch."),
          }],
        };
      }
    }
    return null;
  }
  const direct = await verify(supplied);
  if (direct) return direct;
  const searched = await searchAiWeb(userId, companyVerificationQuery(company.name, target), {
    count: companyDiscoveryLimits.verificationResults,
    agentRunId,
    promptVersion: promptVersion("companyResearch"),
  }).catch(() => []);
  return verify(searched.map((result) => ({ ...result, searchVerified: true })));
}

export type CompanyDiscoveryMode = "recommend" | "connect";

export function companyDiscoveryDisposition(
  mode: CompanyDiscoveryMode,
  hasConnector: boolean,
  existingStatus?: (typeof companyRecommendations.$inferSelect)["status"],
) {
  if (mode === "connect" && !hasConnector) return { include: false, connect: false, status: "verified" as const };
  const connect = mode === "connect" && hasConnector;
  const status = connect
    ? "connected" as const
    : existingStatus === "connected" || existingStatus === "dismissed"
      ? existingStatus
      : "verified" as const;
  return { include: true, connect, status };
}

export async function discoverCompanies(userId: string, mode: CompanyDiscoveryMode = "recommend") {
  const [user, settings, profile, preferences, targets] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).get(),
    db.select().from(appSettings).where(eq(appSettings.userId, userId)).get(),
    db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId)).get(),
    db.select().from(careerPreferences).where(eq(careerPreferences.userId, userId)).get(),
    db.select().from(jobSearchTargets).where(eq(jobSearchTargets.userId, userId)).all(),
  ]);
  const locale = localeFromStored(user?.locale);
  if (!settings?.aiEnabled) throw new Error("AI assistance is disabled.");
  if (settings.aiProvider !== "openai" && settings.aiProvider !== "deepseek") throw new Error("The selected AI provider does not support live web search.");
  if (!profile?.profileJson || !profile.analyzedAt) throw new Error("Analyze the candidate profile before discovering companies.");
  if (!preferences || (!targets.length && !preferences.targetTitlesJson.length)) throw new Error("At least one target role is required.");
  const model = selectAiModel(settings, "web");

  const run = await db.insert(agentRuns).values({
    userId,
    runType: "company_research",
    status: "running",
    entityType: "candidate_profile",
    entityId: profile.id,
    modelProvider: settings.aiProvider,
    modelName: model,
    promptVersion: promptVersion("companyResearch"),
    inputRefsJson: [{ type: "candidate_profile", id: profile.id }, { type: "career_preferences", id: preferences.id }],
    outputJson: { mode },
    startedAt: new Date(),
  }).returning().get();

  try {
    const roleTargets = targets.length ? targets.slice(0, 4).map((target) => ({
      title: target.targetTitle,
      seniority: target.seniorityLevel,
      employmentType: target.employmentType,
      locations: locationPreferencesForTarget(target).map((location) => location.location),
      remote: target.remotePreference,
      minimumSalary: target.minimumSalary,
      salaryCurrency: target.salaryCurrency,
      industries: target.industriesJson,
      preferredCompanies: target.companyAllowlistJson,
      blockedCompanies: target.companyBlocklistJson,
      excludedKeywords: target.excludedKeywordsJson,
      hardRequirements: target.hardRequirementsJson,
    })) : preferences.targetTitlesJson.slice(0, 4).map((title) => ({
      title,
      seniority: preferences.seniorityLevelsJson.join(", "),
      employmentType: preferences.employmentTypesJson.join(", "),
      locations: preferences.locationsJson,
      remote: preferences.remotePreference,
      minimumSalary: preferences.minimumSalary,
      salaryCurrency: preferences.salaryCurrency,
      industries: preferences.industriesJson,
      preferredCompanies: preferences.companyAllowlistJson,
      blockedCompanies: preferences.companyBlocklistJson,
      excludedKeywords: preferences.excludedKeywordsJson,
      hardRequirements: preferences.hardRequirementsJson,
    }));
    const discovered: Array<{ company: z.infer<typeof companyStrategySchema>["companies"][number]; target: { title: string; locations: string[] } }> = [];
    const summaries: string[] = [];
    const discoveryErrors: string[] = [];
    for (const target of roleTargets) {
      try {
        const strategy = await requestAiWebJson({
          userId,
          schema: companyStrategySchema,
          searchContextSize: "high",
          maxUses: companyDiscoveryLimits.webSearchUses,
          agentRunId: run.id,
          promptVersion: promptVersion("companyResearch"),
          input: mode === "connect"
            ? `You are JobPilot's company-source connector. Search the live web before returning every result. Focus only on the one supplied role target. Find up to ${companyDiscoveryLimits.companiesPerTarget} realistic employers that have a current public job board hosted on Greenhouse (boards.greenhouse.io or job-boards.greenhouse.io), Lever (jobs.lever.co), or Ashby (jobs.ashbyhq.com), relevant to this role and at least one target location. The careersUrl and at least one evidence URL must be the exact public ATS board URL, not merely a corporate careers homepage. Exclude employers whose only verified page uses Workday, SmartRecruiters, a proprietary site, or another unsupported system. Do not include aggregators, staffing agencies, placeholders, or companies supported only by model memory. The role target is an allowlisted, redacted search context. Never infer or request candidate identity. ${aiLanguageInstruction(locale)}\n\n<PUBLIC_ROLE_TARGET>\n${JSON.stringify(publicResearchTarget(target))}\n</PUBLIC_ROLE_TARGET>`
            : `You are JobPilot's company research analyst. Search the live web before making every recommendation. Focus only on the one supplied role target; do not mix it with other preferences. Find up to ${companyDiscoveryLimits.companiesPerTarget} varied, realistic employers with a current official careers page relevant to this role and at least one target location. Search in English and the location's local language where useful. Prefer evidence from official company domains and public ATS boards. Do not include job boards, staffing agencies, placeholders, or companies supported only by model memory. Do not claim active hiring, location, salary, sponsorship, or ATS facts unless a current cited page supports it; place unresolved facts in uncertainties. The role target is an allowlisted, redacted search context. Never infer or request candidate identity. ${aiLanguageInstruction(locale)}\n\n<PUBLIC_ROLE_TARGET>\n${JSON.stringify(publicResearchTarget(target))}\n</PUBLIC_ROLE_TARGET>`,
        });
        summaries.push(strategy.strategySummary);
        discovered.push(...strategy.companies.filter(isUsableCompanyCandidate).map((company) => ({
          company,
          target: { title: target.title, locations: target.locations },
        })));
      } catch (error) {
        discoveryErrors.push(error instanceof Error ? error.message : "Unknown target search error");
      }
    }
    const uniqueCompanies = Array.from(
      new Map(discovered.map((item) => [normalizedCompany(item.company.name), item])).values(),
    ).slice(0, companyDiscoveryLimits.totalCompanies);
    if (!uniqueCompanies.length) {
      const detail = discoveryErrors.find(Boolean);
      throw new Error(`Live web search returned no source-grounded company candidates${detail ? `: ${detail}` : "."}`);
    }
    const strategy = {
      strategySummary: summaries.join("\n\n").slice(0, 4000),
      companies: uniqueCompanies.map((item) => item.company),
    };
    let verified = 0;
    let connected = 0;
    for (const item of uniqueCompanies) {
      const company = item.company;
      const verification = await verifyCompany(userId, company, locale, item.target, run.id, mode === "connect");
      if (!verification) continue;
      const existing = await db.select({ status: companyRecommendations.status }).from(companyRecommendations).where(and(
        eq(companyRecommendations.userId, userId),
        eq(companyRecommendations.companyName, company.name.trim()),
      )).get();
      const disposition = companyDiscoveryDisposition(mode, Boolean(verification.connector), existing?.status);
      if (!disposition.include) continue;
      verified += 1;
      const { connect: shouldConnect, status } = disposition;
      if (shouldConnect && verification.connector) {
        await db.insert(sourceConnectors).values({
          userId,
          provider: verification.connector.provider,
          name: company.name,
          boardToken: verification.connector.boardToken,
          region: verification.connector.region,
        }).onConflictDoUpdate({
          target: [sourceConnectors.userId, sourceConnectors.provider, sourceConnectors.boardToken],
          set: { name: company.name, region: verification.connector.region, enabled: true, updatedAt: new Date() },
        }).run();
        connected += 1;
      }
      await db.insert(companyRecommendations).values({
        userId,
        companyName: company.name.trim(),
        reason: company.reason,
        roleFamiliesJson: company.roleFamilies,
        locationsJson: company.locations,
        confidence: company.confidence,
        uncertaintiesJson: company.uncertainties,
        status,
        officialWebsite: verification.officialWebsite,
        careersUrl: verification.careersUrl,
        atsProvider: verification.connector?.provider ?? null,
        boardToken: verification.connector?.boardToken ?? null,
        verificationEvidenceJson: verification.evidence,
        verifiedAt: new Date(),
      }).onConflictDoUpdate({
        target: [companyRecommendations.userId, companyRecommendations.companyName],
        set: { reason: company.reason, roleFamiliesJson: company.roleFamilies, locationsJson: company.locations, confidence: company.confidence, uncertaintiesJson: company.uncertainties, status, officialWebsite: verification.officialWebsite, careersUrl: verification.careersUrl, atsProvider: verification.connector?.provider ?? null, boardToken: verification.connector?.boardToken ?? null, verificationEvidenceJson: verification.evidence, verifiedAt: new Date(), updatedAt: new Date() },
      }).run();
    }
    const output = { ...strategy, mode, verification: { enabled: true, verified, connected } };
    if (mode === "connect" && !connected) {
      await db.update(agentRuns).set({ outputJson: output, updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
      throw new Error("No supported Greenhouse, Lever, or Ashby company source could be verified and connected.");
    }
    if (mode === "recommend" && !verified) {
      await db.update(agentRuns).set({ outputJson: output, updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
      throw new Error(`Found ${uniqueCompanies.length} source-grounded company candidate(s), but their official careers pages could not be confirmed after target-specific verification.`);
    }
    await db.update(agentRuns).set({ status: "succeeded", outputJson: output, finishedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown company discovery error";
    await db.update(agentRuns).set({ status: "failed", errorCode: "COMPANY_DISCOVERY_ERROR", errorMessage: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
    throw error;
  }
}
