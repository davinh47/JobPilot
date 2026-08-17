import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJobUrl } from "./job-identity";

test("normalizes public job URLs and removes common tracking parameters", () => {
  assert.equal(
    normalizeJobUrl("https://jobs.example.com/role/?utm_source=email&ref=feed&id=42#apply"),
    "https://jobs.example.com/role?id=42",
  );
});

test("rejects non-HTTP job URLs and URLs containing credentials", () => {
  for (const value of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:secret@jobs.example.com/role",
  ]) {
    assert.throws(() => normalizeJobUrl(value), /public HTTP/);
  }
});
