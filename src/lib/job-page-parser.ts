import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { NormalizedJob } from "@/lib/job-sources/types";
import { extractReadableText } from "@/lib/public-web";
import { cleanJobText, structureJobDescription } from "@/lib/job-description";

export type JobPageHints = {
  title?: string | null;
  companyName?: string | null;
  location?: string | null;
  salaryText?: string | null;
  employmentType?: string | null;
  descriptionText?: string | null;
};

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanText(value: string) {
  return cleanJobText(value);
}

function salaryFromPosting(posting: Record<string, unknown>) {
  const salary = posting.baseSalary;
  if (typeof salary === "number") return { salaryMin: salary, salaryMax: salary, salaryCurrency: null };
  if (!salary || typeof salary !== "object") return { salaryMin: null, salaryMax: null, salaryCurrency: null };
  const amount = salary as Record<string, unknown>;
  const value = amount.value && typeof amount.value === "object" ? amount.value as Record<string, unknown> : amount;
  const numeric = (input: unknown) => typeof input === "number" && Number.isFinite(input) ? Math.round(input) : null;
  const exact = numeric(value.value);
  return {
    salaryMin: numeric(value.minValue) ?? exact,
    salaryMax: numeric(value.maxValue) ?? exact,
    salaryCurrency: textValue(amount.currency) ?? textValue(posting.salaryCurrency),
  };
}

export function parseSalaryText(value: string | null | undefined) {
  if (!value) return { salaryMin: null, salaryMax: null, salaryCurrency: null };
  const currency = /(?:A\$|AUD)/i.test(value) ? "AUD" : /(?:HK\$|HKD)/i.test(value) ? "HKD" : /(?:S\$|SGD)/i.test(value) ? "SGD" : /(?:£|GBP)/i.test(value) ? "GBP" : /(?:€|EUR)/i.test(value) ? "EUR" : /(?:¥|￥|CNY|RMB)/i.test(value) ? "CNY" : /(?:\$|USD)/i.test(value) ? "USD" : null;
  const values = [...value.matchAll(/(?:[$£€¥￥]\s*)?(\d+(?:[,.]\d+)?)(\s*[kK万])?/g)].map((match) => {
    const base = Number(match[1]?.replace(/,/g, ""));
    const multiplier = /[kK]/.test(match[2] ?? "") ? 1_000 : /万/.test(match[2] ?? "") ? 10_000 : 1;
    return Number.isFinite(base) ? Math.round(base * multiplier) : null;
  }).filter((item): item is number => item != null && item >= 100);
  return { salaryMin: values[0] ?? null, salaryMax: values[1] ?? values[0] ?? null, salaryCurrency: currency };
}

function htmlToText(value: string) {
  const $ = load(value);
  $("script,style,noscript").remove();
  $("br").replaceWith("\n");
  $("p,li,h1,h2,h3,h4").each((_, element) => { $(element).append("\n"); });
  return cleanText($.root().text());
}

function removePageNoise($: ReturnType<typeof load>) {
  $("script,style,noscript,template,svg,canvas,iframe,nav,header,footer,aside,form,button,[role='button'],[aria-hidden='true'],[class*='cookie'],[class*='modal'],[class*='breadcrumb'],[class*='share'],[class*='social'],[class*='save-job'],[class*='favorite'],a[class*='button'],a[class*='btn'],a[href*='apply']").remove();
}

function dateValue(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function typeIncludes(value: unknown, expected: string) {
  return typeof value === "string" ? value === expected : Array.isArray(value) && value.includes(expected);
}

function collectJobPostings(value: unknown, found: Record<string, unknown>[] = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) collectJobPostings(item, found);
    return found;
  }
  const object = value as Record<string, unknown>;
  if (typeIncludes(object["@type"], "JobPosting")) found.push(object);
  for (const child of Object.values(object)) if (child && typeof child === "object") collectJobPostings(child, found);
  return found;
}

function locationFromPosting(posting: Record<string, unknown>) {
  if (textValue(posting.jobLocationType)?.toLowerCase().includes("telecommute")) return { location: "Remote", workplaceType: "remote" as const };
  const locations = Array.isArray(posting.jobLocation) ? posting.jobLocation : [posting.jobLocation];
  const parts: string[] = [];
  for (const location of locations) {
    if (!location || typeof location !== "object") continue;
    const address = (location as Record<string, unknown>).address;
    if (typeof address === "string") parts.push(address);
    else if (address && typeof address === "object") {
      const fields = address as Record<string, unknown>;
      parts.push([textValue(fields.addressLocality), textValue(fields.addressRegion), textValue(fields.addressCountry)].filter(Boolean).join(", "));
    }
  }
  return { location: parts.filter(Boolean).join("; ") || null, workplaceType: "unknown" as const };
}

export function parseJobPostings(html: string, pageUrl: string): NormalizedJob[] {
  const $ = load(html);
  const postings: Record<string, unknown>[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try { collectJobPostings(JSON.parse($(element).text()), postings); } catch { /* Ignore malformed structured data. */ }
  });
  return postings.flatMap((posting, index) => {
    const organization = posting.hiringOrganization && typeof posting.hiringOrganization === "object" ? posting.hiringOrganization as Record<string, unknown> : {};
    const companyName = textValue(organization.name);
    const title = textValue(posting.title);
    const rawDescription = textValue(posting.description);
    if (!companyName || !title || !rawDescription) return [];
    let canonicalUrl = textValue(posting.url) ?? pageUrl;
    try { canonicalUrl = new URL(canonicalUrl, pageUrl).toString(); } catch { canonicalUrl = pageUrl; }
    const location = locationFromPosting(posting);
    const descriptionText = /<[^>]+>/.test(rawDescription) ? htmlToText(rawDescription) : rawDescription;
    if (descriptionText.length < 80) return [];
    const employment = Array.isArray(posting.employmentType) ? posting.employmentType.join(", ") : textValue(posting.employmentType);
    const salary = salaryFromPosting(posting);
    return [{
      externalId: textValue(posting.identifier && typeof posting.identifier === "object" ? (posting.identifier as Record<string, unknown>).value : posting.identifier) ?? createHash("sha256").update(`${canonicalUrl}:${index}`).digest("hex").slice(0, 24),
      companyName,
      title,
      location: location.location,
      workplaceType: location.workplaceType,
      employmentType: employment,
      ...salary,
      descriptionText: structureJobDescription(descriptionText),
      canonicalUrl,
      publishedAt: dateValue(posting.datePosted),
    }];
  });
}

function firstText($: ReturnType<typeof load>, selectors: string[]) {
  for (const selector of selectors) {
    const element = $(selector).first();
    const value = cleanText(element.attr("content") || element.text());
    if (value) return value;
  }
  return null;
}

function workplace(value: string | null | undefined): NormalizedJob["workplaceType"] {
  const source = value?.toLowerCase() ?? "";
  if (source.includes("remote") || source.includes("远程")) return "remote";
  if (source.includes("hybrid") || source.includes("混合")) return "hybrid";
  if (source.includes("onsite") || source.includes("on-site") || source.includes("现场")) return "onsite";
  return "unknown";
}

export function extractJobFromPage(html: string, pageUrl: string, hints?: JobPageHints): NormalizedJob | null {
  const structuredJobs = parseJobPostings(html, pageUrl);
  const normalizedPageUrl = pageUrl.replace(/[?#].*$/, "").replace(/\/$/, "");
  const structured = structuredJobs.find((job) => job.canonicalUrl.replace(/[?#].*$/, "").replace(/\/$/, "") === normalizedPageUrl) ?? (structuredJobs.length === 1 ? structuredJobs[0] : null);
  if (structured) return structured;
  const readable = extractReadableText(html, pageUrl);
  const $ = load(html);
  removePageNoise($);
  const title = hints?.title || firstText($, ["[data-automation='job-detail-title']", "[data-testid='job-title']", "h1", "meta[property='og:title']"]) || readable?.title;
  const companyName = hints?.companyName || firstText($, ["[data-automation='advertiser-name']", ".job-details-jobs-unified-top-card__company-name", "[data-testid='company-name']", "[class*='company-name']", "meta[property='og:site_name']"]) || readable?.siteName;
  const location = hints?.location || firstText($, ["[data-automation='job-detail-location']", ".job-details-jobs-unified-top-card__bullet", "[data-testid='job-location']", "[class*='location']"]);
  const descriptionText = cleanText(hints?.descriptionText || firstText($, ["[data-automation='jobAdDetails']", ".jobs-description__content", "[data-testid='job-description']", "[class*='job-description']", "main", "article"]) || readable?.text || "");
  if (!title || !companyName || descriptionText.length < 80) return null;
  const salary = parseSalaryText(hints?.salaryText || firstText($, ["[data-automation*='salary']", "[data-testid*='salary']", "[class*='salary']"]));
  return { externalId: createHash("sha256").update(pageUrl).digest("hex").slice(0, 24), companyName, title, location, workplaceType: workplace(`${location ?? ""}\n${descriptionText.slice(0, 1000)}`), employmentType: hints?.employmentType ?? null, ...salary, descriptionText: structureJobDescription(descriptionText), canonicalUrl: pageUrl, publishedAt: dateValue(readable?.publishedTime) };
}

function capturedTitle(value: string) {
  const ignored = /^(?:apply(?: now)?|save job|share|job description|overview|responsibilities|requirements|qualifications|职位描述|岗位描述|岗位职责|任职要求|申请职位|收藏|分享)$/i;
  return cleanText(value)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length >= 2 && line.length <= 300 && !ignored.test(line)) ?? null;
}

function capturedCompanyFallback(pageUrl: string, value: string) {
  let host = "";
  try { host = new URL(pageUrl).hostname.replace(/^www\./i, ""); } catch { /* Keep the generic marker. */ }
  return /[\u3400-\u9fff]/.test(value)
    ? `待识别公司${host ? `（${host}）` : ""}`
    : `Company to identify${host ? ` (${host})` : ""}`;
}

/**
 * Build a deliberately transparent placeholder when the extension has useful
 * visible text but a site did not expose a company field. The background AI
 * cleanup can replace the placeholder after the job has been saved.
 */
export function extractJobFromCapturedText(text: string, pageUrl: string, hints?: JobPageHints): NormalizedJob | null {
  const descriptionText = cleanText(text || hints?.descriptionText || "");
  if (descriptionText.length < 80) return null;
  const title = textValue(hints?.title) ?? capturedTitle(descriptionText);
  if (!title) return null;
  const companyName = textValue(hints?.companyName) ?? capturedCompanyFallback(pageUrl, descriptionText);
  const location = textValue(hints?.location);
  const salary = parseSalaryText(hints?.salaryText);
  return {
    externalId: createHash("sha256").update(pageUrl).digest("hex").slice(0, 24),
    companyName,
    title,
    location,
    workplaceType: workplace(`${location ?? ""}\n${descriptionText.slice(0, 1000)}`),
    employmentType: hints?.employmentType ?? null,
    ...salary,
    descriptionText: structureJobDescription(descriptionText),
    canonicalUrl: pageUrl,
    publishedAt: null,
  };
}

export function extractCapturedJobText(html: string, pageUrl: string) {
  return extractReadableText(html, pageUrl)?.text ?? "";
}

export function isLikelySpecificJobPage(job: NormalizedJob) {
  const urlPath = new URL(job.canonicalUrl).pathname.toLowerCase();
  const source = `${job.title}\n${job.descriptionText.slice(0, 12_000)}`.toLowerCase();
  const signals = ["responsibilities", "requirements", "qualifications", "about the role", "apply now", "job description", "工作职责", "岗位职责", "任职要求", "职位描述", "申请职位"].filter((term) => source.includes(term)).length;
  const jobPath = /\/(?:jobs?|positions?|careers?|vacancies|openings)(?:\/|[-_])/.test(urlPath) || /\/(?:job|position)[-_]?[a-z0-9]/.test(urlPath);
  return signals >= 2 || (jobPath && signals >= 1);
}
