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
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(value.slice(0, middle)) <= maxTokens) low = middle;
    else high = middle - 1;
  }
  const marker = "\n\n[JobPilot compacted source content to fit the task token budget.]\n\n";
  const available = Math.max(1, low - marker.length);
  const headLength = Math.floor(available * 0.72);
  return `${value.slice(0, headLength)}${marker}${value.slice(-(available - headLength))}`;
}
