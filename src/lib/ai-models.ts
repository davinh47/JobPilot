import type { appSettings } from "@/db/schema";
import type { AiProvider } from "@/lib/ai-provider-config";

export type AiTaskTier = "lightweight" | "balanced" | "complex" | "web";
export type AiModelStrategy = "economy" | "balanced" | "quality" | "fixed";

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
