import assert from "node:assert/strict";
import test from "node:test";
import { ASSISTANT_CONTEXT_MESSAGE_TOKEN_LIMIT, ASSISTANT_CONTEXT_ROUND_LIMIT, ASSISTANT_CONTEXT_SUMMARY_TOKEN_LIMIT, assistantPromptMessages, compactAssistantContext, prepareAssistantTurn } from "@/lib/assistant-context";
import { resolveAssistantActiveIntent } from "@/lib/jobpilot-assistant";
import { estimateTokens } from "@/lib/token-budget";

function conversation(rounds: number) {
  return Array.from({ length: rounds }, (_, index) => [
    { role: "user" as const, content: `Question ${index + 1}` },
    { role: "assistant" as const, content: `Answer ${index + 1}`, intent: "guide" as const },
  ]).flat();
}

test("assistant context keeps at most ten recent rounds and summarizes older rounds", () => {
  const compacted = compactAssistantContext({
    summary: "",
    messages: conversation(12),
    summarizedMessageCount: 0,
    hasUnread: false,
  }, "en");
  assert.equal(compacted.messages.length, ASSISTANT_CONTEXT_ROUND_LIMIT * 2);
  assert.equal(compacted.messages[0]?.content, "Question 3");
  assert.equal(compacted.messages.at(-1)?.content, "Answer 12");
  assert.match(compacted.summary, /Question 1/);
  assert.match(compacted.summary, /Answer 2/);
  assert.equal(compacted.summarizedMessageCount, 4);
});

test("assistant context archives by token budget before reaching ten rounds", () => {
  const compacted = compactAssistantContext({
    summary: "",
    messages: Array.from({ length: 6 }, (_, index) => [
      { role: "user" as const, content: `Question ${index + 1} ${"中".repeat(1800)}` },
      { role: "assistant" as const, content: `Answer ${index + 1} ${"文".repeat(1200)}`, intent: "resume_advice" as const },
    ]).flat(),
    summarizedMessageCount: 0,
    hasUnread: false,
  }, "zh");
  assert.ok(compacted.messages.filter((message) => message.role === "user").length < 6);
  assert.ok(compacted.messages.filter((message) => message.role === "user").length >= 2);
  assert.match(compacted.summary, /Question 1/);
  assert.ok(estimateTokens(compacted.summary) <= ASSISTANT_CONTEXT_SUMMARY_TOKEN_LIMIT);
});

test("a new user turn archives the oldest round before the model prompt", () => {
  const prepared = prepareAssistantTurn({
    summary: "",
    messages: conversation(10),
    summarizedMessageCount: 0,
    hasUnread: false,
  }, { role: "user", content: "Question 11" }, "en");
  assert.equal(prepared.messages.filter((message) => message.role === "user").length, 10);
  assert.equal(prepared.messages[0]?.content, "Question 2");
  assert.equal(prepared.messages.at(-1)?.content, "Question 11");
  assert.match(prepared.summary, /Question 1/);
});

test("assistant prompts use hidden context content while restored UI uses display content", () => {
  const messages = [{
    role: "assistant" as const,
    content: "Here is the draft.",
    contextContent: "Here is the draft.\n<PREVIOUS_PROJECT_DRAFTS>[]</PREVIOUS_PROJECT_DRAFTS>",
    intent: "resume_project" as const,
    awaitingReply: true,
  }];
  assert.match(assistantPromptMessages(messages)[0]?.content ?? "", /PREVIOUS_PROJECT_DRAFTS/);
  assert.equal(messages[0]?.content, "Here is the draft.");
});

test("assistant prompt compacts one oversized recent round within the token budget", () => {
  const latestUserMessage = "Please use the second option.";
  const messages = [
    { role: "user" as const, content: `Project facts ${"A".repeat(5000)}` },
    {
      role: "assistant" as const,
      content: "Here is a project draft.",
      contextContent: `Here is a project draft.\n<PREVIOUS_PROJECT_DRAFTS>${"项".repeat(20_000)}</PREVIOUS_PROJECT_DRAFTS>`,
      intent: "resume_project" as const,
      awaitingReply: true,
    },
    { role: "user" as const, content: latestUserMessage },
  ];
  const prompt = assistantPromptMessages(messages);
  const promptTokens = prompt.reduce((total, message) => total + estimateTokens(message.content) + 10, 0);
  assert.ok(promptTokens <= ASSISTANT_CONTEXT_MESSAGE_TOKEN_LIMIT);
  assert.equal(prompt.at(-1)?.content, latestUserMessage);
  assert.equal(prompt.find((message) => message.role === "assistant")?.intent, "resume_project");
  assert.ok(prompt.some((message) => message.content.includes("JobPilot compacted source content")));
  assert.equal(resolveAssistantActiveIntent(prompt, prompt.length - 1), "resume_project");
});

test("an existing oversized summary is normalized even when no rounds are archived", () => {
  const compacted = compactAssistantContext({
    summary: `Earlier conversation summary: ${"中".repeat(5000)}`,
    messages: conversation(1),
    summarizedMessageCount: 20,
    hasUnread: false,
  }, "en");
  assert.ok(estimateTokens(compacted.summary) <= ASSISTANT_CONTEXT_SUMMARY_TOKEN_LIMIT);
  assert.match(compacted.summary, /^Earlier conversation summary:/);
});
