import assert from "node:assert/strict";
import test from "node:test";
import { evidenceQuoteMatches, groundedCandidateScalar, mergeGroundedStrengths, type CandidateAnalysis } from "./profile-analysis";

type Strength = CandidateAnalysis["strengths"][number];

const strength = (claim: string, sourceQuote: string, sourceType: Strength["sourceType"] = "resume"): Strength => ({
  claim,
  sourceQuote,
  sourceType,
});

test("evidence validation tolerates punctuation and spacing without accepting short fuzzy quotes", () => {
  const source = "参与设计智能体记忆高效记录与读取策略框架，创建 RawIndexEdge 记忆架构。";
  assert.equal(evidenceQuoteMatches(source, "参与设计智能体记忆高效记录与读取策略框架, 创建“RawIndexEdge”记忆架构"), true);
  assert.equal(evidenceQuoteMatches(source, "记忆"), false);
  assert.equal(evidenceQuoteMatches(source, "创建不存在的产品架构"), false);
  assert.equal(evidenceQuoteMatches("Advanced C++ expert", "C++ expert"), true);
});

test("profile refresh retains previously grounded strengths and removes stale or duplicate evidence", () => {
  const resume = "Built JobPilot with Next.js and TypeScript.\nAdded grounded resume analysis.";
  const current = [strength("Grounded analysis", "Added grounded resume analysis.")];
  const previous = [
    strength("Full-stack delivery", "Built JobPilot with Next.js and TypeScript."),
    strength("Duplicate wording", "Added grounded resume analysis"),
    strength("Removed experience", "Led a Kubernetes migration."),
  ];
  assert.deepEqual(
    mergeGroundedStrengths(current, previous, resume, ""),
    [current[0], previous[0]],
  );
});

test("candidate scalar facts must occur in an authoritative scalar source", () => {
  assert.equal(groundedCandidateScalar("Melbourne", "Sydney/NSW", ""), null);
  assert.equal(groundedCandidateScalar("Sydney", "Sydney/NSW", ""), "Sydney");
  assert.equal(groundedCandidateScalar("Australian citizen", "", "Australian citizen with unrestricted work rights"), "Australian citizen");
});
