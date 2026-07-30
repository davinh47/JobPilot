import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { applications, candidateProfiles, jobs, materials, resumeVersions } from "@/db/schema";
import { generateCoverLetterDocx, generateCoverLetterPdf } from "@/lib/cover-letter-export";
import { coverLetterOutputLocale, createCoverLetterDocumentMeta, renderCoverLetterPlainText } from "@/lib/cover-letter-format";
import { getCurrentUser } from "@/lib/current-user";
import { findResumeVersionForLanguage } from "@/lib/resume-version-language";
import { localeCompatibleFallback } from "@/lib/text-language";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const material = await db.select().from(materials).where(eq(materials.id, id)).get();
  if (!material || material.materialType !== "cover_letter" || !material.contentText) return new Response("Cover letter not found", { status: 404 });
  const application = await db.select().from(applications).where(and(eq(applications.id, material.applicationId), eq(applications.userId, user.id))).get();
  if (!application) return new Response("Cover letter not found", { status: 404 });
  const job = await db.select().from(jobs).where(and(eq(jobs.id, application.jobId), eq(jobs.ownerUserId, user.id))).get();
  const version = material.resumeVersionId ? await db.select().from(resumeVersions).where(eq(resumeVersions.id, material.resumeVersionId)).get() : undefined;
  const profile = application ? await db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, application.userId)).get() : undefined;
  const locale = coverLetterOutputLocale(material.sourceRefsJson, material.contentText);
  const identitySource = await findResumeVersionForLanguage(application.userId, locale, { preferredVersionId: version?.id, jobId: job?.id });
  const meta = createCoverLetterDocumentMeta(
    identitySource?.version.structuredContentJson ?? version?.structuredContentJson,
    { companyName: job?.companyName ?? "", title: job?.title ?? "" },
    new Date(),
    locale,
    localeCompatibleFallback(profile?.currentLocation ?? "", locale),
  );
  const format = new URL(request.url).searchParams.get("format") ?? "txt";
  const filename = material.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "_") || "cover_letter";
  if (format === "docx") {
    const body = await generateCoverLetterDocx(material.title, material.contentText, meta);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${filename}.docx`)}` } });
  }
  if (format === "pdf") {
    const body = await generateCoverLetterPdf(material.title, material.contentText, meta);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${filename}.pdf`)}` } });
  }
  if (format !== "txt") return new Response("Unsupported export format", { status: 400 });
  return new Response(renderCoverLetterPlainText(meta, material.contentText), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${filename}.txt`)}` } });
}
