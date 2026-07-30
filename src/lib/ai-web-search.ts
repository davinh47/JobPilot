import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { requestDeepSeekWebJson } from "@/lib/deepseek-web-search";
import { requestOpenAiWebJson } from "@/lib/openai-web-search";

const webResultsSchema = z.object({
  results: z.array(z.object({
    title: z.string().min(1).max(300),
    url: z.url(),
    description: z.string().max(1000),
  })).max(12),
});

async function selectedProvider(userId: string) {
  const settings = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).get();
  if (!settings?.aiEnabled) throw new Error("AI assistance is disabled.");
  if (settings.aiProvider !== "openai" && settings.aiProvider !== "deepseek") throw new Error("The selected AI provider does not support live web search.");
  return settings.aiProvider;
}

export async function requestAiWebJson<T>({ userId, input, schema, searchContextSize = "low", maxUses = 5, agentRunId, promptVersion, timeoutMs }: { userId: string; input: string; schema: z.ZodType<T>; searchContextSize?: "low" | "medium" | "high"; maxUses?: number; agentRunId?: string; promptVersion?: string; timeoutMs?: number }) {
  const provider = await selectedProvider(userId);
  return provider === "openai"
    ? requestOpenAiWebJson({ userId, input, schema, searchContextSize, agentRunId, promptVersion, timeoutMs })
    : requestDeepSeekWebJson({ userId, input, schema, maxUses, agentRunId, promptVersion, timeoutMs });
}

export type WebSearchResultMode = "general" | "job_listings";

export function webSearchRequestPrompt(query: string, count: number, mode: WebSearchResultMode) {
  const request = mode === "job_listings"
    ? `Return up to ${count} individual, currently advertised job listing pages that directly match the query. Every result URL must open one specific job, not a search page, company careers homepage, multi-job index, article, or aggregator landing page. Individual listing pages on job platforms are allowed. For each result description, include source-grounded evidence for the job title, employer, location when available, and a concise responsibility or requirement so the listing can still be verified when its website blocks direct fetching. Return fewer results when exact individual listings cannot be found.`
    : `Return up to ${count} directly relevant results.`;
  return `Search the live public web for the following query. ${request} Use only URLs actually found through web search. Do not invent URLs.\n\n<QUERY>\n${query.replace(/[<>]/g, " ").slice(0, 1200)}\n</QUERY>`;
}

export async function searchAiWeb(userId: string, query: string, options: { count?: number; agentRunId?: string; promptVersion?: string; timeoutMs?: number; mode?: WebSearchResultMode } = {}) {
  const count = Math.min(12, Math.max(1, options.count ?? 8));
  const result = await requestAiWebJson({
    userId,
    schema: webResultsSchema,
    maxUses: 4,
    agentRunId: options.agentRunId,
    promptVersion: options.promptVersion,
    timeoutMs: options.timeoutMs,
    input: webSearchRequestPrompt(query, count, options.mode ?? "general"),
  });
  return result.results.slice(0, count);
}
