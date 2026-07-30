import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { resumes, resumeVersions } from "@/db/schema";
import { isPlatformResume, renderResumeText } from "@/lib/resume-format";
import { detectTextLanguage, type ContentLanguage } from "@/lib/text-language";

export type ResumeVersionCandidate = {
  resume: typeof resumes.$inferSelect;
  version: typeof resumeVersions.$inferSelect;
};

function candidateLanguage(candidate: ResumeVersionCandidate) {
  if (candidate.resume.language === "zh" || candidate.resume.language === "en") return candidate.resume.language;
  if (!isPlatformResume(candidate.version.structuredContentJson)) return null;
  return detectTextLanguage(candidate.version.renderedText?.trim() || renderResumeText(candidate.version.structuredContentJson));
}

export function selectResumeVersionForLanguage(
  rows: ResumeVersionCandidate[],
  language: ContentLanguage,
  options: { preferredVersionId?: string | null; jobId?: string | null } = {},
) {
  const preferred = options.preferredVersionId
    ? rows.find((row) => row.version.id === options.preferredVersionId && candidateLanguage(row) === language)
    : undefined;
  if (preferred) return preferred;

  const currentByResume = [...rows.reduce((current, row) => {
    if (!current.has(row.resume.id)) current.set(row.resume.id, row);
    return current;
  }, new Map<string, ResumeVersionCandidate>()).values()]
    .filter((row) => candidateLanguage(row) === language);

  return currentByResume.find((row) => options.jobId && row.version.jobId === options.jobId)
    ?? currentByResume.find((row) => row.resume.isPrimary)
    ?? currentByResume[0];
}

export async function findResumeVersionForLanguage(
  userId: string,
  language: ContentLanguage,
  options: { preferredVersionId?: string | null; jobId?: string | null } = {},
) {
  const rows = await db.select({ resume: resumes, version: resumeVersions })
    .from(resumes)
    .innerJoin(resumeVersions, eq(resumeVersions.resumeId, resumes.id))
    .where(eq(resumes.userId, userId))
    .orderBy(desc(resumes.isPrimary), desc(resumes.updatedAt), desc(resumeVersions.versionNumber))
    .all();
  return selectResumeVersionForLanguage(rows, language, options);
}
