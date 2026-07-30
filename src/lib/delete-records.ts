import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { applicationEvents, applications, candidateProfiles, experienceEvidence, interviewQuestions, interviews, jobMatches, materials, resumes, resumeVersions } from "@/db/schema";

export async function deleteApplicationRecord(userId: string, applicationId: string, database: typeof db = db) {
  const application = await database.select().from(applications).where(and(eq(applications.id, applicationId), eq(applications.userId, userId))).get();
  if (!application) return null;
  await database.transaction(async (tx) => {
    await tx.delete(interviewQuestions).where(eq(interviewQuestions.applicationId, application.id)).run();
    await tx.delete(interviews).where(eq(interviews.applicationId, application.id)).run();
    await tx.delete(materials).where(eq(materials.applicationId, application.id)).run();
    await tx.delete(applicationEvents).where(eq(applicationEvents.applicationId, application.id)).run();
    await tx.delete(applications).where(eq(applications.id, application.id)).run();
  });
  return application;
}

export async function deleteResumeRecord(userId: string, resumeId: string, database: typeof db = db) {
  const resume = await database.select().from(resumes).where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId))).get();
  if (!resume) return null;
  const pairedReplacement = resume.isPrimary && resume.resumeGroupId
    ? await database.select().from(resumes).where(and(eq(resumes.userId, userId), eq(resumes.resumeGroupId, resume.resumeGroupId), ne(resumes.id, resume.id))).orderBy(desc(resumes.updatedAt)).limit(1).get()
    : undefined;
  const replacement = resume.isPrimary
    ? pairedReplacement ?? await database.select().from(resumes).where(and(eq(resumes.userId, userId), ne(resumes.id, resume.id))).orderBy(desc(resumes.updatedAt)).limit(1).get()
    : undefined;
  const versions = await database.select({ id: resumeVersions.id }).from(resumeVersions).where(eq(resumeVersions.resumeId, resume.id)).all();
  const versionIds = versions.map((version) => version.id);

  await database.transaction(async (tx) => {
    if (versionIds.length) {
      await tx.update(applications).set({ selectedResumeVersionId: null, updatedAt: new Date() }).where(inArray(applications.selectedResumeVersionId, versionIds)).run();
      await tx.update(materials).set({ resumeVersionId: null, updatedAt: new Date() }).where(inArray(materials.resumeVersionId, versionIds)).run();
      await tx.update(jobMatches).set({ resumeVersionId: null }).where(inArray(jobMatches.resumeVersionId, versionIds)).run();
    }
    await tx.delete(experienceEvidence).where(eq(experienceEvidence.resumeId, resume.id)).run();
    await tx.delete(resumeVersions).where(eq(resumeVersions.resumeId, resume.id)).run();
    await tx.delete(resumes).where(eq(resumes.id, resume.id)).run();
    if (resume.isPrimary) {
      await tx.update(resumes).set({ isPrimary: false, updatedAt: new Date() }).where(eq(resumes.userId, userId)).run();
      if (replacement) await tx.update(resumes).set({ isPrimary: true, updatedAt: new Date() }).where(eq(resumes.id, replacement.id)).run();
      await tx.update(candidateProfiles).set({ headline: null, summary: null, currentLocation: null, yearsOfExperience: null, workAuthorization: null, profileJson: null, analyzedAt: null, updatedAt: new Date() }).where(eq(candidateProfiles.userId, userId)).run();
    }
  });
  return resume;
}
