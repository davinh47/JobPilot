export const AI_BASE_URLS = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
} as const;

export type AiProvider = "deepseek" | "openai";

export function canonicalAiBaseUrl(provider: AiProvider, value: string) {
  const normalized = value.replace(/\/+$/, "");
  if (provider === "deepseek") return normalized === AI_BASE_URLS.deepseek ? AI_BASE_URLS.deepseek : null;
  return normalized === AI_BASE_URLS.openai ? AI_BASE_URLS.openai : null;
}

export function providerHasHostedWebSearch(provider: string) {
  return provider === "openai" || provider === "deepseek";
}

export function providerSupportsAutomaticDiscovery(provider: string) {
  return provider === "openai" || provider === "deepseek";
}
