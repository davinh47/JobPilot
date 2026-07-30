import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultPlatformResume } from "@/lib/resume-format";
import { resumeOptimizationPayloadSchema, resumeOptimizationResultSchema, unsupportedResumeEditSentences } from "@/lib/resume-optimization";

test("accepts a background resume optimization payload with an editable snapshot", () => {
  const payload = {
    userId: "5e419cf9-3cc7-452b-bbe9-2a1ad2fb7631",
    resumeId: "7e9bb895-1d98-4290-8337-a821823557fa",
    jobId: "d7ce176d-c85d-49dc-b6e7-d8e217291d13",
    agentRunId: "a3b2b4ae-257e-47d8-8275-f90f3c7464ab",
    locale: "zh" as const,
    content: createDefaultPlatformResume("zh"),
  };
  assert.equal(resumeOptimizationPayloadSchema.parse(payload).resumeId, payload.resumeId);
});

test("rejects background optimization payloads without structured resume content", () => {
  assert.throws(() => resumeOptimizationPayloadSchema.parse({
    userId: "5e419cf9-3cc7-452b-bbe9-2a1ad2fb7631",
    resumeId: "7e9bb895-1d98-4290-8337-a821823557fa",
    jobId: "d7ce176d-c85d-49dc-b6e7-d8e217291d13",
    agentRunId: "a3b2b4ae-257e-47d8-8275-f90f3c7464ab",
    locale: "en",
    content: { summary: "Not a JobPilot resume" },
  }), /Invalid structured resume content/);
});

test("validates a persisted optimization proposal that can be reopened from a notification", () => {
  const result = resumeOptimizationResultSchema.parse({
    jobId: "d7ce176d-c85d-49dc-b6e7-d8e217291d13",
    jobLabel: "Example · Product Designer",
    strategySummary: "Move the most relevant product work earlier and clarify its evidence.",
    edits: [{
      targetId: "summary",
      revisedText: "Product designer focused on accessible workflows.",
      reason: "Makes the target discipline explicit.",
      sourceQuotes: ["Product designer"],
    }],
    sectionOrder: [],
    entryOrders: [],
    suggestions: [],
  });
  assert.equal(result.edits[0]?.targetId, "summary");
});

test("flags an optimization sentence whose meaningful facts do not overlap its source target", () => {
  assert.deepEqual(
    unsupportedResumeEditSentences("Built a local-first job tracking application.", "Led an international team across five countries."),
    ["Led an international team across five countries."],
  );
  assert.deepEqual(
    unsupportedResumeEditSentences("Built a local-first job tracking application.", "Built a reliable local-first job tracking product."),
    [],
  );
});
