import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db as appDb } from "@/db";
import * as schema from "@/db/schema";
import { ignoreDiscoveredJobRecord, isJobIgnored } from "@/lib/ignored-jobs";
import { canonicalJobKey } from "@/lib/job-identity";
import { saveDiscoveredJob } from "@/lib/job-discovery";

test("ignored discovery jobs leave a durable exclusion record and preserve pipeline jobs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jobpilot-ignore-"));
  const client = createClient({ url: `file:${join(directory, "test.db")}` });
  const database = drizzle(client, { schema }) as typeof appDb;
  try {
    await migrate(database, { migrationsFolder: resolve("drizzle") });
    const user = await database.insert(schema.users).values({ displayName: "Ignore test" }).returning().get();
    const url = "https://example.com/jobs/123/?utm_source=search#details";
    const key = canonicalJobKey(url);
    const job = await database.insert(schema.jobs).values({ ownerUserId: user.id, companyName: "Example Co", title: "Engineer", descriptionText: "A detailed public job description for the ignored role.", canonicalUrl: url, canonicalKey: key }).returning().get();
    const source = await database.insert(schema.jobSources).values({ jobId: job.id, sourceType: "search", sourceName: "Public web", sourceUrl: url }).returning().get();
    await database.insert(schema.jobSnapshots).values({ jobId: job.id, sourceId: source.id, contentHash: "ignore-snapshot", rawText: job.descriptionText }).run();
    await database.insert(schema.jobMatches).values({ userId: user.id, jobId: job.id, overallScore: 75, skillsScore: 75, responsibilitiesScore: 75, seniorityScore: 75, locationScore: 75, hardFilterPassed: true, evidenceJson: [], gapsJson: [], uncertaintiesJson: [] }).run();

    assert.equal((await ignoreDiscoveredJobRecord(user.id, job.id, database))?.id, job.id);
    assert.equal(await database.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get(), undefined);
    assert.equal(await isJobIgnored(user.id, canonicalJobKey("https://example.com/jobs/123"), database), true);
    assert.equal(await database.select().from(schema.jobSources).where(eq(schema.jobSources.jobId, job.id)).get(), undefined);
    assert.equal(await database.select().from(schema.jobSnapshots).where(eq(schema.jobSnapshots.jobId, job.id)).get(), undefined);
    assert.equal(await database.select().from(schema.jobMatches).where(eq(schema.jobMatches.jobId, job.id)).get(), undefined);

    const pipelineJob = await database.insert(schema.jobs).values({ ownerUserId: user.id, companyName: "Keep Co", title: "Analyst", descriptionText: "A job that has already entered the application pipeline.", canonicalKey: "pipeline-job" }).returning().get();
    await database.insert(schema.applications).values({ userId: user.id, jobId: pipelineJob.id }).run();
    assert.equal(await ignoreDiscoveredJobRecord(user.id, pipelineJob.id, database), null);
    assert.equal((await database.select().from(schema.jobs).where(eq(schema.jobs.id, pipelineJob.id)).get())?.companyName, "Keep Co");
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ignored jobs remain blocked for automatic search while explicit imports can restore them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jobpilot-ignore-restore-"));
  const client = createClient({ url: `file:${join(directory, "test.db")}` });
  const database = drizzle(client, { schema }) as typeof appDb;
  try {
    await migrate(database, { migrationsFolder: resolve("drizzle") });
    const user = await database.insert(schema.users).values({ displayName: "Ignore restore test" }).returning().get();
    const url = "https://example.com/jobs/restore";
    const key = canonicalJobKey(url);
    await database.insert(schema.ignoredJobs).values({ userId: user.id, canonicalKey: key, canonicalUrl: url, companyName: "Example Co", title: "Engineer" }).run();

    const item = { externalId: "restore-1", companyName: "Example Co", title: "Engineer", location: "Sydney", workplaceType: "unknown" as const, employmentType: null, descriptionText: "A detailed job description with responsibilities, requirements, collaboration, delivery, and measurable outcomes.", canonicalUrl: url, publishedAt: null };
    const automatic = await saveDiscoveredJob(user.id, item, { type: "search", name: "Public search", evidence: "Synthetic search result." }, database);
    assert.equal(automatic.ignored, true);

    const manual = await saveDiscoveredJob(user.id, item, { type: "manual", name: "User added", evidence: "Synthetic user import." }, database);
    assert.equal(manual.ignored, false);
    assert.ok(manual.jobId);
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
