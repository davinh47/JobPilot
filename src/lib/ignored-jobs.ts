import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, ignoredJobs, jobs } from "@/db/schema";
import { canonicalJobKey } from "@/lib/job-identity";

export async function isJobIgnored(userId: string, canonicalKey: string, database: typeof db = db) {
  return Boolean(await database.select({ id: ignoredJobs.id }).from(ignoredJobs).where(and(eq(ignoredJobs.userId, userId), eq(ignoredJobs.canonicalKey, canonicalKey))).limit(1).get());
}

export async function ignoreDiscoveredJobRecord(userId: string, jobId: string, database: typeof db = db) {
  const job = await database.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.ownerUserId, userId))).get();
  if (!job) return null;
  const application = await database.select({ id: applications.id }).from(applications).where(and(eq(applications.userId, userId), eq(applications.jobId, job.id))).limit(1).get();
  if (application) return null;

  await database.transaction(async (tx) => {
    const ignoredKey = job.canonicalUrl ? canonicalJobKey(job.canonicalUrl) : job.canonicalKey;
    await tx.insert(ignoredJobs).values({
      userId,
      canonicalKey: ignoredKey,
      canonicalUrl: job.canonicalUrl,
      companyName: job.companyName,
      title: job.title,
    }).onConflictDoUpdate({
      target: [ignoredJobs.userId, ignoredJobs.canonicalKey],
      set: { canonicalUrl: job.canonicalUrl, companyName: job.companyName, title: job.title },
    }).run();
    await tx.delete(jobs).where(eq(jobs.id, job.id)).run();
  });
  return job;
}
