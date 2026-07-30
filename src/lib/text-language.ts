export type ContentLanguage = "zh" | "en";

export function detectTextLanguage(value: string): ContentLanguage {
  const chineseCount = value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinCount = value.match(/[a-z]/gi)?.length ?? 0;
  return chineseCount >= 20 && chineseCount / Math.max(latinCount, 1) >= 0.08 ? "zh" : "en";
}

export function localeCompatibleFallback(value: string, locale: ContentLanguage) {
  if (locale === "en" && /[\u3400-\u9fff]/.test(value)) return "";
  return value;
}
