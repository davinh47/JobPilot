import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db as appDb } from "@/db";
import * as schema from "@/db/schema";
import { deleteApplicationRecord, deleteResumeRecord } from "@/lib/delete-records";

test("destructive deletes preserve jobs while cleaning dependent application and resume data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jobpilot-delete-"));
  const client = createClient({ url: `file:${join(directory, "test.db")}` });
  const database = drizzle(client, { schema }) as typeof appDb;
  try {
    await migrate(database, { migrationsFolder: resolve("drizzle") });
    const user = await database.insert(schema.users).values({ displayName: "Delete test" }).returning().get();
    await database.insert(schema.candidateProfiles).values({ userId: user.id, headline: "Old profile", summary: "Derived from the primary resume", profileJson: { strengths: ["test"] }, analyzedAt: new Date() }).run();
    const primary = await database.insert(schema.resumes).values({ userId: user.id, title: "Primary", sourceType: "editor", originalText: "Primary resume", isPrimary: true }).returning().get();
    const replacement = await database.insert(schema.resumes).values({ userId: user.id, title: "Replacement", sourceType: "editor", originalText: "Replacement resume", isPrimary: false }).returning().get();
    const primaryVersion = await database.insert(schema.resumeVersions).values({ resumeId: primary.id, versionNumber: 1, versionType: "base", title: "Primary", structuredContentJson: {}, createdBy: "user" }).returning().get();
    await database.insert(schema.resumeVersions).values({ resumeId: replacement.id, versionNumber: 1, versionType: "base", title: "Replacement", structuredContentJson: {}, createdBy: "user" }).run();
    await database.insert(schema.experienceEvidence).values({ userId: user.id, resumeId: primary.id, evidenceType: "experience", title: "Evidence", description: "From the deleted resume" }).run();
    const job = await database.insert(schema.jobs).values({ ownerUserId: user.id, companyName: "Example Co", title: "Engineer", descriptionText: "A sufficiently detailed test job description.", canonicalKey: "delete-test-job" }).returning().get();
    const application = await database.insert(schema.applications).values({ userId: user.id, jobId: job.id, selectedResumeVersionId: primaryVersion.id }).returning().get();
    await database.insert(schema.applicationEvents).values({ applicationId: application.id, eventType: "created", title: "Created", actorType: "user" }).run();
    const material = await database.insert(schema.materials).values({ applicationId: application.id, materialType: "resume", title: "Submitted resume", resumeVersionId: primaryVersion.id }).returning().get();
    const interview = await database.insert(schema.interviews).values({ applicationId: application.id, stage: "Screen" }).returning().get();
    await database.insert(schema.interviewQuestions).values({ applicationId: application.id, interviewId: interview.id, question: "Tell me about yourself" }).run();
    const match = await database.insert(schema.jobMatches).values({ userId: user.id, jobId: job.id, resumeVersionId: primaryVersion.id, overallScore: 80, skillsScore: 80, responsibilitiesScore: 80, seniorityScore: 80, locationScore: 80, hardFilterPassed: true, evidenceJson: [], gapsJson: [], uncertaintiesJson: [] }).returning().get();

    await deleteResumeRecord(user.id, primary.id, database);
    assert.equal(await database.select().from(schema.resumes).where(eq(schema.resumes.id, primary.id)).get(), undefined);
    assert.equal((await database.select().from(schema.resumes).where(eq(schema.resumes.id, replacement.id)).get())?.isPrimary, true);
    assert.equal((await database.select().from(schema.applications).where(eq(schema.applications.id, application.id)).get())?.selectedResumeVersionId, null);
    assert.equal((await database.select().from(schema.materials).where(eq(schema.materials.id, material.id)).get())?.resumeVersionId, null);
    assert.equal((await database.select().from(schema.jobMatches).where(eq(schema.jobMatches.id, match.id)).get())?.resumeVersionId, null);
    assert.equal(await database.select().from(schema.experienceEvidence).where(eq(schema.experienceEvidence.resumeId, primary.id)).get(), undefined);
    assert.equal((await database.select().from(schema.candidateProfiles).where(eq(schema.candidateProfiles.userId, user.id)).get())?.analyzedAt, null);

    await deleteApplicationRecord(user.id, application.id, database);
    assert.equal(await database.select().from(schema.applications).where(eq(schema.applications.id, application.id)).get(), undefined);
    assert.equal(await database.select().from(schema.applicationEvents).where(eq(schema.applicationEvents.applicationId, application.id)).get(), undefined);
    assert.equal(await database.select().from(schema.materials).where(eq(schema.materials.applicationId, application.id)).get(), undefined);
    assert.equal(await database.select().from(schema.interviews).where(eq(schema.interviews.applicationId, application.id)).get(), undefined);
    assert.equal(await database.select().from(schema.interviewQuestions).where(and(eq(schema.interviewQuestions.applicationId, application.id), eq(schema.interviewQuestions.interviewId, interview.id))).get(), undefined);
    assert.equal((await database.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)).get())?.companyName, "Example Co");
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
