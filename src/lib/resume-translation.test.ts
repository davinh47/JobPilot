import assert from "node:assert/strict";
import test from "node:test";
import { translationIntroducedNumbers } from "@/lib/resume-translation";

test("resume translation preserves numeric facts without inventing new claims", () => {
  const source = { description: "Led 3 launches and improved latency by 24% in 2025." };
  assert.deepEqual(translationIntroducedNumbers(source, { description: "负责 3 次发布，并在 2025 年将延迟降低 24%。" }), []);
  assert.deepEqual(translationIntroducedNumbers(source, { description: "负责 5 次发布，并将延迟降低 24%。" }), ["5"]);
});
