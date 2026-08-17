import assert from "node:assert/strict";
import test from "node:test";
import { defaultAiModel, selectAiModel } from "./ai-models";

test("balanced routing automatically selects task-appropriate DeepSeek models", () => {
  const settings = { aiProvider: "deepseek", aiModel: "deepseek-v4-pro", aiModelStrategy: "balanced" } as const;
  assert.equal(selectAiModel(settings, "lightweight"), "deepseek-v4-flash");
  assert.equal(selectAiModel(settings, "complex"), "deepseek-v4-pro");
  assert.equal(selectAiModel(settings, "web"), "deepseek-v4-pro");
});

test("balanced routing automatically selects task-appropriate OpenAI models", () => {
  const settings = { aiProvider: "openai", aiModel: "gpt-5.6-luna", aiModelStrategy: "balanced" } as const;
  assert.equal(selectAiModel(settings, "lightweight"), "gpt-5.6-luna");
  assert.equal(selectAiModel(settings, "balanced"), "gpt-5.6-terra");
  assert.equal(selectAiModel(settings, "complex"), "gpt-5.6-sol");
  assert.equal(selectAiModel(settings, "web"), "gpt-5.6-sol");
  assert.equal(defaultAiModel("openai"), "gpt-5.6-terra");
});

test("fixed routing uses the selected model for every task", () => {
  const settings = { aiProvider: "deepseek", aiModel: "deepseek-v4-flash", aiModelStrategy: "fixed" } as const;
  assert.equal(selectAiModel(settings, "lightweight"), "deepseek-v4-flash");
  assert.equal(selectAiModel(settings, "complex"), "deepseek-v4-flash");
  assert.equal(selectAiModel(settings, "web"), "deepseek-v4-flash");
});

test("economy and quality routing shift task tiers predictably", () => {
  const economy = { aiProvider: "openai", aiModel: "gpt-5.6-terra", aiModelStrategy: "economy" } as const;
  const quality = { aiProvider: "openai", aiModel: "gpt-5.6-terra", aiModelStrategy: "quality" } as const;
  assert.equal(selectAiModel(economy, "complex"), "gpt-5.6-terra");
  assert.equal(selectAiModel(economy, "balanced"), "gpt-5.6-luna");
  assert.equal(selectAiModel(quality, "lightweight"), "gpt-5.6-terra");
  assert.equal(selectAiModel(quality, "balanced"), "gpt-5.6-sol");
});

test("an invalid fixed model falls back to the provider balanced model", () => {
  const settings = { aiProvider: "openai", aiModel: "deepseek-v4-pro", aiModelStrategy: "fixed" } as const;
  assert.equal(selectAiModel(settings, "complex"), "gpt-5.6-terra");
});
