export function estimateTokens(value: string) {
  let latinLike = 0;
  let cjkLike = 0;
  for (const character of value) {
    if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(character)) cjkLike += 1;
    else latinLike += 1;
  }
  return Math.max(1, Math.ceil(latinLike / 4 + cjkLike / 1.5));
}

export function compactToTokenBudget(value: string, maxTokens: number) {
  if (estimateTokens(value) <= maxTokens) return value;
  const marker = "\n\n[JobPilot compacted source content to fit the task token budget.]\n\n";
  if (estimateTokens(marker) >= maxTokens) return value.slice(0, Math.max(1, maxTokens));
  let low = 0;
  let high = value.length;
  let result = marker;
  while (low <= high) {
    const keptCharacters = Math.floor((low + high) / 2);
    const headLength = Math.floor(keptCharacters * 0.72);
    const tailLength = keptCharacters - headLength;
    const candidate = `${value.slice(0, headLength)}${marker}${tailLength ? value.slice(-tailLength) : ""}`;
    if (estimateTokens(candidate) <= maxTokens) {
      result = candidate;
      low = keptCharacters + 1;
    } else high = keptCharacters - 1;
  }
  return result;
}

type TaggedSegment = { prefix: string; body: string; suffix: string };

function taggedSegments(value: string) {
  const segments: TaggedSegment[] = [];
  const pattern = /(<([A-Z][A-Z0-9_-]*)(?:\s[^>]*)?>)([\s\S]*?)(<\/\2>)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ prefix: "", body: value.slice(cursor, index), suffix: "" });
    segments.push({ prefix: match[1] ?? "", body: match[3] ?? "", suffix: match[4] ?? "" });
    cursor = index + match[0].length;
  }
  if (cursor < value.length) segments.push({ prefix: "", body: value.slice(cursor), suffix: "" });
  return segments;
}

function distributeTokenBudget(tokenCounts: number[], availableTokens: number) {
  const allocations = tokenCounts.map(() => 0);
  const remaining = new Set(tokenCounts.map((_, index) => index));
  let available = Math.max(0, availableTokens);
  while (remaining.size && available > 0) {
    const share = Math.max(1, Math.floor(available / remaining.size));
    let completed = false;
    for (const index of [...remaining]) {
      const needed = tokenCounts[index]!;
      if (needed <= share) {
        allocations[index] = needed;
        available -= needed;
        remaining.delete(index);
        completed = true;
      }
    }
    if (completed) continue;
    for (const index of remaining) allocations[index] = share;
    break;
  }
  return allocations;
}

export function compactPromptToTokenBudget(value: string, maxTokens: number) {
  if (estimateTokens(value) <= maxTokens) return value;
  const segments = taggedSegments(value);
  if (segments.length < 2) return compactToTokenBudget(value, maxTokens);
  const wrapperTokens = segments.reduce((total, segment) => total + estimateTokens(segment.prefix + segment.suffix), 0);
  if (wrapperTokens >= maxTokens) return compactToTokenBudget(value, maxTokens);
  const bodyTokens = segments.map((segment) => estimateTokens(segment.body));
  const allocations = distributeTokenBudget(bodyTokens, maxTokens - wrapperTokens);
  return segments.map((segment, index) => `${segment.prefix}${compactToTokenBudget(segment.body, allocations[index] ?? 1)}${segment.suffix}`).join("");
}
