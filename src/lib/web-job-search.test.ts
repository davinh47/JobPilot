import assert from "node:assert/strict";
import test from "node:test";
import type { careerPreferences, jobSearchTargets } from "@/db/schema";
import { webSearchRequestPrompt } from "./ai-web-search";
import { canExtractJobCandidate, isPotentialJobSearchResult } from "./job-candidate-extractor";
import { buildQueries, collectSearchCandidates, webSearchExecutionLimits } from "./web-job-search";
import { classifyPipelineError } from "./web-job-search-pipeline";

test("OpenAI cloud search preserves broad coverage inside the serverless window", () => {
  const limits = webSearchExecutionLimits(true, "openai");

  assert.ok(limits.budgetMs < 300_000);
  assert.equal(limits.maxQueries, 6);
  assert.equal(limits.maxUrls, 36);
  assert.equal(limits.maxAiExtractions, 10);
  assert.equal(limits.maxAiMatches, 6);
  assert.ok(limits.searchConcurrency >= 2);
  assert.equal(limits.aiExtractionConcurrency, 2);
  assert.equal(limits.aiMatchConcurrency, 2);
  assert.ok(limits.searchTimeoutMs < limits.budgetMs);
  assert.ok(limits.aiTimeoutMs < limits.budgetMs);
});

test("DeepSeek cloud search preserves broad candidate coverage", () => {
  const limits = webSearchExecutionLimits(true, "deepseek");

  assert.equal(limits.maxQueries, 6);
  assert.equal(limits.maxUrls, 36);
  assert.equal(limits.maxAiExtractions, 10);
  assert.equal(limits.maxAiMatches, 6);
  assert.ok(limits.searchConcurrency >= 2);
  assert.ok(limits.pageConcurrency >= 4);
  assert.equal(limits.aiExtractionConcurrency, 2);
  assert.equal(limits.aiMatchConcurrency, 2);
  assert.ok(limits.searchTimeoutMs >= 90_000);
  assert.ok(limits.budgetMs < 300_000);
});

test("pipeline failures retain stable diagnostic categories", () => {
  assert.equal(classifyPipelineError(new Error("OpenAI returned HTTP 429: quota exceeded")), "rate_limited");
  assert.equal(classifyPipelineError(new Error("Page request timed out.")), "timeout");
  assert.equal(classifyPipelineError(new Error("Private network addresses are not allowed.")), "blocked");
  assert.equal(classifyPipelineError(new Error("response was not valid JSON")), "invalid_response");
  assert.equal(classifyPipelineError(new Error("socket disconnected")), "network");
});

test("candidate collection preserves depth and diversity across query groups", () => {
  const candidates = collectSearchCandidates([
    Array.from({ length: 10 }, (_, index) => ({ url: `https://first.example/jobs/${index}` })),
    Array.from({ length: 10 }, (_, index) => ({ url: `https://second.example/jobs/${index}` })),
    Array.from({ length: 10 }, (_, index) => ({ url: `https://third.example/jobs/${index}` })),
    Array.from({ length: 10 }, (_, index) => ({ url: `https://fourth.example/jobs/${index}` })),
  ], 36);

  assert.equal(candidates.length, 36);
  assert.ok(candidates.some((candidate) => candidate.url.endsWith("/jobs/8")));
  assert.ok(new Set(candidates.map((candidate) => new URL(candidate.url).hostname)).size >= 4);
});

test("job-search requests reject generic result pages instead of inflating candidate counts", () => {
  const prompt = webSearchRequestPrompt("AI Engineer Beijing", 10, "job_listings");

  assert.match(prompt, /individual, currently advertised job listing pages/i);
  assert.match(prompt, /not a search page/i);
  assert.match(prompt, /website blocks direct fetching/i);
  assert.match(prompt, /Return fewer results/i);
});

test("web queries preserve each target's seniority and employment type", () => {
  const preferences = {
    targetTitlesJson: ["Architect", "AI Engineer"],
    seniorityLevelsJson: ["senior", "entry"],
    locationsJson: ["Legacy location"],
  } as typeof careerPreferences.$inferSelect;
  const targets = [
    { targetTitle: "Architect", seniorityLevel: "senior", employmentType: "full_time", locationsJson: ["Hong Kong"], remotePreference: "onsite", industriesJson: ["Architecture"], companyAllowlistJson: [] },
    { targetTitle: "AI Engineer", seniorityLevel: "entry", employmentType: "full_time", locationsJson: ["Sydney"], remotePreference: "hybrid", industriesJson: ["Artificial intelligence"], companyAllowlistJson: [] },
  ] as unknown as Array<typeof jobSearchTargets.$inferSelect>;

  const queries = buildQueries(preferences, targets, [], 8, undefined);
  const architectQuery = queries.find((query) => query.includes('"Architect"')) ?? "";
  const aiQuery = queries.find((query) => query.includes('"AI Engineer"')) ?? "";

  assert.match(architectQuery, /senior/);
  assert.doesNotMatch(architectQuery, /junior/);
  assert.match(aiQuery, /junior/);
  assert.doesNotMatch(aiQuery, /senior/);
  assert.match(architectQuery, /full time/);
  assert.match(aiQuery, /full time/);
  assert.match(architectQuery, /Hong Kong/);
  assert.doesNotMatch(architectQuery, /Sydney|Legacy location/);
  assert.match(aiQuery, /Sydney/);
  assert.doesNotMatch(aiQuery, /Hong Kong|Legacy location/);
});

test("a single target receives several complementary fallback queries", () => {
  const preferences = {
    targetTitlesJson: ["AI Engineer"],
    seniorityLevelsJson: ["entry"],
    locationsJson: ["北京"],
  } as typeof careerPreferences.$inferSelect;
  const targets = [{
    targetTitle: "AI Engineer",
    seniorityLevel: "entry",
    employmentType: "full_time",
    locationsJson: ["北京"],
    remotePreference: "onsite",
    industriesJson: [],
    companyAllowlistJson: [],
  }] as unknown as Array<typeof jobSearchTargets.$inferSelect>;

  const queries = buildQueries(preferences, targets, [], 4, undefined);

  assert.equal(queries.length, 4);
  assert.ok(queries.every((query) => query.includes("AI Engineer")));
  assert.ok(queries.some((query) => query.includes("招聘")));
  assert.ok(queries.some((query) => query.includes("site:jobs.lever.co")));
  assert.ok(queries.some((query) => query.includes("jobs apply")));
  assert.ok(queries.every((query) => !/senior|lead|principal/i.test(query)));
});

test("limited query budgets cover every location before repeating one location", () => {
  const preferences = {
    targetTitlesJson: ["AI Engineer"],
    seniorityLevelsJson: ["entry"],
    locationsJson: ["北京", "香港", "悉尼"],
  } as typeof careerPreferences.$inferSelect;
  const targets = [{
    targetTitle: "AI Engineer",
    seniorityLevel: "entry",
    employmentType: "full_time",
    locationsJson: ["北京", "香港", "悉尼"],
    remotePreference: "any",
    industriesJson: [],
    companyAllowlistJson: [],
  }] as unknown as Array<typeof jobSearchTargets.$inferSelect>;

  const queries = buildQueries(preferences, targets, [], 6, undefined);

  assert.equal(queries.length, 6);
  for (const location of ["北京", "香港", "悉尼"]) {
    assert.ok(queries.some((query) => query.includes(location)), `expected a query for ${location}`);
  }
});

test("expanded search coverage includes global ATS and Chinese job platforms", () => {
  const preferences = {
    targetTitlesJson: ["AI Engineer"],
    seniorityLevelsJson: ["entry"],
    locationsJson: ["北京"],
  } as typeof careerPreferences.$inferSelect;
  const targets = [{
    targetTitle: "AI Engineer",
    seniorityLevel: "entry",
    employmentType: "full_time",
    locationsJson: ["北京"],
    remotePreference: "any",
    industriesJson: [],
    companyAllowlistJson: [],
  }] as unknown as Array<typeof jobSearchTargets.$inferSelect>;
  const queries = buildQueries(preferences, targets, [], 6, undefined);

  assert.equal(queries.length, 6);
  assert.ok(queries.some((query) => query.includes("myworkdayjobs.com")));
  assert.ok(queries.some((query) => query.includes("zhaopin.com")));
});

test("AI extraction fallback is limited to results that look like job pages", () => {
  assert.equal(isPotentialJobSearchResult({ title: "Graduate AI Engineer", url: "https://example.com/careers/jobs/123", description: "Apply for this role" }), true);
  assert.equal(isPotentialJobSearchResult({ title: "AI industry outlook", url: "https://example.com/blog/outlook", description: "A research article" }), false);
  assert.equal(isPotentialJobSearchResult({ title: "职位：人工智能工程师", url: "https://example.cn/detail/123", description: "岗位职责与任职要求" }), true);
});

test("live-search snippets can recover cloud-blocked job pages without weakening full-page evidence", () => {
  const conciseSearchResult = [
    "Graduate AI Engineer - Example Robotics",
    "Sydney hybrid role building production AI systems. Apply now.",
  ].join("\n");

  assert.ok(conciseSearchResult.length >= 50 && conciseSearchResult.length < 120);
  assert.equal(canExtractJobCandidate(conciseSearchResult, "search_snippet"), true);
  assert.equal(canExtractJobCandidate(conciseSearchResult, "page"), false);
  assert.equal(canExtractJobCandidate("AI Engineer - Example Robotics", "search_snippet"), false);
});
