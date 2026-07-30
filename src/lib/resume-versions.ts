import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { applications, materials, resumes, resumeVersions } from "@/db/schema";

export const RESUME_VERSION_LIMIT = 10;

export class ResumeVersionConflictError extends Error {
  constructor() {
    super("The resume changed after this editor or AI task was opened.");
    this.name = "ResumeVersionConflictError";
  }
}

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type VersionType = typeof resumeVersions.$inferInsert.versionType;
type FactCheckStatus = typeof resumeVersions.$inferInsert.factCheckStatus;
type CreatedBy = typeof resumeVersions.$inferInsert.createdBy;

type AppendResumeVersionInput = {
  resumeId: string;
  expectedVersionId: string | null;
  externalParentVersionId?: string | null;
  jobId?: string | null;
  versionType: VersionType;
  title: string;
  structuredContentJson: Record<string, unknown>;
  renderedText: string;
  changeSummary?: string | null;
  factCheckStatus: FactCheckStatus;
  createdBy: CreatedBy;
  resumeUpdates?: {
    title?: string;
    originalText?: string | null;
    language?: "zh" | "en" | null;
    updatedAt?: Date;
  };
};

export function resumeVersionContentHash(content: Record<string, unknown>, renderedText: string) {
  return createHash("sha256")
    .update(JSON.stringify(content))
    .update("\0")
    .update(renderedText)
    .digest("hex");
}

export async function pruneResumeVersionHistoryTx(
  tx: DatabaseTransaction,
  resumeId: string,
  currentVersionId: string,
  limit = RESUME_VERSION_LIMIT,
) {
  const versions = await tx.select({ id: resumeVersions.id, versionNumber: resumeVersions.versionNumber })
    .from(resumeVersions)
    .where(eq(resumeVersions.resumeId, resumeId))
    .orderBy(asc(resumeVersions.versionNumber), asc(resumeVersions.createdAt))
    .all();
  if (versions.length <= limit) return [];

  const versionIds = versions.map((version) => version.id);
  const [selectedApplications, linkedMaterials] = await Promise.all([
    tx.select({ id: applications.selectedResumeVersionId })
      .from(applications)
      .where(inArray(applications.selectedResumeVersionId, versionIds))
      .all(),
    tx.select({ id: materials.resumeVersionId })
      .from(materials)
      .where(inArray(materials.resumeVersionId, versionIds))
      .all(),
  ]);
  const protectedIds = new Set([
    versions[0]?.id,
    currentVersionId,
    ...selectedApplications.map((row) => row.id),
    ...linkedMaterials.map((row) => row.id),
  ].filter((id): id is string => Boolean(id)));
  const removableIds = versions
    .filter((version) => !protectedIds.has(version.id))
    .slice(0, Math.max(0, versions.length - limit))
    .map((version) => version.id);

  if (removableIds.length) {
    await tx.delete(resumeVersions).where(inArray(resumeVersions.id, removableIds)).run();
  }
  return removableIds;
}

export async function appendResumeVersionTx(tx: DatabaseTransaction, input: AppendResumeVersionInput) {
  const resume = await tx.select().from(resumes).where(eq(resumes.id, input.resumeId)).get();
  if (!resume) throw new Error("Resume not found.");

  const current = resume.currentVersionId
    ? await tx.select().from(resumeVersions).where(and(
      eq(resumeVersions.id, resume.currentVersionId),
      eq(resumeVersions.resumeId, resume.id),
    )).get()
    : await tx.select().from(resumeVersions)
      .where(eq(resumeVersions.resumeId, resume.id))
      .orderBy(desc(resumeVersions.versionNumber), desc(resumeVersions.createdAt))
      .limit(1)
      .get();

  if (resume.currentVersionId && !current) throw new Error("Resume version pointer is invalid.");
  if ((current?.id ?? null) !== input.expectedVersionId) throw new ResumeVersionConflictError();

  const id = randomUUID();
  const pointerGuard = resume.currentVersionId
    ? eq(resumes.currentVersionId, resume.currentVersionId)
    : isNull(resumes.currentVersionId);
  const claimed = await tx.update(resumes).set({
    ...input.resumeUpdates,
    currentVersionId: id,
    updatedAt: input.resumeUpdates?.updatedAt ?? new Date(),
  }).where(and(eq(resumes.id, resume.id), pointerGuard)).returning({ id: resumes.id }).get();
  if (!claimed) throw new ResumeVersionConflictError();

  const created = await tx.insert(resumeVersions).values({
    id,
    resumeId: resume.id,
    jobId: input.jobId === undefined ? current?.jobId ?? null : input.jobId,
    parentVersionId: current?.id ?? input.externalParentVersionId ?? null,
    versionNumber: (current?.versionNumber ?? 0) + 1,
    versionType: input.versionType,
    title: input.title,
    structuredContentJson: input.structuredContentJson,
    renderedText: input.renderedText,
    contentHash: resumeVersionContentHash(input.structuredContentJson, input.renderedText),
    changeSummary: input.changeSummary ?? null,
    factCheckStatus: input.factCheckStatus,
    createdBy: input.createdBy,
  }).returning().get();
  await pruneResumeVersionHistoryTx(tx, resume.id, created.id);
  return created;
}
