import { isPlatformResume, normalizePlatformResume } from "@/lib/resume-format";
import type { Locale } from "@/lib/i18n";
import { detectTextLanguage } from "@/lib/text-language";

export type CoverLetterDocumentMeta = {
  identity: {
    fullName: string;
    headline: string;
    email: string;
    phone: string;
    location: string;
    links: string;
  };
  companyName: string;
  jobTitle: string;
  dateLabel: string;
};

export function coverLetterOutputLocale(sourceRefs: Array<{ type: string; id: string }>, content: string): Locale {
  const stored = sourceRefs.find((source) => source.type === "output_language")?.id;
  return stored === "zh" || stored === "en" ? stored : detectTextLanguage(content);
}

export function createCoverLetterDocumentMeta(
  structuredResume: unknown,
  job: { companyName: string; title: string },
  date: Date,
  locale: Locale,
  fallbackLocation = "",
): CoverLetterDocumentMeta {
  const resume = isPlatformResume(structuredResume) ? normalizePlatformResume(structuredResume) : null;
  const identity = resume?.basics ?? {
    fullName: "",
    headline: "",
    email: "",
    phone: "",
    location: "",
    links: "",
    additionalInfo: "",
  };
  return {
    identity: { ...identity, location: identity.location.trim() || fallbackLocation.trim() },
    companyName: job.companyName,
    jobTitle: job.title,
    dateLabel: new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-AU", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date),
  };
}

export function coverLetterContactLines(meta: CoverLetterDocumentMeta) {
  return [
    meta.identity.location,
    meta.identity.phone,
    meta.identity.email,
  ].map((line) => line.trim()).filter(Boolean);
}

export function coverLetterSenderLines(meta: CoverLetterDocumentMeta) {
  return [
    meta.identity.fullName,
    ...coverLetterContactLines(meta),
    meta.dateLabel,
  ].map((line) => line.trim()).filter(Boolean);
}

export function coverLetterParagraphs(content: string) {
  return content.replace(/\r/g, "").split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
}

export function cleanCoverLetterContent(content: string, meta: CoverLetterDocumentMeta) {
  const normalize = (value: string) => value.toLowerCase().replace(/https?:\/\//g, "").replace(/[\s/]+/g, "");
  const trailingContacts = [
    meta.identity.email,
    meta.identity.phone,
    meta.identity.location,
    ...meta.identity.links.split(/\s*(?:\||\n)\s*/),
  ].map(normalize).filter(Boolean);
  const lines = content.replace(/\r/g, "").split("\n");
  while (lines.length) {
    const last = lines.at(-1)?.trim() ?? "";
    if (!last) {
      lines.pop();
      continue;
    }
    if (!trailingContacts.includes(normalize(last))) break;
    lines.pop();
  }
  return lines.join("\n").trim();
}

export function renderCoverLetterPlainText(meta: CoverLetterDocumentMeta, content: string) {
  return [
    ...coverLetterSenderLines(meta),
    cleanCoverLetterContent(content, meta),
  ].filter(Boolean).join("\n") + "\n";
}
