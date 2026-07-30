import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentRuns, appSettings, candidateProfiles, careerPreferences, companyRecommendations, jobSearchTargets, searchChecklistItems, searchPlans, type SearchMatrixItem, users } from "@/db/schema";
import { requestStructuredAiJson } from "@/lib/ai-provider";
import { jobPlatforms } from "@/lib/platform-search";
import { aiLanguageInstruction, localeFromStored } from "@/lib/i18n";
import { locationPreferencesForTarget } from "@/lib/job-preference-match";
import { selectAiModel } from "@/lib/ai-models";
import { promptVersion } from "@/lib/prompt-registry";

const platformSchema = z.enum(["public_web", "linkedin", "seek", "zhipin", "zhaopin", "51job", "liepin"]);
const strategySchema = z.object({
  strategySummary: z.string().min(20).max(1800),
  matrix: z.array(z.object({
    targetId: z.string().uuid(),
    label: z.string().min(2).max(100),
    query: z.string().min(2).max(180),
    rationale: z.string().min(8).max(500),
    priority: z.enum(["high", "medium", "low"]),
    locations: z.array(z.string().max(100)).max(5),
    platforms: z.array(platformSchema).min(1).max(7),
  })).min(4).max(16),
});

function sanitize(value: string, blocked: string[]) {
  let result = value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, " ").replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, " ").replace(/[<>]/g, " ");
  for (const term of blocked.filter((item) => item.trim().length >= 2)) result = result.replaceAll(term, " ");
  return result.replace(/\s+/g, " ").trim();
}

export async function generateSearchStrategy(userId: string) {
  const [user, settings, profile, preferences, targets, companies] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).get(),
    db.select().from(appSettings).where(eq(appSettings.userId, userId)).get(),
    db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId)).get(),
    db.select().from(careerPreferences).where(eq(careerPreferences.userId, userId)).get(),
    db.select().from(jobSearchTargets).where(eq(jobSearchTargets.userId, userId)).all(),
    db.select().from(companyRecommendations).where(eq(companyRecommendations.userId, userId)).orderBy(desc(companyRecommendations.confidence)).limit(12).all(),
  ]);
  if (!user || !settings?.aiEnabled) throw new Error("AI assistance is required to generate a search strategy.");
  const locale = localeFromStored(user.locale);
  if (!profile?.profileJson) throw new Error("Analyze the candidate profile first.");
  if (!preferences || (!targets.length && !preferences.targetTitlesJson.length)) throw new Error("Set at least one target role first.");
  const model = selectAiModel(settings, "lightweight");
  const versionName = promptVersion("searchStrategy");
  const run = await db.insert(agentRuns).values({ userId, runType: "search_strategy", status: "running", entityType: "candidate_profile", entityId: profile.id, modelProvider: settings.aiProvider, modelName: model, promptVersion: versionName, inputRefsJson: [{ type: "candidate_profile", id: profile.id }, { type: "career_preferences", id: preferences.id }], startedAt: new Date() }).returning().get();
  try {
    const result = await requestStructuredAiJson({
      userId,
      provider: settings.aiProvider,
      apiBaseUrl: settings.aiBaseUrl,
      model,
      agentRunId: run.id,
      taskType: "search_strategy",
      promptVersion: versionName,
      system: `You design a practical job-search query matrix. Return one JSON object only. Use only supplied candidate facts and preferences. Every matrix row must copy one supplied role target id into targetId and use only that target's title, seniority, employment type, locations, industries, companies, and hard requirements. Never combine criteria from different targets. Never introduce a higher seniority than requested. Queries must never contain a person's name, email, phone number, or other PII. For every role target, include at least two public_web query rows. Keep the supplied target title literal in each query so deterministic matching remains traceable; add useful English and location-local-language job-search terms around it instead of replacing it. Cover broad current-job searches, official careers pages, and public ATS domains. Keep each query usable in a web or job-board search box. public_web means JobPilot's automated public search; the other platform identifiers are fixed. ${aiLanguageInstruction(locale)}`,
      user: `<ROLE_TARGETS>\n${JSON.stringify(targets.map((target) => ({ id: target.id, title: target.targetTitle, seniority: target.seniorityLevel, employmentType: target.employmentType, locations: locationPreferencesForTarget(target).map((item) => item.location), remote: target.remotePreference, industries: target.industriesJson, preferredCompanies: target.companyAllowlistJson, blockedCompanies: target.companyBlocklistJson, excludedKeywords: target.excludedKeywordsJson })))}\n</ROLE_TARGETS>\n<VERIFIED_COMPANY_CANDIDATES>\n${JSON.stringify(companies.filter((company) => company.status !== "dismissed").map((company) => ({ name: company.companyName, status: company.status })))}\n</VERIFIED_COMPANY_CANDIDATES>\nCreate a focused query matrix with 6-12 rows. No resume text, candidate identity, contact details, work authorization, salary, or free-form context is supplied to this query-generation task.`,
      schema: strategySchema,
    });
    const blocked = [user.displayName, user.email ?? ""];
    const matrix: SearchMatrixItem[] = result.matrix.flatMap((item) => {
      const target = targets.find((candidate) => candidate.id === item.targetId);
      if (!target) return [];
      const query = sanitize(item.query, blocked);
      if (query.length < 2) return [];
      const allowedLocations = new Set(target.locationsJson.map((location) => location.toLowerCase()));
      const requestedLocations = item.locations.map((location) => sanitize(location, blocked)).filter((location) => location && (!allowedLocations.size || allowedLocations.has(location.toLowerCase())));
      return [{ ...item, id: randomUUID(), query, locations: requestedLocations.length ? requestedLocations : target.locationsJson.slice(0, 2) }];
    });
    if (matrix.length < 4) throw new Error("The generated search matrix did not contain enough PII-safe queries.");
    const plan = await db.transaction(async (tx) => {
      const savedPlan = await tx.insert(searchPlans).values({ userId, strategySummary: result.strategySummary, matrixJson: matrix, modelName: model, promptVersion: versionName }).returning().get();
      let created = 0;
      for (const item of matrix) {
        const targetLocations = Array.from(new Set(targets.flatMap((target) => target.locationsJson)));
        const locations = item.locations.length ? item.locations : targetLocations.length ? targetLocations.slice(0, 2) : [""];
        for (const platform of item.platforms) {
          for (const location of locations) {
            if (created >= 80) break;
            const platformConfig = jobPlatforms.find((candidate) => candidate.id === platform);
            const searchUrl = platform === "public_web" ? null : platformConfig?.buildUrl(item.query, location) ?? null;
            await tx.insert(searchChecklistItems).values({ searchPlanId: savedPlan.id, userId, matrixItemId: item.id, label: item.label, query: item.query, location: location || null, platform, searchUrl, priority: item.priority }).run();
            created += 1;
          }
        }
      }
      await tx.update(agentRuns).set({ status: "succeeded", outputJson: { strategySummary: result.strategySummary, matrix, checklistItems: created }, finishedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
      return savedPlan;
    });
    return plan;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown search strategy error";
    await db.update(agentRuns).set({ status: "failed", errorCode: "SEARCH_STRATEGY_ERROR", errorMessage: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
    throw error;
  }
}

export async function updateSearchChecklistItem(userId: string, input: { id: string; status: "pending" | "checked" | "skipped"; resultCount?: number | null; notes?: string | null }) {
  const item = await db.select().from(searchChecklistItems).where(and(eq(searchChecklistItems.id, input.id), eq(searchChecklistItems.userId, userId))).get();
  if (!item) throw new Error("Search checklist item was not found.");
  await db.update(searchChecklistItems).set({ status: input.status, checkedAt: input.status === "checked" ? new Date() : null, resultCount: input.resultCount ?? item.resultCount, notes: input.notes?.trim() || item.notes, updatedAt: new Date() }).where(eq(searchChecklistItems.id, item.id)).run();
}
