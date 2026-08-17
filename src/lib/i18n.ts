import { cookies } from "next/headers";

export type Locale = "zh" | "en";

export const messages = {
  zh: {
    continue: "继续",
    cancel: "取消",
    save: "保存",
    loading: "处理中…",
    genericError: "操作未完成，请稍后重试。",
  },
  en: {
    continue: "Continue",
    cancel: "Cancel",
    save: "Save",
    loading: "Working…",
    genericError: "The action did not complete. Try again.",
  },
} as const;

export type MessageKey = keyof typeof messages.en;

export function translate(locale: Locale, key: MessageKey) {
  return messages[locale][key];
}

export function localeFromStored(value: string | null | undefined): Locale {
  return value?.toLowerCase().startsWith("en") ? "en" : "zh";
}

export function storedLocale(locale: Locale) {
  return locale === "en" ? "en-US" : "zh-CN";
}

export function aiLanguageInstruction(locale: Locale) {
  return locale === "zh"
    ? "The interface language is Simplified Chinese (简体中文). All user-facing generated text must be written in Simplified Chinese, regardless of the language used by the resume, job description, or web sources. This applies to every explanation, summary, label, reason, recommendation, gap, uncertainty, question, and suggested wording. Keep only required exact source quotes, URLs, proper nouns, and literal search terms in their original form."
    : "The interface language is English. All user-facing generated text must be written in English, regardless of the language used by the resume, job description, or web sources. This applies to every explanation, summary, label, reason, recommendation, gap, uncertainty, question, and suggested wording. Keep only required exact source quotes, URLs, proper nouns, and literal search terms in their original form.";
}

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return localeFromStored(store.get("jobpilot_locale")?.value);
}

export function pick(locale: Locale, zh: string, en: string) {
  return locale === "zh" ? zh : en;
}

export function formatLocaleDate(date: Date | null | undefined, locale: Locale) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
