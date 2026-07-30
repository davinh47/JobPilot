import { eq, inArray } from "drizzle-orm";
import { client, db } from "@/db";
import { getCurrentUser } from "@/lib/current-user";
import { applications, experienceEvidence, interviewQuestions, jobs, materials, memories, resumes, resumeVersions, searchDocuments } from "@/db/schema";

export async function rebuildSearchIndex(userId: string) {
  const [resumeRows, applicationRows, evidenceRows, memoryRows, jobRows] = await Promise.all([
    db.select().from(resumes).where(eq(resumes.userId, userId)).all(),
    db.select({ id: applications.id }).from(applications).where(eq(applications.userId, userId)).all(),
    db.select().from(experienceEvidence).where(eq(experienceEvidence.userId, userId)).all(),
    db.select().from(memories).where(eq(memories.userId, userId)).all(),
    db.select().from(jobs).where(eq(jobs.ownerUserId, userId)).all(),
  ]);
  const resumeIds = resumeRows.map((resume) => resume.id);
  const applicationIds = applicationRows.map((application) => application.id);
  const [versions, materialRows, questionRows] = await Promise.all([
    resumeIds.length ? db.select().from(resumeVersions).where(inArray(resumeVersions.resumeId, resumeIds)).all() : [],
    applicationIds.length ? db.select().from(materials).where(inArray(materials.applicationId, applicationIds)).all() : [],
    applicationIds.length ? db.select().from(interviewQuestions).where(inArray(interviewQuestions.applicationId, applicationIds)).all() : [],
  ]);
  const resumeById = new Map(resumeRows.map((resume) => [resume.id, resume]));
  const documents: Array<typeof searchDocuments.$inferInsert> = [];
  for (const resume of resumeRows) {
    const latest = versions.filter((version) => version.resumeId === resume.id).sort((a, b) => b.versionNumber - a.versionNumber)[0];
    documents.push({ userId, documentType: "resume", entityId: resume.id, title: resume.title, content: latest?.renderedText || resume.originalText || "", sourceLabel: latest ? `Resume v${latest.versionNumber}` : "Original resume" });
  }
  for (const row of evidenceRows) documents.push({ userId, documentType: "evidence", entityId: row.id, title: row.title, content: [row.organization, row.description].filter(Boolean).join("\n"), sourceLabel: row.resumeId ? resumeById.get(row.resumeId)?.title : "Profile evidence" });
  for (const row of memoryRows) documents.push({ userId, documentType: "memory", entityId: row.id, title: row.memoryType.replaceAll("_", " "), content: row.content, sourceLabel: `${row.sourceType}:${row.sourceId}` });
  for (const row of jobRows) documents.push({ userId, documentType: "job", entityId: row.id, title: `${row.companyName} · ${row.title}`, content: [row.location, row.descriptionText].filter(Boolean).join("\n"), sourceLabel: row.canonicalUrl || "Job snapshot" });
  for (const row of materialRows) if (row.contentText) documents.push({ userId, documentType: "material", entityId: row.id, title: row.title, content: row.contentText, sourceLabel: `${row.materialType} · ${row.factCheckStatus}` });
  for (const row of questionRows) documents.push({ userId, documentType: "interview", entityId: row.id, title: row.question, content: [row.answerFramework, row.answerDraft].filter(Boolean).join("\n"), sourceLabel: "Interview preparation" });

  await db.transaction(async (tx) => {
    await tx.delete(searchDocuments).where(eq(searchDocuments.userId, userId)).run();
    if (documents.length) await tx.insert(searchDocuments).values(documents).run();
  });
  return documents.length;
}

export type SearchResult = { id: string; documentType: string; entityId: string; title: string; content: string; sourceLabel: string | null; score: number };

export async function searchWorkspace(userId: string, query: string): Promise<SearchResult[]> {
  const tokens = query.trim().split(/\s+/).map((token) => token.replace(/["'*:^(){}\[\]]/g, "")).filter(Boolean);
  if (!tokens.length) return [];
  const match = tokens.map((token) => `"${token}"*`).join(" AND ");
  const result = await client.execute({
    sql: `SELECT d.id, d.document_type AS documentType, d.entity_id AS entityId, d.title, d.content, d.source_label AS sourceLabel, bm25(search_documents_fts, 3.0, 1.0) AS score FROM search_documents_fts JOIN search_documents d ON d.rowid = search_documents_fts.rowid WHERE search_documents_fts MATCH ? AND d.user_id = ? ORDER BY score LIMIT 30`,
    args: [match, userId],
  });
  const rows = result.rows.map((row) => ({ id: String(row.id), documentType: String(row.documentType), entityId: String(row.entityId), title: String(row.title), content: String(row.content), sourceLabel: row.sourceLabel ? String(row.sourceLabel) : null, score: Number(row.score) }));
  if (rows.length || !/[\u3400-\u9fff]/.test(query)) return rows;
  const fallback = await client.execute({ sql: `SELECT id, document_type AS documentType, entity_id AS entityId, title, content, source_label AS sourceLabel, 0 AS score FROM search_documents WHERE user_id = ? AND (title LIKE ? OR content LIKE ?) LIMIT 30`, args: [userId, `%${query.trim()}%`, `%${query.trim()}%`] });
  return fallback.rows.map((row) => ({ id: String(row.id), documentType: String(row.documentType), entityId: String(row.entityId), title: String(row.title), content: String(row.content), sourceLabel: row.sourceLabel ? String(row.sourceLabel) : null, score: 0 }));
}

export async function ensureSearchIndex(userId?: string) {
  const resolvedUserId = userId ?? (await getCurrentUser())?.id;
  if (!resolvedUserId) return 0;
  return rebuildSearchIndex(resolvedUserId);
}
