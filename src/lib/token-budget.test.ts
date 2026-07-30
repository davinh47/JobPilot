import assert from "node:assert/strict";
import test from "node:test";
import { compactToTokenBudget, estimateTokens } from "./token-budget";

test("token estimates account for denser CJK text", () => {
  assert.ok(estimateTokens("这是一个中文简历摘要") > estimateTokens("short"));
  assert.ok(estimateTokens("A".repeat(400)) >= 100);
});

test("token compaction preserves both ends within the requested budget", () => {
  const source = `START-${"middle ".repeat(500)}-END`;
  const compacted = compactToTokenBudget(source, 120);
  assert.match(compacted, /^START-/);
  assert.match(compacted, /-END$/);
  assert.ok(estimateTokens(compacted) <= 140);
});
