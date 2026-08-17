import assert from "node:assert/strict";
import test from "node:test";
import {
  coverLetterRepairInstruction,
  findCoverLetterGroundingIssues,
  hasCoverLetterGroundingIssues,
} from "./cover-letter-grounding";

test("rejects numbers that are absent from both the resume and job description", () => {
  const issues = findCoverLetterGroundingIssues({
    content: "I improved the workflow for more than 1000 users.",
    groundedClaims: [{ claim: "Improved the workflow", sourceQuote: "Improved the workflow" }],
  }, "Improved the workflow by 25%.", "The role supports a team of 12.");

  assert.deepEqual(issues.inventedNumbers, ["1000"]);
  assert.equal(hasCoverLetterGroundingIssues(issues), true);
  assert.match(coverLetterRepairInstruction(issues), /1000/);
});

test("accepts exact resume evidence and numbers grounded in either source", () => {
  const issues = findCoverLetterGroundingIssues({
    content: "I improved accuracy by 25% and can support the listed team of 12.",
    groundedClaims: [{ claim: "Improved accuracy", sourceQuote: "Improved accuracy by 25%." }],
  }, "Improved accuracy by 25%.", "The role supports a team of 12.");

  assert.deepEqual(issues, { invalidEvidenceQuotes: [], inventedNumbers: [], unmappedClaims: [], uncoveredCandidateSentences: [], weakClaimEvidence: [] });
  assert.equal(hasCoverLetterGroundingIssues(issues), false);
});

test("rejects paraphrased evidence quotes so the repair can request an exact excerpt", () => {
  const issues = findCoverLetterGroundingIssues({
    content: "I built a local-first platform.",
    groundedClaims: [{ claim: "Built a platform", sourceQuote: "Created a local-first platform" }],
  }, "Built a local-first platform.", "Software engineer role");

  assert.deepEqual(issues.invalidEvidenceQuotes, ["Created a local-first platform"]);
  assert.match(coverLetterRepairInstruction(issues), /exact excerpts/);
});

test("rejects a candidate-specific sentence that is omitted from grounded claims", () => {
  const issues = findCoverLetterGroundingIssues({
    content: "I built a local-first platform. I led an international engineering team.",
    groundedClaims: [{ claim: "built a local-first platform", sourceQuote: "Built a local-first platform." }],
  }, "Built a local-first platform.", "Engineering role");

  assert.equal(issues.uncoveredCandidateSentences.length, 1);
  assert.match(issues.uncoveredCandidateSentences[0] ?? "", /international engineering team/);
  assert.equal(hasCoverLetterGroundingIssues(issues), true);
});
