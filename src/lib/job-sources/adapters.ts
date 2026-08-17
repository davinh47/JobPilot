import { load } from "cheerio";
import { z } from "zod";
import type { ConnectorInput, NormalizedJob } from "./types";

const greenhouseResponse = z.object({ jobs: z.array(z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  updated_at: z.string().optional(),
  absolute_url: z.url(),
  content: z.string().default(""),
  location: z.object({ name: z.string().default("") }).optional(),
})) });

const leverResponse = z.array(z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.url(),
  createdAt: z.number().optional(),
  description: z.string().optional(),
  descriptionPlain: z.string().optional(),
  additionalPlain: z.string().optional(),
  workplaceType: z.string().optional(),
  categories: z.object({ location: z.string().optional(), commitment: z.string().optional() }).passthrough().optional(),
}));

const ashbyResponse = z.object({ jobs: z.array(z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().optional().nullable(),
  workplaceType: z.string().optional().nullable(),
  employmentType: z.string().optional().nullable(),
  descriptionPlain: z.string().optional().nullable(),
  descriptionHtml: z.string().optional().nullable(),
  publishedAt: z.string().optional().nullable(),
  jobUrl: z.url().optional(),
  applyUrl: z.url().optional(),
  isListed: z.boolean().optional(),
}).passthrough()) });

function htmlToText(html: string) {
  const $ = load(html);
  $("script,style,noscript").remove();
  $("br").replaceWith("\n");
  $("p,li,h1,h2,h3,h4").each((_, element) => { $(element).append("\n"); });
  return $.root().text().replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function workplace(value: string | null | undefined): NormalizedJob["workplaceType"] {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("remote")) return "remote";
  if (normalized.includes("hybrid")) return "hybrid";
  if (normalized.includes("office") || normalized.includes("onsite") || normalized.includes("on-site")) return "onsite";
  return "unknown";
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "JobPilot/0.1 local job discovery" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchConnectorJobs(connector: ConnectorInput): Promise<NormalizedJob[]> {
  const token = encodeURIComponent(connector.boardToken.trim());
  if (connector.provider === "greenhouse") {
    const data = greenhouseResponse.parse(await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`));
    return data.jobs.map((job) => ({ externalId: String(job.id), companyName: connector.name, title: job.title, location: job.location?.name || null, workplaceType: workplace(job.location?.name), employmentType: null, descriptionText: htmlToText(job.content), canonicalUrl: job.absolute_url, publishedAt: job.updated_at ? new Date(job.updated_at) : null }));
  }
  if (connector.provider === "lever") {
    const host = connector.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
    const data = leverResponse.parse(await fetchJson(`https://${host}/v0/postings/${token}?mode=json`));
    return data.map((job) => ({ externalId: job.id, companyName: connector.name, title: job.text, location: job.categories?.location || null, workplaceType: workplace(job.workplaceType), employmentType: job.categories?.commitment || null, descriptionText: [job.descriptionPlain || htmlToText(job.description ?? ""), job.additionalPlain ?? ""].filter(Boolean).join("\n\n"), canonicalUrl: job.hostedUrl, publishedAt: job.createdAt ? new Date(job.createdAt) : null }));
  }
  const data = ashbyResponse.parse(await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`));
  return data.jobs.filter((job) => job.isListed !== false).flatMap((job) => {
    const url = job.jobUrl ?? job.applyUrl;
    if (!url) return [];
    return [{ externalId: job.id, companyName: connector.name, title: job.title, location: job.location || null, workplaceType: workplace(job.workplaceType), employmentType: job.employmentType || null, descriptionText: job.descriptionPlain || htmlToText(job.descriptionHtml ?? ""), canonicalUrl: url, publishedAt: job.publishedAt ? new Date(job.publishedAt) : null }];
  });
}
