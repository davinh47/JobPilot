import { createHash } from "node:crypto";
import { load } from "cheerio";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, jobs, jobSnapshots, jobSources, notifications } from "@/db/schema";
import { fetchPublicPage } from "@/lib/public-web";

const closedPatterns = [
  /no longer accepting applications/i,
  /this (job|position|role) (is|has been) (closed|filled)/i,
  /job (is )?no longer available/i,
  /(?:job|position|role|posting) (?:is|has been) (?:expired|removed|withdrawn)/i,
  /applications? (?:are|is|have been) (?:closed|ended)/i,
  /position has been filled/i,
  /(?:岗位|职位|招聘)(?:已)?(?:失效|过期|关闭|下线|结束|招满|撤下)/,
  /(?:该|此)?(?:岗位|职位).{0,12}(?:不再招聘|停止招聘|停止接受申请)/,
  /(?:申请|投递)(?:已经|已)?(?:截止|关闭|结束)/,
  /停止(?:招聘|接受申请|接收申请)/,
];

const openPatterns = [
  /\bapply (?:now|for this job|for this position)\b/i,
  /\bsubmit (?:your )?application\b/i,
  /\bstart (?:your )?application\b/i,
  /(?:(?:立即|现在|马上)申请(?:职位|岗位)?|申请(?:职位|岗位))/,
  /(?:投递|提交)(?:简历|申请)/,
  /我要应聘/,
];

type ListingStatus = (typeof jobs.$inferSelect)["listingStatus"];
type ListingPage = { status: number; contentType: string; text: string };

function collectValidThrough(value: unknown, found: string[] = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) collectValidThrough(item, found);
    return found;
  }
  const object = value as Record<string, unknown>;
  const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  if (types.includes("JobPosting") && typeof object.validThrough === "string") found.push(object.validThrough);
  for (const child of Object.values(object)) if (child && typeof child === "object") collectValidThrough(child, found);
  return found;
}

function structuredDeadline($: ReturnType<typeof load>) {
  const values: string[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try { collectValidThrough(JSON.parse($(element).text()), values); } catch { /* Ignore malformed page metadata. */ }
  });
  if (values.length !== 1) return null;
  const value = values[0];
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function classifyListingPage(page: ListingPage, previousStatus: ListingStatus, now = new Date()) {
  if (page.status === 404 || page.status === 410) {
    return {
      status: "expired" as const,
      evidence: `Official listing returned HTTP ${page.status}.`,
      rawText: "",
    };
  }
  if (page.status >= 200 && page.status < 300 && page.contentType.includes("html")) {
    const $ = load(page.text);
    const validThrough = structuredDeadline($);
    $("script,style,noscript").remove();
    const actionText = $("a,button,input[type='submit'],[role='button']").map((_, element) => {
      const node = $(element);
      return [node.text(), node.attr("value"), node.attr("aria-label"), node.attr("title")].filter(Boolean).join(" ");
    }).get().join(" ").replace(/\s+/g, " ").trim();
    const rawText = $.root().text().replace(/\s+/g, " ").trim().slice(0, 100_000);
    const closed = closedPatterns.find((pattern) => pattern.test(rawText));
    const open = openPatterns.find((pattern) => pattern.test(actionText));
    const deadlineExpired = validThrough ? validThrough.getTime() < now.getTime() : false;
    return {
      status: closed || deadlineExpired ? "expired" as const : open || validThrough ? "active" as const : previousStatus,
      evidence: closed
        ? `Listing page explicitly indicates closure (${closed.source}).`
        : deadlineExpired
          ? `Structured job metadata expired at ${validThrough?.toISOString()}.`
          : validThrough
            ? `Structured job metadata remains valid through ${validThrough.toISOString()}.`
            : open
              ? `Listing page still exposes an application action (${open.source}).`
              : `Listing returned HTTP ${page.status}, but no reliable open or closed signal was visible; the previous status was retained.`,
      rawText,
    };
  }
  if ([401, 403, 408, 425, 429].includes(page.status) || page.status >= 500) {
    return {
      status: previousStatus,
      evidence: `Listing verification returned HTTP ${page.status}; the previous status was retained.`,
      rawText: "",
    };
  }
  if (page.status >= 200 && page.status < 300) {
    return {
      status: previousStatus,
      evidence: `Listing returned unsupported content type ${page.contentType || "unknown"}; the previous status was retained.`,
      rawText: "",
    };
  }
  return {
    status: "possibly_expired" as const,
    evidence: `Listing returned HTTP ${page.status}; confirmation is required.`,
    rawText: "",
  };
}

export async function checkListing(jobId: string, expectedUserId?: string) {
  const job = await db.select().from(jobs).where(
    expectedUserId
      ? and(eq(jobs.id, jobId), eq(jobs.ownerUserId, expectedUserId))
      : eq(jobs.id, jobId),
  ).get();
  if (!job?.canonicalUrl) return { status: job?.listingStatus ?? "unknown", evidence: "No canonical URL is available." };
  const source = await db.select().from(jobSources).where(eq(jobSources.jobId, job.id)).orderBy(asc(jobSources.discoveredAt)).limit(1).get();
  const now = new Date();
  let httpStatus = 0;
  let rawText = "";
  let status = job.listingStatus;
  let evidence = "Network check failed; the previous status was retained.";
  try {
    const page = await fetchPublicPage(job.canonicalUrl);
    httpStatus = page.status;
    const result = classifyListingPage(page, job.listingStatus);
    status = result.status;
    evidence = result.evidence;
    rawText = result.rawText;
  } catch (error) {
    evidence = error instanceof Error ? `Network check failed (${error.name}); previous status retained.` : evidence;
  }
  const contentHash = createHash("sha256").update(`${httpStatus}:${evidence}:${now.toISOString()}`).digest("hex");
  await db.transaction(async (tx) => {
    await tx.update(jobs).set({ listingStatus: status, listingCheckedAt: now, missingCheckCount: status === "active" ? 0 : job.missingCheckCount, updatedAt: now }).where(
      expectedUserId
        ? and(eq(jobs.id, job.id), eq(jobs.ownerUserId, expectedUserId))
        : eq(jobs.id, job.id),
    ).run();
    if (source) await tx.update(jobSources).set({ lastCheckedAt: now }).where(eq(jobSources.id, source.id)).run();
    await tx.insert(jobSnapshots).values({ jobId: job.id, sourceId: source?.id ?? null, contentHash, rawText, httpStatus, listingEvidence: evidence }).run();
  });
  if (status === "expired" && job.listingStatus !== "expired") {
    const settings = job.ownerUserId ? await db.select().from(appSettings).where(eq(appSettings.userId, job.ownerUserId)).get() : undefined;
    if (job.ownerUserId && (settings?.notificationsEnabled ?? true)) await db.insert(notifications).values({ userId: job.ownerUserId, notificationType: "listing_expired", titleZh: "岗位已失效", titleEn: "Listing expired", bodyZh: `${job.companyName} · ${job.title} 的页面已确认关闭。`, bodyEn: `${job.companyName} · ${job.title} was confirmed closed.`, entityType: "job", entityId: job.id }).run();
  }
  return { status, evidence };
}

const DAY_MS = 24 * 60 * 60_000;

type ListingCheckPolicyInput = {
  listingStatus: ListingStatus;
  listingCheckedAt: Date | null;
  applicationDeadline: Date | null;
  hasApplication: boolean;
};

export function listingCheckIntervalMs(input: Omit<ListingCheckPolicyInput, "listingCheckedAt">, now = new Date()) {
  if (input.listingStatus === "possibly_expired") return DAY_MS;
  if (input.applicationDeadline) {
    const remaining = input.applicationDeadline.getTime() - now.getTime();
    if (remaining <= 7 * DAY_MS) return DAY_MS;
    if (remaining <= 30 * DAY_MS) return 3 * DAY_MS;
  }
  return input.hasApplication ? 3 * DAY_MS : 7 * DAY_MS;
}

export function isListingCheckDue(input: ListingCheckPolicyInput, now = new Date()) {
  if (!input.listingCheckedAt) return true;
  return input.listingCheckedAt.getTime() <= now.getTime() - listingCheckIntervalMs(input, now);
}

export function listingCheckPriority(input: Omit<ListingCheckPolicyInput, "listingCheckedAt">, now = new Date()) {
  if (input.listingStatus === "possibly_expired") return 0;
  if (input.applicationDeadline && input.applicationDeadline.getTime() - now.getTime() <= 7 * DAY_MS) return 1;
  if (input.hasApplication) return 2;
  return 3;
}
