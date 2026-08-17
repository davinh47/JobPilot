import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { openAiCompatibleJsonSchema } from "./openai-schema";

test("removes unsupported URI formats from OpenAI structured output schemas", () => {
  const schema = z.object({
    url: z.url(),
    evidence: z.array(z.object({ source: z.url() })),
  });

  const generated = openAiCompatibleJsonSchema(schema);
  assert.equal(JSON.stringify(generated).includes('"format"'), false);
  assert.equal(schema.safeParse({ url: "not-a-url", evidence: [] }).success, false);
});
