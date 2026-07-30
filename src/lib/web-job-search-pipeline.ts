import { PublicWebError } from "@/lib/public-web";

export type PipelineErrorCode =
  | "rate_limited"
  | "timeout"
  | "blocked"
  | "invalid_response"
  | "network"
  | "unknown";

export type PipelineErrorBreakdown = Partial<Record<PipelineErrorCode, number>>;

export function classifyPipelineError(error: unknown): PipelineErrorCode {
  if (error instanceof PublicWebError) {
    if (error.code === "TIMEOUT") return "timeout";
    if (["INVALID_URL", "NON_STANDARD_PORT", "LOCAL_ADDRESS", "PRIVATE_ADDRESS"].includes(error.code)) return "blocked";
    if (error.code === "DNS_FAILURE") return "network";
  }
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/HTTP 429|rate.?limit|quota|insufficient balance/i.test(message)) return "rate_limited";
  if (/timed? ?out|timeout|AbortError|UND_ERR_CONNECT_TIMEOUT/i.test(message)) return "timeout";
  if (/private network|local addresses|non-standard ports|not allowed|SSRF/i.test(message)) return "blocked";
  if (/invalid JSON|not valid JSON|incomplete structured|schema|invalid response/i.test(message)) return "invalid_response";
  if (/network|fetch failed|socket|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) return "network";
  return "unknown";
}

export function recordPipelineError(breakdown: PipelineErrorBreakdown, error: unknown) {
  const code = classifyPipelineError(error);
  breakdown[code] = (breakdown[code] ?? 0) + 1;
  return code;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
  return results;
}

export function collectDiverseCandidates<T extends { url: string }>(resultSets: T[][], maxUrls: number) {
  const candidates = new Map<string, T>();
  const largestSet = Math.max(0, ...resultSets.map((results) => results.length));
  for (let resultIndex = 0; resultIndex < largestSet && candidates.size < maxUrls; resultIndex += 1) {
    for (const results of resultSets) {
      const candidate = results[resultIndex];
      if (!candidate || candidates.has(candidate.url)) continue;
      candidates.set(candidate.url, candidate);
      if (candidates.size >= maxUrls) break;
    }
  }
  return Array.from(candidates.values());
}
