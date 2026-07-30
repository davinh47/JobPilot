import assert from "node:assert/strict";
import test from "node:test";
import { friendlyAgentError } from "./agent-errors";
import { networkRequestError } from "./network-errors";

test("networkRequestError preserves a safe connection diagnostic", () => {
  const source = new TypeError("fetch failed") as TypeError & { cause?: { code: string; message: string } };
  source.cause = { code: "UND_ERR_CONNECT_TIMEOUT", message: "Connect Timeout Error" };
  assert.equal(networkRequestError("OpenAI", source).message, "OpenAI network request failed (UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error).");
});

test("friendlyAgentError explains OpenAI connectivity failures", () => {
  const message = "OpenAI network request failed (UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error).";
  assert.match(friendlyAgentError(message, "zh"), /网络、代理或 VPN/);
  assert.match(friendlyAgentError(message, "en"), /network, proxy, or VPN/);
});

test("friendlyAgentError gives a concise DeepSeek connection message", () => {
  const message = "DeepSeek network request failed (ENOTFOUND)";
  assert.match(friendlyAgentError(message, "zh"), /暂时无法连接 DeepSeek/);
  assert.match(friendlyAgentError(message, "en"), /cannot reach DeepSeek/i);
});

test("friendlyAgentError distinguishes truncated output from oversized input", () => {
  const message = "DeepSeek JSON output was truncated because it reached the token limit.";
  assert.match(friendlyAgentError(message, "zh"), /没有完成这次生成/);
  assert.match(friendlyAgentError(message, "zh"), /减少单次提交的材料/);
  assert.doesNotMatch(friendlyAgentError(message, "zh"), /请求内容过长/);
});

test("friendlyAgentError suggests a simple retry after compact output fails", () => {
  const message = "DeepSeek structured output remained truncated after JobPilot's compact retry.";
  assert.match(friendlyAgentError(message, "zh"), /自动精简并重试/);
  assert.match(friendlyAgentError(message, "en"), /submit less material/i);
});

test("friendlyAgentError distinguishes an unsupported company site from a failed recommendation", () => {
  const message = "No supported Greenhouse, Lever, or Ashby company source could be verified and connected.";
  assert.match(friendlyAgentError(message, "zh"), /没有添加连接器/);
  assert.match(friendlyAgentError(message, "zh"), /“标准”模式/);
  assert.match(friendlyAgentError(message, "en"), /no connector was added/i);
});
