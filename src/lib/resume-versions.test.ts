import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db as appDb } from "@/db";
import * as schema from "@/db/schema";
import { appendResumeVersionTx, RESUME_VERSION_LIMIT, resumeVersionContentHash, ResumeVersionConflictError } from "./resume-versions";

test("resume revision hashes change with content and remain deterministic", () => {
  const first = resumeVersionContentHash({ summary: "Built reliable systems" }, "Built reliable systems");
  assert.equal(first, resumeVersionContentHash({ summary: "Built reliable systems" }, "Built reliable systems"));
  assert.notEqual(first, resumeVersionContentHash({ summary: "Built safer systems" }, "Built safer systems"));
});

test("resume version conflicts have a stable error type", () => {
  const error = new ResumeVersionConflictError();
  assert.equal(error.name, "ResumeVersionConflictError");
  assert.match(error.message, /changed/);
});

test("append-only resume revisions preserve history and reject a stale writer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jobpilot-revisions-"));
  const databasePath = join(directory, "test.db");
  const firstClient = createClient({ url: `file:${databasePath}` });
  const secondClient = createClient({ url: `file:${databasePath}` });
  const firstDb = drizzle(firstClient, { schema }) as typeof appDb;
  const secondDb = drizzle(secondClient, { schema }) as typeof appDb;
  try {
    await migrate(firstDb, { migrationsFolder: resolve("drizzle") });
    const user = await firstDb.insert(schema.users).values({ displayName: "Revision test" }).returning().get();
    const resume = await firstDb.insert(schema.resumes).values({ userId: user.id, title: "Base", sourceType: "editor" }).returning().get();
    const initial = await firstDb.transaction((tx) => appendResumeVersionTx(tx, {
      resumeId: resume.id,
      expectedVersionId: null,
      versionType: "base",
      title: "Base",
      structuredContentJson: { summary: "Initial" },
      renderedText: "Initial",
      factCheckStatus: "passed",
      createdBy: "user",
    }));

    const results = await Promise.allSettled([
      firstDb.transaction((tx) => appendResumeVersionTx(tx, {
        resumeId: resume.id,
        expectedVersionId: initial.id,
        versionType: "manual_edit",
        title: "Base",
        structuredContentJson: { summary: "Writer A" },
        renderedText: "Writer A",
        factCheckStatus: "passed",
        createdBy: "user",
      })),
      secondDb.transaction((tx) => appendResumeVersionTx(tx, {
        resumeId: resume.id,
        expectedVersionId: initial.id,
        versionType: "manual_edit",
        title: "Base",
        structuredContentJson: { summary: "Writer B" },
        renderedText: "Writer B",
        factCheckStatus: "passed",
        createdBy: "user",
      })),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const versions = await firstDb.select().from(schema.resumeVersions)
      .where(eq(schema.resumeVersions.resumeId, resume.id))
      .orderBy(asc(schema.resumeVersions.versionNumber))
      .all();
    assert.equal(versions.length, 2);
    assert.equal(versions[1]?.parentVersionId, initial.id);
    assert.equal((await firstDb.select().from(schema.resumes).where(eq(schema.resumes.id, resume.id)).get())?.currentVersionId, versions[1]?.id);
  } finally {
    firstClient.close();
    secondClient.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume history keeps the first revision, linked application material, and the newest revisions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jobpilot-revision-limit-"));
  const databasePath = join(directory, "test.db");
  const client = createClient({ url: `file:${databasePath}` });
  const database = drizzle(client, { schema }) as typeof appDb;
  try {
    await migrate(database, { migrationsFolder: resolve("drizzle") });
    const user = await database.insert(schema.users).values({ displayName: "Revision limit" }).returning().get();
    const resume = await database.insert(schema.resumes).values({ userId: user.id, title: "Base", sourceType: "editor" }).returning().get();
    let expectedVersionId: string | null = null;
    let linkedVersionId = "";
    for (let versionNumber = 1; versionNumber <= 12; versionNumber += 1) {
      const created = await database.transaction((tx) => appendResumeVersionTx(tx, {
        resumeId: resume.id,
        expectedVersionId,
        versionType: versionNumber === 1 ? "base" : "manual_edit",
        title: "Base",
        structuredContentJson: { summary: `Revision ${versionNumber}` },
        renderedText: `Revision ${versionNumber}`,
        factCheckStatus: "passed",
        createdBy: "user",
      }));
      expectedVersionId = created.id;
      if (versionNumber === 3) {
        linkedVersionId = created.id;
        const job = await database.insert(schema.jobs).values({
          ownerUserId: user.id,
          companyName: "Example",
          title: "Engineer",
          descriptionText: "Test role",
          canonicalKey: "revision-limit-role",
        }).returning().get();
        const application = await database.insert(schema.applications).values({
          userId: user.id,
          jobId: job.id,
          selectedResumeVersionId: created.id,
        }).returning().get();
        await database.insert(schema.materials).values({
          applicationId: application.id,
          materialType: "resume",
          title: "Submitted resume",
          resumeVersionId: created.id,
        }).run();
      }
    }

    const versions = await database.select().from(schema.resumeVersions)
      .where(eq(schema.resumeVersions.resumeId, resume.id))
      .orderBy(asc(schema.resumeVersions.versionNumber))
      .all();
    assert.equal(versions.length, RESUME_VERSION_LIMIT);
    assert.deepEqual(versions.map((version) => version.versionNumber), [1, 3, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.equal((await database.select().from(schema.applications).where(eq(schema.applications.selectedResumeVersionId, linkedVersionId)).get())?.selectedResumeVersionId, linkedVersionId);
    assert.equal((await database.select().from(schema.resumes).where(eq(schema.resumes.id, resume.id)).get())?.currentVersionId, expectedVersionId);
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
