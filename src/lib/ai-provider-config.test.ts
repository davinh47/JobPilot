import assert from "node:assert/strict";
import test from "node:test";
import { AI_BASE_URLS, canonicalAiBaseUrl, providerHasHostedWebSearch, providerSupportsAutomaticDiscovery } from "@/lib/ai-provider-config";

test("rejects non-official provider endpoints before sending an API key", () => {
  assert.equal(canonicalAiBaseUrl("deepseek", "https://example.com"), null);
  assert.equal(canonicalAiBaseUrl("deepseek", AI_BASE_URLS.deepseek), AI_BASE_URLS.deepseek);
  assert.equal(canonicalAiBaseUrl("openai", AI_BASE_URLS.openai), AI_BASE_URLS.openai);
  assert.equal(canonicalAiBaseUrl("openai", "https://example.com/v1"), null);
});

test("OpenAI and DeepSeek expose native hosted web search", () => {
  assert.equal(providerHasHostedWebSearch("openai"), true);
  assert.equal(providerHasHostedWebSearch("deepseek"), true);
});

test("both providers support automatic discovery through different search stacks", () => {
  assert.equal(providerSupportsAutomaticDiscovery("openai"), true);
  assert.equal(providerSupportsAutomaticDiscovery("deepseek"), true);
  assert.equal(providerSupportsAutomaticDiscovery("unknown"), false);
});
