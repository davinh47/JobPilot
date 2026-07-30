import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { requestDeepSeekJsonWithKey } from "@/lib/deepseek";

test("adds the JSON schema and repairs an incomplete DeepSeek response once", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const responses = [
    { summary: "Missing the required headline." },
    { headline: "Data engineer", summary: "Builds reliable data products." },
  ];
  const fetcher: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const content = JSON.stringify(responses.shift());
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await requestDeepSeekJsonWithKey({
    provider: "deepseek",
    apiBaseUrl: "https://api.deepseek.test",
    model: "test-model",
    system: "Return JSON.",
    user: "Analyze this fixture.",
    schema: z.object({ headline: z.string(), summary: z.string() }),
    apiKey: "test-key",
    fetcher,
  });
  assert.deepEqual(result, { headline: "Data engineer", summary: "Builds reliable data products." });
  assert.equal(bodies.length, 2);
  const firstMessages = bodies[0]?.messages as Array<{ content: string }>;
  const repairMessages = bodies[1]?.messages as Array<{ role: string; content: string }>;
  assert.match(firstMessages[0]?.content ?? "", /OUTPUT_JSON_SCHEMA/);
  assert.match(firstMessages[0]?.content ?? "", /"required":\["headline","summary"\]/);
  assert.equal(repairMessages.at(-1)?.role, "user");
  assert.match(repairMessages.at(-1)?.content ?? "", /headline: Invalid input/);
});

test("complete structured requests prioritize factual coverage instead of the fewest items", async () => {
  let systemPrompt = "";
  await requestDeepSeekJsonWithKey({
    provider: "deepseek",
    apiBaseUrl: "https://api.deepseek.test",
    model: "test-model",
    system: "Analyze the full source.",
    user: "Analyze this fixture.",
    schema: z.object({ ok: z.boolean() }),
    outputMode: "complete",
    apiKey: "test-key",
    fetcher: (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      systemPrompt = body.messages[0]?.content ?? "";
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  });
  assert.match(systemPrompt, /Cover every distinct, schema-relevant fact/);
  assert.doesNotMatch(systemPrompt, /Prefer the fewest items/);
});

test("retries a truncated DeepSeek response with a concise output request", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const truncated = bodies.length === 1;
    return new Response(JSON.stringify({ choices: [{ finish_reason: truncated ? "length" : "stop", message: { content: truncated ? "{\"ok\":" : "{\"ok\":true}" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await requestDeepSeekJsonWithKey({
    provider: "deepseek",
    apiBaseUrl: "https://api.deepseek.test",
    model: "test-model",
    system: "Return JSON.",
    user: "Analyze this fixture.",
    schema: z.object({ ok: z.boolean() }),
    apiKey: "test-key",
    fetcher,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1]?.max_tokens, 8000);
  const retryMessages = bodies[1]?.messages as Array<{ role: string; content: string }>;
  assert.match(retryMessages.at(-1)?.content ?? "", /much more concise form/);
});

test("reports when DeepSeek still truncates after the compact retry", async () => {
  let requests = 0;
  await assert.rejects(requestDeepSeekJsonWithKey({
    provider: "deepseek",
    apiBaseUrl: "https://api.deepseek.test",
    model: "test-model",
    system: "Return JSON.",
    user: "Analyze this fixture.",
    schema: z.object({ ok: z.boolean() }),
    apiKey: "test-key",
    fetcher: (async () => {
      requests += 1;
      return new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{\"ok\":" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  }), /structured output remained truncated after JobPilot's compact retry/);
  assert.equal(requests, 2);
});

test("rejects removed AI providers before sending a request", async () => {
  let requested = false;
  await assert.rejects(requestDeepSeekJsonWithKey({
    provider: "minimax",
    apiBaseUrl: "https://example.com/v1",
    model: "legacy-model",
    apiKey: "test-key",
    system: "Return JSON.",
    user: "Test.",
    schema: z.object({ ok: z.boolean() }),
    fetcher: (async () => { requested = true; return new Response(); }) as typeof fetch,
  }), /Unsupported AI provider/);
  assert.equal(requested, false);
});

test("uses the OpenAI Responses API for structured requests", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> | undefined;
  const result = await requestDeepSeekJsonWithKey({
    provider: "openai",
    apiBaseUrl: "https://api.openai.com/v1",
    model: "gpt-5.6-luna",
    apiKey: "test-key",
    system: "Return JSON.",
    user: "Test.",
    schema: z.object({ ok: z.boolean() }),
    fetcher: (async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{\"ok\":true}" }] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(requestUrl, "https://api.openai.com/v1/responses");
  assert.deepEqual((requestBody?.text as { format?: unknown })?.format, { type: "json_object" });
});
