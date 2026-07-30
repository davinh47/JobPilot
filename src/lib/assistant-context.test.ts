import assert from "node:assert/strict";
import test from "node:test";
import { ASSISTANT_CONTEXT_ROUND_LIMIT, assistantPromptMessages, compactAssistantContext, prepareAssistantTurn } from "@/lib/assistant-context";

function conversation(rounds: number) {
  return Array.from({ length: rounds }, (_, index) => [
    { role: "user" as const, content: `Question ${index + 1}` },
    { role: "assistant" as const, content: `Answer ${index + 1}`, intent: "guide" as const },
  ]).flat();
}

test("assistant context keeps the latest ten complete rounds and summarizes older rounds", () => {
  const compacted = compactAssistantContext({
    summary: "",
    messages: conversation(12),
    summarizedMessageCount: 0,
  }, "en");
  assert.equal(compacted.messages.length, ASSISTANT_CONTEXT_ROUND_LIMIT * 2);
  assert.equal(compacted.messages[0]?.content, "Question 3");
  assert.equal(compacted.messages.at(-1)?.content, "Answer 12");
  assert.match(compacted.summary, /Question 1/);
  assert.match(compacted.summary, /Answer 2/);
  assert.equal(compacted.summarizedMessageCount, 4);
});

test("a new user turn archives the oldest round before the model prompt", () => {
  const prepared = prepareAssistantTurn({
    summary: "",
    messages: conversation(10),
    summarizedMessageCount: 0,
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
