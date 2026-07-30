import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, careerPreferences, ignoredJobs, jobMatches, jobSearchTargets, jobs, jobSnapshots, jobSources, notifications, sourceConnectors, users } from "@/db/schema";
import { fetchConnectorJobs } from "@/lib/job-sources/adapters";
import type { NormalizedJob } from "@/lib/job-sources/types";
import { queueSearchReindex } from "@/lib/background-queue";
import { isJobIgnored } from "@/lib/ignored-jobs";
import { canonicalJobKey, hashJobIdentity, normalizeJobUrl } from "@/lib/job-identity";
import { deterministicMatch } from "@/lib/job-preference-match";
import { localeFromStored } from "@/lib/i18n";

export const normalizeUrl = normalizeJobUrl;
export const hash = hashJobIdentity;

export async function saveDiscoveredJob(userId: string, item: NormalizedJob, source: { type: "manual" | "extension" | "search"; name: string; evidence: string; rawSnapshotText?: string }) {
  const now = new Date();
  const [user, preference, targets] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).get(),
    db.select().from(careerPreferences).where(eq(careerPreferences.userId, userId)).get(),
    db.select().from(jobSearchTargets).where(eq(jobSearchTargets.userId, userId)).all(),
  ]);
  const locale = localeFromStored(user?.locale);
  const canonicalUrl = normalizeUrl(item.canonicalUrl);
  const canonicalKey = canonicalJobKey(canonicalUrl);
  if (await isJobIgnored(userId, canonicalKey)) return { jobId: null, created: false, hardFilterPassed: false, score: 0, ignored: true as const };
  const existing = await db.select().from(jobs).where(and(eq(jobs.ownerUserId, userId), eq(jobs.canonicalKey, canonicalKey))).get();
  const snapshotText = source.rawSnapshotText?.trim() || item.descriptionText;
  const contentHash = hash(snapshotText);
  const result = deterministicMatch(item, preference ? { ...preference, jobSearchTargets: targets } : undefined, locale);
  const saved = await db.transaction(async (tx) => {
    const job = existing
      ? await tx.update(jobs).set({ title: item.title, companyName: item.companyName, location: item.location, workplaceType: item.workplaceType, employmentType: item.employmentType, salaryMin: item.salaryMin, salaryMax: item.salaryMax, salaryCurrency: item.salaryCurrency, descriptionText: item.descriptionText, canonicalUrl, publishedAt: item.publishedAt, listingStatus: "active", listingCheckedAt: now, missingCheckCount: 0, lastSeenAt: now, updatedAt: now }).where(eq(jobs.id, existing.id)).returning().get()
      : await tx.insert(jobs).values({ ownerUserId: userId, title: item.title, companyName: item.companyName, location: item.location, workplaceType: item.workplaceType, employmentType: item.employmentType, salaryMin: item.salaryMin, salaryMax: item.salaryMax, salaryCurrency: item.salaryCurrency, descriptionText: item.descriptionText, canonicalUrl, canonicalKey, publishedAt: item.publishedAt, listingStatus: "active", listingCheckedAt: now }).returning().get();
    let savedSource = await tx.select().from(jobSources).where(and(eq(jobSources.jobId, job.id), eq(jobSources.sourceType, source.type), eq(jobSources.sourceUrl, canonicalUrl))).get();
    if (!savedSource) savedSource = await tx.insert(jobSources).values({ jobId: job.id, sourceType: source.type, sourceName: source.name, sourceUrl: canonicalUrl, externalId: item.externalId, lastCheckedAt: now }).returning().get();
    else await tx.update(jobSources).set({ lastCheckedAt: now }).where(eq(jobSources.id, savedSource.id)).run();
    const snapshot = await tx.select().from(jobSnapshots).where(and(eq(jobSnapshots.jobId, job.id), eq(jobSnapshots.contentHash, contentHash))).get();
    if (!snapshot) await tx.insert(jobSnapshots).values({ jobId: job.id, sourceId: savedSource.id, contentHash, rawText: snapshotText, httpStatus: 200, listingEvidence: source.evidence }).run();
    const match = await tx.select().from(jobMatches).where(and(eq(jobMatches.userId, userId), eq(jobMatches.jobId, job.id))).get();
    const matchValues = { matchedTargetId: result.matchedTargetId, overallScore: result.score, skillsScore: result.score, responsibilitiesScore: result.score, seniorityScore: result.seniorityScore, locationScore: result.locationScore, salaryScore: null, industryScore: null, authorizationScore: null, hardFilterPassed: result.passed, evidenceJson: [{ claim: locale === "zh" ? "公开岗位页面符合确定性偏好筛选" : "Public job page matched deterministic preferences", source: canonicalUrl }], gapsJson: result.gaps, uncertaintiesJson: result.uncertainties, modelName: null, promptVersion: "deterministic-v5" };
    if (match) await tx.update(jobMatches).set(matchValues).where(eq(jobMatches.id, match.id)).run();
    else await tx.insert(jobMatches).values({ userId, jobId: job.id, ...matchValues }).run();
    return job;
  });
  return { jobId: saved.id, created: !existing, hardFilterPassed: result.passed, score: result.score, ignored: false as const };
}

export function saveSearchDiscoveredJob(userId: string, item: NormalizedJob, sourceName: string) {
  return saveDiscoveredJob(userId, item, { type: "search", name: sourceName, evidence: "Job data was extracted from source-grounded public search and webpage evidence." });
}

export async function syncConnector(connectorId: string, expectedUserId?: string) {
  const connector = await db.select().from(sourceConnectors).where(
    expectedUserId
      ? and(eq(sourceConnectors.id, connectorId), eq(sourceConnectors.userId, expectedUserId))
      : eq(sourceConnectors.id, connectorId),
  ).get();
  if (!connector || !connector.enabled) return { added: 0, updated: 0, seen: 0 };
  const now = new Date();
  await db.update(sourceConnectors).set({ lastSyncAt: now, lastError: null, updatedAt: now }).where(eq(sourceConnectors.id, connector.id)).run();
  try {
    const incoming = await fetchConnectorJobs(connector);
    const [user, preference, targets, settings] = await Promise.all([
      db.select().from(users).where(eq(users.id, connector.userId)).get(),
      db.select().from(careerPreferences).where(eq(careerPreferences.userId, connector.userId)).get(),
      db.select().from(jobSearchTargets).where(eq(jobSearchTargets.userId, connector.userId)).all(),
      db.select().from(appSettings).where(eq(appSettings.userId, connector.userId)).get(),
    ]);
    const locale = localeFromStored(user?.locale);
    const ignoredKeys = new Set((await db.select({ canonicalKey: ignoredJobs.canonicalKey }).from(ignoredJobs).where(eq(ignoredJobs.userId, connector.userId)).all()).map((item) => item.canonicalKey));
    const canNotify = settings?.notificationsEnabled ?? true;
    const seenExternalIds: string[] = [];
    let added = 0;
    let updated = 0;
    for (const item of incoming) {
      if (!item.descriptionText.trim()) item.descriptionText = `${item.title} at ${item.companyName}`;
      seenExternalIds.push(item.externalId);
      const canonicalUrl = normalizeUrl(item.canonicalUrl);
      const canonicalKey = canonicalJobKey(canonicalUrl);
      if (ignoredKeys.has(canonicalKey)) continue;
      const existing = await db.select().from(jobs).where(and(eq(jobs.ownerUserId, connector.userId), eq(jobs.canonicalKey, canonicalKey))).get();
      const contentHash = hash(item.descriptionText);
      const result = deterministicMatch(item, preference ? { ...preference, jobSearchTargets: targets } : undefined, locale);
      const job = await db.transaction(async (tx) => {
        const saved = existing
          ? await tx.update(jobs).set({ title: item.title, companyName: item.companyName, location: item.location, workplaceType: item.workplaceType, employmentType: item.employmentType, descriptionText: item.descriptionText, canonicalUrl, publishedAt: item.publishedAt, listingStatus: "active", listingCheckedAt: now, missingCheckCount: 0, lastSeenAt: now, updatedAt: now }).where(eq(jobs.id, existing.id)).returning().get()
          : await tx.insert(jobs).values({ ownerUserId: connector.userId, title: item.title, companyName: item.companyName, location: item.location, workplaceType: item.workplaceType, employmentType: item.employmentType, descriptionText: item.descriptionText, canonicalUrl, canonicalKey, publishedAt: item.publishedAt, listingStatus: "active", listingCheckedAt: now }).returning().get();
        let source = await tx.select().from(jobSources).where(and(eq(jobSources.jobId, saved.id), eq(jobSources.sourceType, connector.provider), eq(jobSources.externalId, item.externalId))).get();
        if (!source) source = await tx.insert(jobSources).values({ jobId: saved.id, sourceType: connector.provider, sourceName: connector.name, sourceUrl: canonicalUrl, externalId: item.externalId, lastCheckedAt: now }).returning().get();
        else await tx.update(jobSources).set({ sourceUrl: canonicalUrl, lastCheckedAt: now }).where(eq(jobSources.id, source.id)).run();
        const snapshot = await tx.select().from(jobSnapshots).where(and(eq(jobSnapshots.jobId, saved.id), eq(jobSnapshots.contentHash, contentHash))).get();
        if (!snapshot) await tx.insert(jobSnapshots).values({ jobId: saved.id, sourceId: source.id, contentHash, rawText: item.descriptionText, httpStatus: 200, listingEvidence: `${connector.provider} public job board returned this listing.` }).run();
        const match = await tx.select().from(jobMatches).where(and(eq(jobMatches.userId, connector.userId), eq(jobMatches.jobId, saved.id))).get();
        const matchValues = { matchedTargetId: result.matchedTargetId, overallScore: result.score, skillsScore: result.score, responsibilitiesScore: result.score, seniorityScore: result.seniorityScore, locationScore: result.locationScore, salaryScore: null, industryScore: null, authorizationScore: null, hardFilterPassed: result.passed, evidenceJson: [{ claim: locale === "zh" ? "公开 ATS 岗位符合确定性偏好筛选" : "Public ATS listing matched deterministic preferences", source: `${connector.provider}:${item.externalId}` }], gapsJson: result.gaps, uncertaintiesJson: result.uncertainties, modelName: null, promptVersion: "deterministic-v5" };
        if (match) await tx.update(jobMatches).set(matchValues).where(eq(jobMatches.id, match.id)).run();
        else await tx.insert(jobMatches).values({ userId: connector.userId, jobId: saved.id, ...matchValues }).run();
        return saved;
      });
      if (existing) updated += 1; else added += 1;
      void job;
    }

    const ownedJobs = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.ownerUserId, connector.userId)).all();
    const ownedJobIds = new Set(ownedJobs.map((item) => item.id));
    const priorSources = (await db.select().from(jobSources).where(and(eq(jobSources.sourceType, connector.provider), eq(jobSources.sourceName, connector.name))).all()).filter((source) => ownedJobIds.has(source.jobId));
    const missing = priorSources.filter((source) => source.externalId && !seenExternalIds.includes(source.externalId));
    for (const source of missing) {
      const job = await db.select().from(jobs).where(eq(jobs.id, source.jobId)).get();
      if (!job) continue;
      const count = job.missingCheckCount + 1;
      const status = count >= 3 ? "expired" : "possibly_expired";
      await db.update(jobs).set({ missingCheckCount: count, listingStatus: status, listingCheckedAt: now, updatedAt: now }).where(eq(jobs.id, job.id)).run();
      await db.insert(jobSnapshots).values({ jobId: job.id, sourceId: source.id, contentHash: hash(`missing:${count}:${now.toISOString()}`), rawText: "", httpStatus: 200, listingEvidence: `Missing from a successful ${connector.provider} refresh (${count}/3).` }).run();
      if (canNotify && status === "expired" && job.listingStatus !== "expired") await db.insert(notifications).values({ userId: connector.userId, notificationType: "listing_expired", titleZh: "岗位可能已关闭", titleEn: "Listing appears closed", bodyZh: `${job.companyName} · ${job.title} 已连续三次未在官方源中出现。`, bodyEn: `${job.companyName} · ${job.title} was absent from three successful source refreshes.`, entityType: "job", entityId: job.id }).run();
    }
    if (canNotify && added > 0) await db.insert(notifications).values({ userId: connector.userId, notificationType: "new_matches", titleZh: `发现 ${added} 个新岗位`, titleEn: `${added} new role${added === 1 ? "" : "s"} found`, bodyZh: `${connector.name} 的公开招聘源已完成同步。`, bodyEn: `The public job board for ${connector.name} finished syncing.`, entityType: "source_connector", entityId: connector.id }).run();
    await db.update(sourceConnectors).set({ lastSuccessAt: now, lastError: null, updatedAt: now }).where(eq(sourceConnectors.id, connector.id)).run();
    await db.update(careerPreferences).set({ lastSearchAt: now, updatedAt: now }).where(eq(careerPreferences.userId, connector.userId)).run();
    await queueSearchReindex(connector.userId);
    return { added, updated, seen: incoming.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown connector error";
    await db.update(sourceConnectors).set({ lastError: message, updatedAt: new Date() }).where(eq(sourceConnectors.id, connector.id)).run();
    throw error;
  }
}

export async function syncAllEnabledConnectors(userId?: string) {
  const connectors = userId
    ? await db.select().from(sourceConnectors).where(and(eq(sourceConnectors.userId, userId), eq(sourceConnectors.enabled, true))).all()
    : await db.select().from(sourceConnectors).where(eq(sourceConnectors.enabled, true)).all();
  const results = [];
  for (const connector of connectors) results.push({ connectorId: connector.id, ...(await syncConnector(connector.id, connector.userId)) });
  return results;
}
