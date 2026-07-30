import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, appSettings, careerPreferences, companyRecommendations, jobMatches, jobSearchTargets, jobs, notifications, searchChecklistItems, searchPlans, users } from "@/db/schema";
import { searchAiWeb } from "@/lib/ai-web-search";
import { canExtractJobCandidate, extractJobCandidateFromTextWithAi, isPotentialJobSearchResult } from "@/lib/job-candidate-extractor";
import { saveSearchDiscoveredJob } from "@/lib/job-discovery";
import { analyzeJobMatchById } from "@/lib/job-match-ai";
import { extractJobFromPage, isLikelySpecificJobPage, parseJobPostings } from "@/lib/job-page-parser";
import { extractReadableText, fetchPublicPage } from "@/lib/public-web";
import { queueSearchReindex } from "@/lib/background-queue";
import { localeFromStored } from "@/lib/i18n";
import { generateSearchStrategy } from "@/lib/search-strategy";
import { classifyListingPage } from "@/lib/listing-check";
import { promptVersion } from "@/lib/prompt-registry";
import { selectAiModel } from "@/lib/ai-models";
import { isCloudDeployment } from "@/lib/deployment";
import {
  collectDiverseCandidates,
  mapWithConcurrency,
  recordPipelineError,
  type PipelineErrorBreakdown,
} from "@/lib/web-job-search-pipeline";
import { buildQueries } from "@/lib/web-job-query-plan";
import { deterministicMatch } from "@/lib/job-preference-match";

export { buildQueries };

const BLOCKED_SEARCH_HOSTS = ["linkedin.com", "seek.com", "zhipin.com", "liepin.com", "51job.com", "indeed.com", "glassdoor.com", "careerjet.com", "career-jet.cn", "jooble.org", "talent.com", "simplyhired.com", "ziprecruiter.com"];

export function webSearchExecutionLimits(cloudDeployment: boolean, provider: "openai" | "deepseek" = "openai") {
  if (!cloudDeployment) return { budgetMs: Number.POSITIVE_INFINITY, maxQueries: 6, maxUrls: 36, maxAiExtractions: 8, maxAiMatches: Number.POSITIVE_INFINITY, searchTimeoutMs: 180_000, pageTimeoutMs: 30_000, aiTimeoutMs: 120_000, searchConcurrency: 3, pageConcurrency: 6, aiExtractionConcurrency: 1, aiMatchConcurrency: 1 };
  if (provider === "deepseek") return { budgetMs: 250_000, maxQueries: 6, maxUrls: 36, maxAiExtractions: 10, maxAiMatches: 6, searchTimeoutMs: 90_000, pageTimeoutMs: 10_000, aiTimeoutMs: 45_000, searchConcurrency: 3, pageConcurrency: 6, aiExtractionConcurrency: 2, aiMatchConcurrency: 2 };
  return { budgetMs: 250_000, maxQueries: 6, maxUrls: 36, maxAiExtractions: 10, maxAiMatches: 6, searchTimeoutMs: 65_000, pageTimeoutMs: 10_000, aiTimeoutMs: 40_000, searchConcurrency: 3, pageConcurrency: 6, aiExtractionConcurrency: 2, aiMatchConcurrency: 2 };
}

export function collectSearchCandidates<T extends { url: string }>(resultSets: T[][], maxUrls: number) {
  return collectDiverseCandidates(resultSets, maxUrls);
}

export async function runWebJobSearch(userId: string) {
  const [user, settings, preferences, targets, companies, storedPlan] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).get(),
    db.select().from(appSettings).where(eq(appSettings.userId, userId)).get(),
    db.select().from(careerPreferences).where(eq(careerPreferences.userId, userId)).get(),
    db.select().from(jobSearchTargets).where(eq(jobSearchTargets.userId, userId)).all(),
    db.select().from(companyRecommendations).where(and(eq(companyRecommendations.userId, userId), ne(companyRecommendations.status, "dismissed"))).orderBy(desc(companyRecommendations.confidence)).all(),
    db.select().from(searchPlans).where(eq(searchPlans.userId, userId)).orderBy(desc(searchPlans.createdAt)).limit(1).get(),
  ]);
  const locale = localeFromStored(user?.locale);
  if (!settings?.aiEnabled || (settings.aiProvider !== "deepseek" && settings.aiProvider !== "openai")) throw new Error("Automatic job discovery requires an enabled AI provider.");
  if (!preferences || (!targets.length && !preferences.targetTitlesJson.length)) throw new Error("At least one target role is required.");
  const limits = webSearchExecutionLimits(isCloudDeployment, settings.aiProvider);
  const deadline = Date.now() + limits.budgetMs;
  const remainingMs = () => deadline - Date.now();
  const canStart = (reserveMs: number) => remainingMs() > reserveMs;
  const boundedTimeout = (requestedMs: number, reserveMs: number) => Number.isFinite(limits.budgetMs)
    ? Math.max(1_000, Math.min(requestedMs, remainingMs() - reserveMs))
    : requestedMs;
  let latestPlan = storedPlan;
  let strategyGenerated = false;
  if (!latestPlan && !isCloudDeployment) {
    latestPlan = await generateSearchStrategy(userId).catch(() => undefined);
    strategyGenerated = Boolean(latestPlan);
  }
  const effectiveQueryLimit = settings.aiProvider === "deepseek" ? 6 : Math.max(1, Math.min(settings.webSearchMaxQueries, 6));
  const queries = buildQueries(preferences, targets, companies, effectiveQueryLimit, latestPlan?.matrixJson).slice(0, limits.maxQueries);
  const searchProvider = settings.aiProvider === "openai" ? "openai_hosted" : "deepseek_hosted";
  const extractionModel = selectAiModel(settings, "lightweight");
  const run = await db.insert(agentRuns).values({ userId, runType: "web_job_search", status: "running", entityType: "career_preferences", entityId: preferences.id, modelProvider: settings.aiProvider, modelName: extractionModel, promptVersion: promptVersion("jobExtraction"), inputRefsJson: [{ type: "career_preferences", id: preferences.id }, ...(latestPlan ? [{ type: "search_plan", id: latestPlan.id }] : [])], startedAt: new Date() }).returning().get();
  const searchResultSets: Array<Awaited<ReturnType<typeof searchAiWeb>>> = [];
  const aiCandidates = new Map<string, { jobId: string; score: number; created: boolean }>();
  let pagesInspected = 0;
  let pageFetchFailures = 0;
  let unreadablePages = 0;
  let parsedPostings = 0;
  let added = 0;
  let updated = 0;
  let searchesSucceeded = 0;
  let searchErrors = 0;
  let searchResults = 0;
  let parseFailures = 0;
  let aiExtractionAttempts = 0;
  let aiExtractedPostings = 0;
  let aiExtractionErrors = 0;
  let aiMatchErrors = 0;
  let snippetCandidatesInspected = 0;
  let expiredPagesSkipped = 0;
  let aiMatched = 0;
  let budgetExhausted = false;
  let lastSearchError: unknown;
  const errorBreakdown: PipelineErrorBreakdown = {};
  const executedQueries: string[] = [];
  try {
    const [storedJobs, storedMatches] = await Promise.all([
      db.select().from(jobs).where(eq(jobs.ownerUserId, userId)).all(),
      db.select().from(jobMatches).where(eq(jobMatches.userId, userId)).all(),
    ]);
    const storedMatchByJobId = new Map(storedMatches.map((match) => [match.jobId, match]));
    await db.transaction(async (tx) => {
      for (const storedJob of storedJobs) {
        const storedMatch = storedMatchByJobId.get(storedJob.id);
        if (!storedMatch || storedMatch.modelName) continue;
        const result = deterministicMatch(storedJob, { ...preferences, jobSearchTargets: targets }, locale);
        await tx.update(jobMatches).set({
          matchedTargetId: result.matchedTargetId,
          overallScore: result.score,
          skillsScore: result.score,
          responsibilitiesScore: result.score,
          seniorityScore: result.seniorityScore,
          locationScore: result.locationScore,
          hardFilterPassed: result.passed,
          gapsJson: result.gaps,
          uncertaintiesJson: result.uncertainties,
          promptVersion: "deterministic-v5",
        }).where(eq(jobMatches.id, storedMatch.id)).run();
      }
    });
    const rememberPostings = async (postings: Awaited<ReturnType<typeof parseJobPostings>>) => {
      parsedPostings += postings.length;
      for (const posting of postings) {
        const saved = await saveSearchDiscoveredJob(userId, posting, searchProvider === "openai_hosted" ? "OpenAI hosted web search" : "DeepSeek hosted web search");
        if (saved.ignored || !saved.jobId) continue;
        if (saved.hardFilterPassed) {
          const prior = aiCandidates.get(saved.jobId);
          aiCandidates.set(saved.jobId, { jobId: saved.jobId, score: Math.max(saved.score, prior?.score ?? 0), created: saved.created || prior?.created || false });
        }
      }
    };
    const searchOutcomes = await mapWithConcurrency(queries, limits.searchConcurrency, async (query) => {
      if (!canStart(45_000)) return { query, status: "budget_limited" as const };
      try {
        const results = await searchAiWeb(userId, query, {
          count: settings.aiProvider === "deepseek" ? 10 : 8,
          agentRunId: run.id,
          promptVersion: promptVersion("jobExtraction"),
          timeoutMs: boundedTimeout(limits.searchTimeoutMs, 40_000),
          mode: "job_listings",
        });
        return { query, status: "succeeded" as const, results };
      } catch (error) {
        return { query, status: "failed" as const, error };
      }
    });
    for (const outcome of searchOutcomes) {
      if (outcome.status === "budget_limited") {
        budgetExhausted = true;
        continue;
      }
      executedQueries.push(outcome.query);
      if (outcome.status === "failed") {
        searchErrors += 1;
        lastSearchError = outcome.error;
        recordPipelineError(errorBreakdown, outcome.error);
        continue;
      }
      searchesSucceeded += 1;
      searchResults += outcome.results.length;
      searchResultSets.push(outcome.results);
    }
    if (!searchesSucceeded && lastSearchError) throw lastSearchError;

    const candidates = collectSearchCandidates(searchResultSets, limits.maxUrls);
    type SearchResult = (typeof candidates)[number];
    type ExtractionCandidate = { url: string; result: SearchResult; sourceText: string; source: "page" | "snippet" };
    const blockedCandidates = candidates.filter((result) => {
      const host = new URL(result.url).hostname.toLowerCase();
      return BLOCKED_SEARCH_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
    });
    const pageCandidates = candidates.filter((result) => !blockedCandidates.includes(result));
    const snippetFallbacks = new Map<string, SearchResult>();
    for (const result of blockedCandidates) snippetFallbacks.set(result.url, result);
    const fetchedPages = await mapWithConcurrency(pageCandidates, limits.pageConcurrency, async (result) => {
      if (!canStart(15_000)) return { result, page: null, budgetLimited: true };
      try {
        const page = await fetchPublicPage(result.url, 0, boundedTimeout(limits.pageTimeoutMs, 12_000));
        return { result, page, budgetLimited: false };
      } catch (error) {
        recordPipelineError(errorBreakdown, error);
        return { result, page: null, budgetLimited: false };
      }
    });
    if (fetchedPages.some((item) => item.budgetLimited)) budgetExhausted = true;
    const pageFallbacks: ExtractionCandidate[] = [];
    for (const { result, page } of fetchedPages) {
      if (!page) {
        pageFetchFailures += 1;
        snippetFallbacks.set(result.url, result);
        continue;
      }
      pagesInspected += 1;
      if (page.status < 200 || page.status >= 400 || !page.contentType.includes("html")) {
        unreadablePages += 1;
        snippetFallbacks.set(result.url, result);
        continue;
      }
      if (classifyListingPage(page, "unknown").status === "expired") {
        expiredPagesSkipped += 1;
        continue;
      }
      const structuredPostings = parseJobPostings(page.text, page.url);
      const fallback = structuredPostings.length ? null : extractJobFromPage(page.text, page.url);
      const postings = structuredPostings.length ? structuredPostings : fallback && isLikelySpecificJobPage(fallback) ? [fallback] : [];
      if (!postings.length && isPotentialJobSearchResult(result)) {
        const readable = extractReadableText(page.text, page.url);
        const sourceText = [result.title, result.description, readable?.title, readable?.siteName, fallback?.descriptionText ?? readable?.text].filter(Boolean).join("\n");
        pageFallbacks.push({ url: result.url, result, sourceText, source: "page" });
      }
      if (!postings.length) parseFailures += 1;
      await rememberPostings(postings);
    }
    const snippetExtractionCandidates: ExtractionCandidate[] = Array.from(snippetFallbacks.values())
      .filter(isPotentialJobSearchResult)
      .map((result) => ({ url: result.url, result, sourceText: [result.title, result.description].filter(Boolean).join("\n"), source: "snippet" as const }))
      .filter((candidate) => canExtractJobCandidate(candidate.sourceText, "search_snippet"));
    const extractionCandidates = collectSearchCandidates([
      pageFallbacks.filter((candidate) => canExtractJobCandidate(candidate.sourceText, "page")),
      snippetExtractionCandidates,
    ], limits.maxAiExtractions);
    const extractionOutcomes = await mapWithConcurrency(extractionCandidates, limits.aiExtractionConcurrency, async (candidate) => {
      if (!canStart(25_000)) return { candidate, status: "budget_limited" as const };
      try {
        const posting = await extractJobCandidateFromTextWithAi({
          userId,
          provider: settings.aiProvider,
          apiBaseUrl: settings.aiBaseUrl,
          model: extractionModel,
          agentRunId: run.id,
          sourceText: candidate.sourceText,
          pageUrl: candidate.url,
          sourceKind: candidate.source === "snippet" ? "search_snippet" : "page",
          timeoutMs: boundedTimeout(limits.aiTimeoutMs, 15_000),
        });
        return { candidate, status: "succeeded" as const, posting };
      } catch (error) {
        return { candidate, status: "failed" as const, error };
      }
    });
    for (const outcome of extractionOutcomes) {
      if (outcome.status === "budget_limited") {
        budgetExhausted = true;
        continue;
      }
      aiExtractionAttempts += 1;
      if (outcome.candidate.source === "snippet") snippetCandidatesInspected += 1;
      if (outcome.status === "failed") {
        aiExtractionErrors += 1;
        recordPipelineError(errorBreakdown, outcome.error);
        continue;
      }
      if (outcome.posting) {
        aiExtractedPostings += 1;
        await rememberPostings([outcome.posting]);
      }
    }
    if (settings.aiEnabled && settings.webAiMatchLimit > 0) {
      const selected = Array.from(aiCandidates.values()).sort((a, b) => b.score - a.score).slice(0, Math.min(settings.webAiMatchLimit, limits.maxAiMatches));
      const matchOutcomes = await mapWithConcurrency(selected, limits.aiMatchConcurrency, async (candidate) => {
        if (!canStart(25_000)) return { status: "budget_limited" as const };
        try {
          await analyzeJobMatchById(userId, candidate.jobId, { timeoutMs: boundedTimeout(limits.aiTimeoutMs, 15_000) });
          return { status: "succeeded" as const };
        } catch (error) {
          return { status: "failed" as const, error };
        }
      });
      for (const outcome of matchOutcomes) {
        if (outcome.status === "budget_limited") {
          budgetExhausted = true;
          continue;
        }
        if (outcome.status === "succeeded") aiMatched += 1;
        else {
          // Deterministic filtering remains available when an individual AI match fails.
          aiMatchErrors += 1;
          recordPipelineError(errorBreakdown, outcome.error);
        }
      }
    }
    const candidateIds = Array.from(aiCandidates.keys());
    const evaluated = candidateIds.length ? await db.select().from(jobMatches).where(and(eq(jobMatches.userId, userId), inArray(jobMatches.jobId, candidateIds))).all() : [];
    const recommendedIds = new Set(evaluated.filter((match) => match.hardFilterPassed).map((match) => match.jobId));
    for (const candidate of aiCandidates.values()) {
      if (!recommendedIds.has(candidate.jobId)) continue;
      if (candidate.created) added += 1; else updated += 1;
    }
    const degraded = searchErrors > 0 || pageFetchFailures > 0 || unreadablePages > 0 || aiExtractionErrors > 0 || aiMatchErrors > 0;
    const output = { searchProvider, strategyGenerated, queries: executedQueries, budgetExhausted, degraded, errorBreakdown, searchesSucceeded, searchErrors, searchResults, candidatesFound: candidates.length, pagesInspected, pageFetchFailures, unreadablePages, snippetCandidatesInspected, expiredPagesSkipped, parseFailures, parsedPostings, aiExtractionAttempts, aiExtractedPostings, aiExtractionErrors, aiMatched, aiMatchErrors, added, updated, filteredOut: Math.max(0, parsedPostings - recommendedIds.size) };
    await db.transaction(async (tx) => {
      await tx.update(agentRuns).set({ status: "succeeded", outputJson: output, finishedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
      await tx.update(careerPreferences).set({ lastSearchAt: new Date(), updatedAt: new Date() }).where(eq(careerPreferences.id, preferences.id)).run();
      if (latestPlan && executedQueries.length) await tx.update(searchChecklistItems).set({ status: "checked", checkedAt: new Date(), notes: locale === "zh" ? `自动公开搜索检查了 ${pagesInspected} 个页面，并解析出 ${parsedPostings} 条岗位信息。` : `Automatic public search inspected ${pagesInspected} pages and parsed ${parsedPostings} job postings.`, updatedAt: new Date() }).where(and(eq(searchChecklistItems.searchPlanId, latestPlan.id), eq(searchChecklistItems.platform, "public_web"), inArray(searchChecklistItems.query, executedQueries))).run();
      if (added > 0 && settings.notificationsEnabled) await tx.insert(notifications).values({ userId, notificationType: "new_matches", titleZh: `公开网页发现 ${added} 个新岗位`, titleEn: `${added} new role${added === 1 ? "" : "s"} found on the public web`, bodyZh: "岗位已去重、保存快照并完成偏好筛选。", bodyEn: "The roles were deduplicated, snapshotted, and filtered against your preferences.", entityType: "agent_run", entityId: run.id }).run();
    });
    await queueSearchReindex(userId);
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown web job search error";
    await db.update(agentRuns).set({ status: "failed", errorCode: "WEB_SEARCH_ERROR", errorMessage: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, run.id)).run();
    throw error;
  }
}
