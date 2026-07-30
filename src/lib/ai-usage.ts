import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, aiUsageEvents } from "@/db/schema";

export type AiUsage = {
  userId: string;
  agentRunId?: string;
  provider: string;
  model: string;
  taskType: string;
  promptVersion?: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  toolCallCount?: number;
  latencyMs: number;
  retryIndex?: number;
  usageEstimated?: boolean;
};

type ModelPrice = { input: number; output: number; cachedInput?: number };

function configuredPricing(): Record<string, ModelPrice> {
  if (!process.env.JOBPILOT_MODEL_PRICING) return {};
  try {
    const value = JSON.parse(process.env.JOBPILOT_MODEL_PRICING) as Record<string, ModelPrice>;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function estimatedCostMicros(usage: AiUsage) {
  const price = configuredPricing()[usage.model];
  if (!price) return 0;
  const uncachedInput = Math.max(0, usage.inputTokens - (usage.cachedInputTokens ?? 0));
  return Math.max(0, Math.round(
    uncachedInput * price.input
    + (usage.cachedInputTokens ?? 0) * (price.cachedInput ?? price.input)
    + usage.outputTokens * price.output,
  ));
}

export async function recordAiUsage(usage: AiUsage) {
  const cost = estimatedCostMicros(usage);
  await db.transaction(async (tx) => {
    await tx.insert(aiUsageEvents).values({
      userId: usage.userId,
      agentRunId: usage.agentRunId,
      provider: usage.provider,
      model: usage.model,
      taskType: usage.taskType,
      promptVersion: usage.promptVersion,
      inputTokens: Math.max(0, usage.inputTokens),
      outputTokens: Math.max(0, usage.outputTokens),
      cachedInputTokens: Math.max(0, usage.cachedInputTokens ?? 0),
      toolCallCount: Math.max(0, usage.toolCallCount ?? 0),
      estimatedCostMicros: cost,
      latencyMs: Math.max(0, usage.latencyMs),
      retryIndex: Math.max(0, usage.retryIndex ?? 0),
      usageEstimated: usage.usageEstimated ?? false,
    }).run();
    if (usage.agentRunId) {
      await tx.update(agentRuns).set({
        inputTokens: sql`${agentRuns.inputTokens} + ${Math.max(0, usage.inputTokens)}`,
        outputTokens: sql`${agentRuns.outputTokens} + ${Math.max(0, usage.outputTokens)}`,
        cachedInputTokens: sql`${agentRuns.cachedInputTokens} + ${Math.max(0, usage.cachedInputTokens ?? 0)}`,
        toolCallCount: sql`${agentRuns.toolCallCount} + ${Math.max(0, usage.toolCallCount ?? 0)}`,
        estimatedCostMicros: sql`${agentRuns.estimatedCostMicros} + ${cost}`,
        latencyMs: sql`${agentRuns.latencyMs} + ${Math.max(0, usage.latencyMs)}`,
        retryCount: sql`MAX(${agentRuns.retryCount}, ${Math.max(0, usage.retryIndex ?? 0)})`,
        updatedAt: new Date(),
      }).where(eq(agentRuns.id, usage.agentRunId)).run();
    }
  });
}

export async function recordAiUsageBestEffort(usage: AiUsage) {
  try {
    await recordAiUsage(usage);
    return true;
  } catch (error) {
    console.error("[JobPilot audit] AI usage event was not persisted", {
      provider: usage.provider,
      model: usage.model,
      taskType: usage.taskType,
      agentRunId: usage.agentRunId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
