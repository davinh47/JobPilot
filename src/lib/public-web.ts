import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { load } from "cheerio";

export type PublicWebErrorCode =
  | "INVALID_URL"
  | "NON_STANDARD_PORT"
  | "LOCAL_ADDRESS"
  | "PRIVATE_ADDRESS"
  | "DNS_FAILURE"
  | "REDIRECT_LIMIT"
  | "RESPONSE_TOO_LARGE"
  | "TIMEOUT";

export class PublicWebError extends Error {
  constructor(
    public readonly code: PublicWebErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PublicWebError";
  }
}

const blockedAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) blockedAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) blockedAddresses.addSubnet(address, prefix, "ipv6");

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mapped) return blockedAddresses.check(mapped, "ipv4");
  const family = isIP(normalized);
  return family === 4
    ? blockedAddresses.check(normalized, "ipv4")
    : family === 6
      ? blockedAddresses.check(normalized, "ipv6")
      : true;
}

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

export async function resolvePublicUrl(value: string) {
  if (!isHttpUrl(value)) throw new PublicWebError("INVALID_URL", "Only public HTTP(S) URLs are allowed.");
  const url = new URL(value);
  if (url.port && !["80", "443"].includes(url.port)) throw new PublicWebError("NON_STANDARD_PORT", "Non-standard ports are not allowed.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new PublicWebError("LOCAL_ADDRESS", "Local addresses are not allowed.");
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = isIP(host)
      ? [{ address: host, family: isIP(host) as 4 | 6 }]
      : await lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw new PublicWebError("DNS_FAILURE", "The public hostname could not be resolved.", { cause: error });
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new PublicWebError("PRIVATE_ADDRESS", "Private network addresses are not allowed.");
  return { url, address: addresses[0].address, family: addresses[0].family };
}

export async function assertPublicUrl(value: string) {
  return (await resolvePublicUrl(value)).url;
}

export async function readLimitedResponseText(response: Response, maxBytes = 3_000_000) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new PublicWebError("RESPONSE_TOO_LARGE", "Page is too large to inspect safely.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return `${text}${decoder.decode()}`;
}

function pinnedRequest(
  url: URL,
  address: string,
  family: number,
  signal: AbortSignal,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, address, family);
    };
    const request = transport.request(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
        "User-Agent": "JobPilot/0.2 (+public job discovery; security contact in repository)",
      },
      lookup: pinnedLookup,
      signal,
    }, (response) => {
      resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response });
    });
    request.once("error", reject);
    request.end();
  });
}

async function readLimitedIncomingText(response: http.IncomingMessage, maxBytes = 3_000_000) {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.byteLength;
    if (received > maxBytes) {
      response.destroy();
      throw new PublicWebError("RESPONSE_TOO_LARGE", "Page is too large to inspect safely.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchPublicPage(value: string, redirects = 0, timeoutMs = 30_000, deadline = Date.now() + timeoutMs): Promise<{ url: string; status: number; contentType: string; text: string }> {
  if (redirects > 3) throw new PublicWebError("REDIRECT_LIMIT", "Too many redirects.");
  const { url, address, family } = await resolvePublicUrl(value);
  const controller = new AbortController();
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new PublicWebError("TIMEOUT", "Page request timed out.");
  const timeout = setTimeout(() => controller.abort(), remainingMs);
  try {
    const response = await pinnedRequest(url, address, family, controller.signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
      if (!location) throw new Error("Redirect response did not contain a location.");
      response.body.resume();
      return fetchPublicPage(new URL(location, url).toString(), redirects + 1, timeoutMs, deadline);
    }
    const contentLength = Number(response.headers["content-length"] ?? 0);
    if (contentLength > 3_000_000) throw new PublicWebError("RESPONSE_TOO_LARGE", "Page is too large to inspect safely.");
    const text = await readLimitedIncomingText(response.body);
    return {
      url: url.toString(),
      status: response.status,
      contentType: Array.isArray(response.headers["content-type"]) ? response.headers["content-type"][0] : response.headers["content-type"] ?? "",
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function extractReadableText(html: string, pageUrl: string) {
  if (!html.trim()) return null;
  try {
    const $ = load(html);
    const title = $("meta[property='og:title']").attr("content")?.trim() || $("title").first().text().trim() || $("h1").first().text().trim() || null;
    const siteName = $("meta[property='og:site_name']").attr("content")?.trim()
      || $("meta[name='application-name']").attr("content")?.trim()
      || new URL(pageUrl).hostname.replace(/^www\./, "");
    const publishedTime = $("meta[property='article:published_time']").attr("content")?.trim()
      || $("meta[name='date']").attr("content")?.trim()
      || $("time[datetime]").first().attr("datetime")?.trim()
      || null;

    $("script,style,noscript,template,svg,canvas,iframe,nav,header,footer,aside,form,button,[role='button'],[aria-hidden='true'],[class*='cookie'],[class*='modal'],[class*='breadcrumb'],[class*='share'],[class*='social'],[class*='save-job'],[class*='favorite'],a[class*='button'],a[class*='btn'],a[href*='apply']").remove();
    $("br").replaceWith("\n");
    $("p,li,dt,dd,h1,h2,h3,h4,h5,h6,section,article").each((_, element) => { $(element).append("\n"); });

    const normalize = (value: string) => value
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const candidates = ["article", "main", "[role='main']", "[class*='job-description']", "[class*='jobDescription']", ".content-shell", "body"];
    let text = "";
    for (const selector of candidates) {
      const candidate = normalize($(selector).first().text());
      if (candidate.length >= 80) {
        text = candidate;
        break;
      }
    }
    if (!text) text = normalize($.root().text());
    if (!text || text.length < 80) return null;
    return { title, siteName, publishedTime, text };
  } catch {
    return null;
  }
}
