import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { requestDeepSeekWebJsonWithKey } from "./deepseek-web-search";

test("uses DeepSeek's Anthropic web-search server tool", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      stop_reason: "end_turn",
      content: [
        { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "AI engineer Beijing" } },
        { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
        { type: "text", text: '{"results":[{"title":"AI Engineer","url":"https://example.com/jobs/1"}]}' },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await requestDeepSeekWebJsonWithKey({
    apiBaseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKey: "test-key",
    input: "Find a current role",
    schema: z.object({ results: z.array(z.object({ title: z.string(), url: z.url() })) }),
    fetcher,
  });

  assert.equal(capturedUrl, "https://api.deepseek.com/anthropic/v1/messages");
  assert.deepEqual(capturedBody.tools, [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]);
  assert.equal(result.results[0]?.url, "https://example.com/jobs/1");
});

test("continues a paused DeepSeek server search before requiring final JSON", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) {
      return new Response(JSON.stringify({
        stop_reason: "tool_use",
        content: [
          { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "AI engineer Hong Kong careers" } },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      stop_reason: "end_turn",
      content: [
        { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ title: "Careers", url: "https://careers.example.test" }] },
        { type: "text", text: '{"results":[{"title":"Careers","url":"https://careers.example.test"}]}' },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await requestDeepSeekWebJsonWithKey({
    apiBaseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKey: "test-key",
    input: "Find official company careers pages",
    schema: z.object({ results: z.array(z.object({ title: z.string(), url: z.url() })) }),
    fetcher,
  });

  assert.equal(bodies.length, 2);
  assert.equal((bodies[1]?.messages as unknown[])?.length, 2);
  assert.equal(result.results[0]?.url, "https://careers.example.test");
});
