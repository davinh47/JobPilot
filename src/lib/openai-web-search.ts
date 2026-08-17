import { z } from "zod";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readLocalSecrets } from "@/lib/secrets";
import { networkRequestError } from "@/lib/network-errors";
import { openAiCompatibleJsonSchema } from "@/lib/openai-schema";
import { recordAiUsageBestEffort } from "@/lib/ai-usage";
import { selectAiModel } from "@/lib/ai-models";
import { estimateTokens } from "@/lib/token-budget";

const responseSchema = z.object({
  status: z.string().optional(),
  incomplete_details: z.object({ reason: z.string().optional() }).nullable().optional(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })).default([]),
  usage: z.object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    input_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative().optional() }).optional(),
  }).optional(),
}).passthrough();

function outputText(value: z.infer<typeof responseSchema>) {
  return value.output.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text ?? "";
}

function jsonContent(value: string) {
  const clean = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  return start >= 0 && end > start ? clean.slice(start, end + 1) : clean;
}

async function configuredOpenAi(userId: string) {
  const [settings, secrets] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.userId, userId)).get(),
    readLocalSecrets(userId),
  ]);
  if (!settings?.aiEnabled || settings.aiProvider !== "openai") throw new Error("Live web search requires OpenAI to be selected and enabled in Settings.");
  if (!secrets.openaiApiKey) throw new Error("OpenAI API key is not configured.");
  return { apiBaseUrl: settings.aiBaseUrl, model: selectAiModel(settings, "web"), apiKey: secrets.openaiApiKey };
}

export async function requestOpenAiWebJson<T>({
  userId, input, schema, agentRunId, promptVersion, searchContextSize = "low", timeoutMs = 180_000,
}: {
  userId: string;
  input: string;
  schema: z.ZodType<T>;
  agentRunId?: string;
  promptVersion?: string;
  searchContextSize?: "low" | "medium" | "high";
  timeoutMs?: number;
}) {
  const { apiBaseUrl, model, apiKey } = await configuredOpenAi(userId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
  const startedAt = Date.now();
  try {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          tools: [{ type: "web_search", search_context_size: searchContextSize }],
          tool_choice: "auto",
          input,
          text: { format: { type: "json_schema", name: "jobpilot_web_result", strict: true, schema: openAiCompatibleJsonSchema(schema) } },
          max_output_tokens: 8000,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw networkRequestError("OpenAI", error, controller.signal.aborted);
    }
    if (!response.ok) throw new Error(`OpenAI web search returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const parsedResponse = responseSchema.parse(await response.json());
    if (parsedResponse.status === "incomplete") throw new Error(`OpenAI web search was incomplete: ${parsedResponse.incomplete_details?.reason ?? "output limit"}.`);
    const responseText = outputText(parsedResponse);
    await recordAiUsageBestEffort({
      userId,
      agentRunId,
      provider: "openai",
      model,
      taskType: "web_search",
      promptVersion,
      inputTokens: parsedResponse.usage?.input_tokens ?? estimateTokens(input),
      outputTokens: parsedResponse.usage?.output_tokens ?? estimateTokens(responseText),
      cachedInputTokens: parsedResponse.usage?.input_tokens_details?.cached_tokens ?? 0,
      toolCallCount: parsedResponse.output.filter((item) => item.type === "web_search_call").length,
      latencyMs: Date.now() - startedAt,
    });
    let json: unknown;
    try { json = JSON.parse(jsonContent(responseText)); }
    catch { throw new Error("OpenAI web search did not return valid structured data."); }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(`OpenAI web search returned incomplete structured data: ${parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
}

const webResultsSchema = z.object({
  results: z.array(z.object({
    title: z.string().min(1).max(300),
    url: z.url(),
    description: z.string().max(1000),
  })).max(12),
});

export async function searchOpenAiWeb(userId: string, query: string, options: { count?: number } = {}) {
  const count = Math.min(12, Math.max(1, options.count ?? 8));
  const result = await requestOpenAiWebJson({
    userId,
    schema: webResultsSchema,
    input: `Search the live public web for the following query. Return up to ${count} directly relevant results. Use only URLs actually found through web search. Prefer official company careers pages and public ATS job boards over aggregators. Do not invent URLs.\n\n<QUERY>\n${query.replace(/[<>]/g, " ").slice(0, 1200)}\n</QUERY>`,
  });
  return result.results.slice(0, count);
}
