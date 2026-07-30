import assert from "node:assert/strict";
import test from "node:test";
import { calibratedOverallScore, resolvedHardFilterPassed } from "./job-match-ai";

test("AI uncertainty does not hide a deterministically eligible job", () => {
  assert.equal(resolvedHardFilterPassed({
    deterministicPassed: true,
    aiPassed: false,
    hasCustomHardRequirements: false,
  }), true);
});

test("match score calibration caps weakly evidenced and hard-filtered results", () => {
  const strong = calibratedOverallScore({ skills: 90, responsibilities: 90, seniority: 85, location: 100, salary: null, industry: 80, authorization: null, evidenceCount: 4, hardFilterPassed: true });
  const unsupported = calibratedOverallScore({ skills: 99, responsibilities: 99, seniority: 99, location: 99, salary: 99, industry: 99, authorization: 99, evidenceCount: 0, hardFilterPassed: true });
  const filtered = calibratedOverallScore({ skills: 99, responsibilities: 99, seniority: 99, location: 99, salary: 99, industry: 99, authorization: 99, evidenceCount: 5, hardFilterPassed: false });
  assert.ok(strong > 80);
  assert.equal(unsupported, 55);
  assert.equal(filtered, 39);
});

test("explicit custom hard requirements may still reject a job", () => {
  assert.equal(resolvedHardFilterPassed({
    deterministicPassed: true,
    aiPassed: false,
    hasCustomHardRequirements: true,
  }), false);
  assert.equal(resolvedHardFilterPassed({
    deterministicPassed: false,
    aiPassed: true,
    hasCustomHardRequirements: false,
  }), false);
});
