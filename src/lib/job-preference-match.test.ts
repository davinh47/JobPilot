import assert from "node:assert/strict";
import test from "node:test";
import { deterministicMatch, isAutomaticRecommendation, querySeniorityAffinity, senioritySearchTerms } from "./job-preference-match";

const job = (title: string, location = "北京") => ({ title, companyName: "Example", location, workplaceType: "onsite" as const, descriptionText: "A detailed role with engineering, design, evaluation, deployment, collaboration, and product delivery responsibilities." });
const preference = { targetTitlesJson: ["AI Engineer"], seniorityLevelsJson: ["初级"], locationsJson: ["北京"], excludedKeywordsJson: [], companyBlocklistJson: [], remotePreference: "any" as const };

test("entry-level preferences reject explicitly senior roles", () => {
  assert.equal(deterministicMatch(job("Senior AI Engineer"), preference).passed, false);
  assert.equal(deterministicMatch(job("AI Engineer / Senior AI Engineer"), preference).passed, false);
  assert.equal(deterministicMatch(job("Junior AI Engineer"), preference).passed, true);
  assert.equal(deterministicMatch(job("AI Engineer"), preference).passed, true);
});

test("bilingual role and location names do not cause false hard-filter failures", () => {
  const englishLocation = deterministicMatch(job("Agentic AI Engineer (Intern / Junior)", "Beijing (Chaoyang)"), preference, "zh");
  const chineseRole = deterministicMatch(job("初级AI算法工程师", "北京-朝阳区"), preference, "zh");

  assert.equal(englishLocation.passed, true);
  assert.equal(englishLocation.gaps.includes("目标地点"), false);
  assert.equal(chineseRole.passed, true);
  assert.equal(chineseRole.gaps.includes("目标岗位名称"), false);
});

test("missing locations remain visible as uncertainty while explicit conflicts are rejected", () => {
  const missingLocation = deterministicMatch(job("Junior AI Engineer", ""), preference, "zh");
  const multipleLocations = deterministicMatch(job("Junior AI Engineer", "Multiple locations"), preference, "zh");
  const locationInTitle = deterministicMatch(job("Junior AI Engineer - Beijing", ""), preference, "zh");
  const conflictingLocation = deterministicMatch(job("Junior AI Engineer", "上海"), preference, "zh");

  assert.equal(missingLocation.passed, true);
  assert.ok(missingLocation.uncertainties.includes("岗位来源未提供可核验的工作地点"));
  assert.equal(multipleLocations.passed, true);
  assert.ok(multipleLocations.uncertainties.includes("岗位来源未提供可核验的工作地点"));
  assert.equal(locationInTitle.passed, true);
  assert.equal(locationInTitle.uncertainties.includes("岗位来源未提供可核验的工作地点"), false);
  assert.equal(conflictingLocation.passed, false);
  assert.ok(conflictingLocation.gaps.includes("目标地点"));
});

test("seniority preferences guide query ranking", () => {
  assert.ok(senioritySearchTerms(["初级"]).includes("junior"));
  assert.equal(querySeniorityAffinity("AI Research Intern Junior 北京", ["初级"]), 2);
  assert.equal(querySeniorityAffinity("Senior AI Engineer 北京", ["初级"]), -1);
});

test("automatic recommendations keep relevant roles regardless of score", () => {
  assert.equal(isAutomaticRecommendation(job("Junior AI Engineer"), preference, { overallScore: 25, hardFilterPassed: true }), true);
  assert.equal(isAutomaticRecommendation(job("Junior AI Engineer"), preference, { overallScore: 95, hardFilterPassed: false }), false);
  assert.equal(isAutomaticRecommendation(job("Junior AI Engineer", ""), preference, { overallScore: 73, hardFilterPassed: false, modelName: null, promptVersion: "deterministic-v4" }), true);
  assert.equal(isAutomaticRecommendation(job("Senior AI Engineer"), preference, { overallScore: 95, hardFilterPassed: true }), false);
});

test("multiple role targets keep title and seniority paired", () => {
  const multiTargetPreference = {
    ...preference,
    seniorityLevelsJson: ["senior", "entry"],
    jobSearchTargets: [
      { id: "architecture", targetTitle: "Architect", seniorityLevel: "senior" as const, employmentType: "full_time" as const, locationsJson: ["香港"], remotePreference: "onsite" as const, industriesJson: ["Architecture"], companyBlocklistJson: [], excludedKeywordsJson: [] },
      { id: "ai", targetTitle: "AI Engineer", seniorityLevel: "entry" as const, employmentType: "full_time" as const, locationsJson: ["北京", "悉尼"], remotePreference: "onsite" as const, industriesJson: ["Artificial intelligence"], companyBlocklistJson: [], excludedKeywordsJson: [] },
    ],
  };
  const juniorAi = deterministicMatch({ ...job("Junior AI Engineer"), employmentType: "full time" }, multiTargetPreference);
  const seniorArchitect = deterministicMatch({ ...job("Senior Architect", "香港"), employmentType: "permanent" }, multiTargetPreference);
  const seniorAi = deterministicMatch({ ...job("Senior AI Engineer"), employmentType: "full time" }, multiTargetPreference);
  const juniorAiWrongLocation = deterministicMatch({ ...job("Junior AI Engineer", "香港"), employmentType: "full time" }, multiTargetPreference);

  assert.equal(juniorAi.passed, true);
  assert.equal(juniorAi.matchedTargetId, "ai");
  assert.equal(seniorArchitect.passed, true);
  assert.equal(seniorArchitect.matchedTargetId, "architecture");
  assert.equal(seniorAi.passed, false);
  assert.equal(juniorAiWrongLocation.passed, false);
});

test("a known employment type mismatch fails its role target", () => {
  const fullTimeOnly = {
    ...preference,
    jobSearchTargets: [{ id: "ai", targetTitle: "AI Engineer", seniorityLevel: "entry" as const, employmentType: "full_time" as const }],
  };
  assert.equal(deterministicMatch({ ...job("Junior AI Engineer"), employmentType: "contract" }, fullTimeOnly).passed, false);
});

test("visa requirements follow the matched location within one role target", () => {
  const locationSpecific = {
    ...preference,
    jobSearchTargets: [{
      id: "ai",
      targetTitle: "AI Engineer",
      seniorityLevel: "entry" as const,
      employmentType: "full_time" as const,
      locationsJson: ["北京", "悉尼", "墨尔本"],
      locationPreferencesJson: [
        { location: "北京", requiresVisaSponsorship: true, workAuthorizationNotes: "需要中国工作签证" },
        { location: "悉尼", requiresVisaSponsorship: false, workAuthorizationNotes: "澳大利亚公民" },
        { location: "墨尔本", requiresVisaSponsorship: false, workAuthorizationNotes: "澳大利亚公民" },
      ],
    }],
  };
  const beijing = deterministicMatch(job("Junior AI Engineer", "北京"), locationSpecific, "zh");
  const sydney = deterministicMatch(job("Junior AI Engineer", "Sydney / 悉尼"), locationSpecific, "zh");

  assert.equal(beijing.requiresVisaSponsorship, true);
  assert.equal(beijing.matchedLocation, "北京");
  assert.ok(beijing.uncertainties.includes("该地点的签证担保仍需核验来源"));
  assert.equal(sydney.requiresVisaSponsorship, false);
  assert.equal(sydney.matchedLocation, "悉尼");
  assert.equal(sydney.workAuthorizationNotes, "澳大利亚公民");
  assert.equal(sydney.uncertainties.includes("该地点的签证担保仍需核验来源"), false);
});

test("deterministic match explanations follow the interface language", () => {
  const result = deterministicMatch(job("Senior AI Engineer", "上海"), preference, "zh");

  assert.equal(result.passed, false);
  assert.ok(result.gaps.includes("目标地点"));
  assert.ok(result.gaps.includes("职级要求"));
  assert.ok(result.uncertainties.includes("技能匹配需要结合简历证据分析"));
});
