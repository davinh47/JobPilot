import type { appSettings } from "@/db/schema";
import type { AiProvider } from "@/lib/ai-provider-config";

export type AiTaskTier = "lightweight" | "balanced" | "complex" | "web";
export type AiModelStrategy = "economy" | "balanced" | "quality" | "fixed";

export type AiModelCapabilities = {
  contextWindowTokens: number;
  maxOutputTokens: number;
  structuredInputTokens: number;
  defaultTimeoutMs: number;
};

const modelCapabilities: Record<string, AiModelCapabilities> = {
  "gpt-5.6-luna": { contextWindowTokens: 1_050_000, maxOutputTokens: 128_000, structuredInputTokens: 180_000, defaultTimeoutMs: 120_000 },
  "gpt-5.6-terra": { contextWindowTokens: 1_050_000, maxOutputTokens: 128_000, structuredInputTokens: 180_000, defaultTimeoutMs: 150_000 },
  "gpt-5.6-sol": { contextWindowTokens: 1_050_000, maxOutputTokens: 128_000, structuredInputTokens: 180_000, defaultTimeoutMs: 180_000 },
  "deepseek-v4-flash": { contextWindowTokens: 1_000_000, maxOutputTokens: 384_000, structuredInputTokens: 120_000, defaultTimeoutMs: 120_000 },
  "deepseek-v4-pro": { contextWindowTokens: 1_000_000, maxOutputTokens: 384_000, structuredInputTokens: 120_000, defaultTimeoutMs: 180_000 },
};

const providerFallbackCapabilities: Record<AiProvider, AiModelCapabilities> = {
  openai: { contextWindowTokens: 128_000, maxOutputTokens: 16_000, structuredInputTokens: 80_000, defaultTimeoutMs: 120_000 },
  deepseek: { contextWindowTokens: 64_000, maxOutputTokens: 8_000, structuredInputTokens: 40_000, defaultTimeoutMs: 120_000 },
};

const modelTiers: Record<AiProvider, Record<AiTaskTier, string>> = {
  openai: {
    lightweight: "gpt-5.6-luna",
    balanced: "gpt-5.6-terra",
    complex: "gpt-5.6-sol",
    web: "gpt-5.6-sol",
  },
  deepseek: {
    lightweight: "deepseek-v4-flash",
    balanced: "deepseek-v4-flash",
    complex: "deepseek-v4-pro",
    web: "deepseek-v4-pro",
  },
};

export const aiModelOptions = {
  openai: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
} as const;

type Settings = Pick<typeof appSettings.$inferSelect, "aiProvider" | "aiModel" | "aiModelStrategy">;

export function selectAiModel(settings: Settings, taskTier: AiTaskTier) {
  const provider: AiProvider = settings.aiProvider === "openai" ? "openai" : "deepseek";
  const selectedModel = (aiModelOptions[provider] as readonly string[]).includes(settings.aiModel)
    ? settings.aiModel
    : defaultAiModel(provider);
  if (settings.aiModelStrategy === "fixed") return selectedModel;

  const normalizedTier = taskTier === "web" ? "complex" : taskTier;
  const routedTier = settings.aiModelStrategy === "economy"
    ? normalizedTier === "complex" ? "balanced" : "lightweight"
    : settings.aiModelStrategy === "quality"
      ? normalizedTier === "lightweight" ? "balanced" : "complex"
      : normalizedTier;
  return modelTiers[provider][routedTier];
}

export function defaultAiModel(provider: AiProvider) {
  return modelTiers[provider].balanced;
}

export function aiModelCapabilities(provider: AiProvider, model: string) {
  return modelCapabilities[model] ?? providerFallbackCapabilities[provider];
}
