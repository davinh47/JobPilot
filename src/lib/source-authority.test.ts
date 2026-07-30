import assert from "node:assert/strict";
import test from "node:test";
import { sourceAuthority, sourceNeedsConfirmation } from "./source-authority";

test("classifies explicit user input as authoritative", () => {
  assert.equal(sourceAuthority("user"), "user_provided");
  assert.equal(sourceAuthority("user_context"), "user_provided");
  assert.equal(sourceNeedsConfirmation("user"), false);
});

test("classifies resume content as authoritative and source-grounded", () => {
  assert.equal(sourceAuthority("resume"), "resume_grounded");
  assert.equal(sourceAuthority("resume_version"), "resume_grounded");
  assert.equal(sourceAuthority("resume_import"), "resume_grounded");
  assert.equal(sourceNeedsConfirmation("resume_version"), false);
});

test("requires confirmation for AI-derived or unknown sources", () => {
  assert.equal(sourceAuthority("assistant_suggestion"), "ai_inferred");
  assert.equal(sourceAuthority(""), "ai_inferred");
  assert.equal(sourceNeedsConfirmation("assistant_suggestion"), true);
});
