import assert from "node:assert/strict";
import test from "node:test";
import { compactPromptToTokenBudget, compactToTokenBudget, estimateTokens } from "./token-budget";

test("token estimates account for denser CJK text", () => {
  assert.ok(estimateTokens("这是一个中文简历摘要") > estimateTokens("short"));
  assert.ok(estimateTokens("A".repeat(400)) >= 100);
});

test("token compaction preserves both ends within the requested budget", () => {
  const source = `START-${"middle ".repeat(500)}-END`;
  const compacted = compactToTokenBudget(source, 120);
  assert.match(compacted, /^START-/);
  assert.match(compacted, /-END$/);
  assert.ok(estimateTokens(compacted) <= 120);
});

test("tagged prompt compaction preserves each source block", () => {
  const prompt = `<AUTHORITATIVE_RESUME_FACTS>${"resume ".repeat(600)}</AUTHORITATIVE_RESUME_FACTS>\n<CAREER_PREFERENCES>${"preference ".repeat(300)}</CAREER_PREFERENCES>\n<UNTRUSTED_JOB_DESCRIPTION>${"job ".repeat(600)}</UNTRUSTED_JOB_DESCRIPTION>`;
  const compacted = compactPromptToTokenBudget(prompt, 500);
  assert.match(compacted, /<AUTHORITATIVE_RESUME_FACTS>/);
  assert.match(compacted, /<CAREER_PREFERENCES>/);
  assert.match(compacted, /<UNTRUSTED_JOB_DESCRIPTION>/);
  assert.ok(estimateTokens(compacted) <= 500);
});
