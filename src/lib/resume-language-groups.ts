import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { resumes, resumeVersions } from "@/db/schema";
import { isPlatformResume, renderResumeText } from "@/lib/resume-format";
import { detectTextLanguage } from "@/lib/text-language";

function versionLanguage(row: { resume: typeof resumes.$inferSelect; version: typeof resumeVersions.$inferSelect }) {
  if (row.resume.language === "zh" || row.resume.language === "en") return row.resume.language;
  const text = row.version.renderedText?.trim()
    || (isPlatformResume(row.version.structuredContentJson) ? renderResumeText(row.version.structuredContentJson) : "");
  return detectTextLanguage(text);
}

export async function ensureResumeLanguageGroups(userId: string) {
  const rows = await db.select({ resume: resumes, version: resumeVersions })
    .from(resumes)
    .innerJoin(resumeVersions, eq(resumeVersions.resumeId, resumes.id))
    .where(eq(resumes.userId, userId))
    .orderBy(desc(resumeVersions.versionNumber), desc(resumeVersions.createdAt))
    .all();
  const current = [...rows.reduce((map, row) => {
    if (!map.has(row.resume.id)) map.set(row.resume.id, row);
    return map;
  }, new Map<string, (typeof rows)[number]>()).values()];
  if (!current.length) return;
  const languages = new Map(current.map((row) => [row.resume.id, versionLanguage(row)]));
  await db.transaction(async (tx) => {
    for (const row of current) {
      const language = languages.get(row.resume.id)!;
      const resumeGroupId = row.resume.resumeGroupId || row.resume.id;
      if (row.resume.language !== language || row.resume.resumeGroupId !== resumeGroupId) {
        await tx.update(resumes).set({ language, resumeGroupId }).where(eq(resumes.id, row.resume.id)).run();
      }
    }
    const baseRows = current.filter((row) => row.version.versionType !== "tailored");
    const primary = baseRows.find((row) => row.resume.isPrimary);
    if (!primary) return;
    const primaryLanguage = languages.get(primary.resume.id)!;
    const opposite = baseRows.filter((row) => row.resume.id !== primary.resume.id && languages.get(row.resume.id) !== primaryLanguage);
    if (opposite.length !== 1) return;
    const counterpart = opposite[0]!;
    const counterpartGroup = counterpart.resume.resumeGroupId || counterpart.resume.id;
    const groupMembers = current.filter((row) => (row.resume.resumeGroupId || row.resume.id) === counterpartGroup);
    if (groupMembers.length !== 1) return;
    await tx.update(resumes).set({ resumeGroupId: primary.resume.resumeGroupId || primary.resume.id }).where(eq(resumes.id, counterpart.resume.id)).run();
  });
}
