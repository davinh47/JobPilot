import { z } from "zod";
import type { AiProvider } from "@/lib/ai-provider-config";
import { readLocalSecrets } from "@/lib/secrets";
import { recordAiUsageBestEffort } from "@/lib/ai-usage";
import { aiModelCapabilities } from "@/lib/ai-models";
import { compactPromptToTokenBudget, estimateTokens } from "@/lib/token-budget";

const responseSchema = z.object({
  choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    prompt_cache_hit_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
});

type Message = { role: "system" | "user" | "assistant"; content: string };
function issueSummary(error: z.ZodError) {
  return error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ");
}

export type StructuredRequest<T> = {
  userId?: string;
  agentRunId?: string;
  taskType?: string;
  promptVersion?: string;
  provider: AiProvider | string;
  apiBaseUrl: string;
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  outputMode?: "compact" | "complete";
  maxOutputTokens?: number;
  timeoutMs?: number;
  deepseekThinking?: "enabled" | "disabled";
};

function providerFor(request: StructuredRequest<unknown>): AiProvider {
  if (request.provider !== "deepseek" && request.provider !== "openai") throw new Error(`Unsupported AI provider: ${request.provider}`);
  return request.provider;
}

function providerName(provider: AiProvider) {
  return provider === "openai" ? "OpenAI" : "DeepSeek";
}

function jsonContent(value: string) {
  const withoutThinking = value.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "").trim();
  const withoutFence = withoutThinking.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  return start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence;
}

export async function requestStructuredAiJson<T>(request: StructuredRequest<T>) {
  const provider = providerFor(request);
  const { deepseekApiKey, openaiApiKey } = await readLocalSecrets(request.userId);
  const apiKey = provider === "openai" ? openaiApiKey : deepseekApiKey;
  if (!apiKey) throw new Error(`${providerName(provider)} API key is not configured.`);
  return requestStructuredAiJsonWithKey({ ...request, provider, apiKey });
}

export async function requestStructuredAiJsonWithKey<T>({ apiBaseUrl, model, system, user, schema, outputMode = "compact", maxOutputTokens, timeoutMs, deepseekThinking, apiKey, fetcher = fetch, userId, agentRunId, taskType = "structured", promptVersion, ...request }: StructuredRequest<T> & { apiKey: string; fetcher?: typeof fetch }) {
  const provider = providerFor({ ...request, userId, agentRunId, taskType, promptVersion, apiBaseUrl, model, system, user, schema });
  const name = providerName(provider);
  const capabilities = aiModelCapabilities(provider, model);
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  const coverageInstruction = outputMode === "complete"
    ? "Cover every distinct, schema-relevant fact or conclusion supported by the source. Keep each item concise and non-repetitive, but do not reduce factual coverage merely to shorten the response."
    : "Prefer the fewest items needed for a useful result.";
  const schemaPrompt = `${system}\n\nReturn one compact JSON object only. The response must validate against this exact JSON Schema. Every required key must be present; use null only where the schema permits null. Do not restate source material unless a schema field explicitly requires it. ${coverageInstruction}\n<OUTPUT_JSON_SCHEMA>\n${jsonSchema}\n</OUTPUT_JSON_SCHEMA>`;
  const initialOutputTokens = Math.min(maxOutputTokens ?? (provider === "deepseek" ? 8000 : 6000), capabilities.maxOutputTokens);
  const schemaTokens = estimateTokens(schemaPrompt);
  const contextUserLimit = Math.max(1_000, capabilities.contextWindowTokens - initialOutputTokens - schemaTokens - 8_000);
  const promptTokenLimit = Math.min(contextUserLimit, capabilities.structuredInputTokens);
  const requestDeadline = Date.now() + Math.max(1_000, timeoutMs ?? capabilities.defaultTimeoutMs);
  let callIndex = 0;

  async function complete(messages: Message[], outputTokens = initialOutputTokens) {
    const retryIndex = callIndex;
    callIndex += 1;
    const startedAt = Date.now();
    const controller = new AbortController();
    const remainingMs = requestDeadline - Date.now();
    if (remainingMs <= 0) throw new Error(`${name} request timed out.`);
    const timeout = setTimeout(() => controller.abort(), remainingMs);
    try {
      const isOpenAi = provider === "openai";
      const response = await fetcher(`${apiBaseUrl.replace(/\/$/, "")}/${isOpenAi ? "responses" : "chat/completions"}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(isOpenAi
        ? { model, input: messages, text: { format: { type: "json_object" } }, max_output_tokens: outputTokens }
        : { model, messages, response_format: { type: "json_object" }, max_tokens: Math.min(outputTokens, capabilities.maxOutputTokens), stream: false, thinking: { type: deepseekThinking ?? "disabled" } }),
      signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        if (/token|context length|maximum context|1039/i.test(detail)) throw new Error(`${name} rejected an oversized request. JobPilot compacted the input; retry with less source text or a longer-context model.`);
        throw new Error(`${name} returned HTTP ${response.status}: ${detail}`);
      }
      const rawResponse = await response.json();
      if (isOpenAi) {
        const parsed = z.object({
          status: z.string().optional(),
          incomplete_details: z.object({ reason: z.string().optional() }).nullable().optional(),
          output: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })).default([]),
          usage: z.object({
            input_tokens: z.number().int().nonnegative().optional(),
            output_tokens: z.number().int().nonnegative().optional(),
            input_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative().optional() }).optional(),
          }).optional(),
        }).passthrough().parse(rawResponse);
        const text = parsed.output.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text ?? "";
        if (userId) {
          await recordAiUsageBestEffort({
            userId,
            agentRunId,
            provider,
            model,
            taskType,
            promptVersion,
            inputTokens: parsed.usage?.input_tokens ?? estimateTokens(messages.map((message) => message.content).join("\n")),
            outputTokens: parsed.usage?.output_tokens ?? estimateTokens(text),
            cachedInputTokens: parsed.usage?.input_tokens_details?.cached_tokens ?? 0,
            latencyMs: Date.now() - startedAt,
            retryIndex,
            usageEstimated: !parsed.usage,
          });
        }
        if (parsed.status === "incomplete") throw new Error(`${name} JSON output was incomplete: ${parsed.incomplete_details?.reason ?? "output limit"}.`);
        return text;
      }
      const serviceError = z.object({ base_resp: z.object({ status_code: z.number(), status_msg: z.string().optional() }).optional() }).passthrough().safeParse(rawResponse);
      if (serviceError.success && serviceError.data.base_resp && serviceError.data.base_resp.status_code !== 0) throw new Error(`${name} returned API error ${serviceError.data.base_resp.status_code}: ${serviceError.data.base_resp.status_msg || "Unknown service error"}`);
      const parsedResponse = responseSchema.parse(rawResponse);
      const choice = parsedResponse.choices[0];
      const text = choice?.message.content ?? "";
      if (userId) {
        await recordAiUsageBestEffort({
          userId,
          agentRunId,
          provider,
          model,
          taskType,
          promptVersion,
          inputTokens: parsedResponse.usage?.prompt_tokens ?? estimateTokens(messages.map((message) => message.content).join("\n")),
          outputTokens: parsedResponse.usage?.completion_tokens ?? estimateTokens(text),
          cachedInputTokens: parsedResponse.usage?.prompt_cache_hit_tokens ?? 0,
          latencyMs: Date.now() - startedAt,
          retryIndex,
          usageEstimated: !parsedResponse.usage,
        });
      }
      if (choice?.finish_reason === "length") throw new Error(`${name} JSON output was truncated because it reached the token limit.`);
      return text;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error(`${name} request timed out.`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  const messages: Message[] = [{ role: "system", content: schemaPrompt }, { role: "user", content: compactPromptToTokenBudget(user, promptTokenLimit) }];
  let content: string;
  try {
    content = await complete(messages);
  } catch (error) {
    if (!(error instanceof Error) || !/JSON output was truncated because it reached the token limit/i.test(error.message)) throw error;
    try {
      content = await complete([...messages, { role: "user", content: "The previous response exceeded the output limit. Return the complete JSON object again in a much more concise form. Use short non-repetitive strings, keep only the highest-value items, and use no more than 6 items per array unless the schema requires more. Preserve exact source quotes only where required. Do not add commentary." }], Math.max(initialOutputTokens, 8000));
    } catch (retryError) {
      if (retryError instanceof Error && /JSON output was truncated because it reached the token limit/i.test(retryError.message)) {
        throw new Error(`${name} structured output remained truncated after JobPilot's compact retry.`);
      }
      throw retryError;
    }
  }
  if (!content.trim()) content = await complete([...messages, { role: "user", content: "The previous response was empty. Return the complete JSON object now, with every required key." }]);
  let json: unknown;
  try {
    json = JSON.parse(jsonContent(content));
  } catch {
    throw new Error(`${name} returned content that was not valid JSON.`);
  }
  const firstPass = schema.safeParse(json);
  if (firstPass.success) return firstPass.data;

  const repairMessages: Message[] = [
    ...messages,
    { role: "assistant", content: content.slice(0, 30_000) },
    { role: "user", content: `Your JSON failed schema validation: ${issueSummary(firstPass.error)}. Correct only the structure and missing fields. Preserve source-grounded facts and exact evidence quotes. Return the complete corrected JSON object only.` },
  ];
  const repairedContent = await complete(repairMessages);
  let repairedJson: unknown;
  try {
    repairedJson = JSON.parse(jsonContent(repairedContent));
  } catch {
    throw new Error(`${name} returned invalid JSON while repairing its structured response.`);
  }
  const repaired = schema.safeParse(repairedJson);
  if (!repaired.success) throw new Error(`${name} returned incomplete structured data after one repair attempt: ${issueSummary(repaired.error)}`);
  return repaired.data;
}
