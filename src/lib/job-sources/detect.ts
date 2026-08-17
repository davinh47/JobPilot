import { load } from "cheerio";
import type { SourceProvider } from "./types";

export type DetectedConnector = { provider: SourceProvider; boardToken: string; region: "global" | "eu"; url: string };

export function detectConnectorUrl(value: string): DetectedConnector | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.split("/").filter(Boolean);
    if (["boards.greenhouse.io", "job-boards.greenhouse.io", "boards-api.greenhouse.io"].includes(host)) {
      const offset = path[0] === "v1" && path[1] === "boards" ? 2 : 0;
      return path[offset] ? { provider: "greenhouse", boardToken: path[offset], region: "global", url: url.toString() } : null;
    }
    if (["jobs.lever.co", "jobs.eu.lever.co"].includes(host) && path[0]) return { provider: "lever", boardToken: path[0], region: host.includes(".eu." ) ? "eu" : "global", url: url.toString() };
    if (host === "jobs.ashbyhq.com" && path[0]) return { provider: "ashby", boardToken: path[0], region: "global", url: url.toString() };
  } catch {
    return null;
  }
  return null;
}

export function detectConnectorInHtml(html: string, pageUrl: string) {
  const direct = detectConnectorUrl(pageUrl);
  if (direct) return direct;
  const $ = load(html);
  for (const element of $("a[href]").toArray()) {
    const href = $(element).attr("href");
    if (!href) continue;
    try {
      const detected = detectConnectorUrl(new URL(href, pageUrl).toString());
      if (detected) return detected;
    } catch {
      continue;
    }
  }
  return null;
}
