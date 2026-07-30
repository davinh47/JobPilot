import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { resumes, resumeVersions } from "@/db/schema";
import { generateResumeDocx, generateResumePdf, isResumeTemplate } from "@/lib/resume-export";
import { isPlatformResume, parseResumeText, renderResumeText } from "@/lib/resume-format";
import { getCurrentUser } from "@/lib/current-user";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const resume = user ? await db.select().from(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, user.id))).get() : undefined;
  if (!resume) return new Response("Resume not found", { status: 404 });
  const url = new URL(request.url);
  const requestedVersionId = z.string().uuid().safeParse(url.searchParams.get("versionId"));
  const version = requestedVersionId.success
    ? await db.select().from(resumeVersions).where(and(eq(resumeVersions.id, requestedVersionId.data), eq(resumeVersions.resumeId, id))).get()
    : await db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, id)).orderBy(desc(resumeVersions.versionNumber)).limit(1).get();
  if (requestedVersionId.success && !version) return new Response("Resume version not found", { status: 404 });
  const filename = `${resume.title}${version ? `_v${version.versionNumber}` : ""}`.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "_") || "resume";
  const content = version && isPlatformResume(version.structuredContentJson) ? version.structuredContentJson : parseResumeText(resume.originalText ?? "");
  const format = url.searchParams.get("format") ?? "txt";
  const requestedTemplate = url.searchParams.get("template");
  const template = isResumeTemplate(requestedTemplate) ? requestedTemplate : "modern";
  const disposition = url.searchParams.get("preview") === "1" ? "inline" : "attachment";

  if (format === "docx") {
    const body = await generateResumeDocx(content, template);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${filename}_${template}.docx`)}`, "Cache-Control": "private, no-store" } });
  }
  if (format === "pdf") {
    try {
      const body = await generateResumePdf(content, template);
      return new Response(new Uint8Array(body), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(`${filename}_${template}.pdf`)}`, "Cache-Control": "private, no-store" } });
    } catch (error) {
      console.error("[JobPilot resume export] PDF generation failed", {
        resumeId: id,
        template,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return new Response("PDF preview could not be generated. Please retry.", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
      });
    }
  }
  if (format !== "txt") return new Response("Unsupported export format", { status: 400 });
  return new Response(version?.renderedText ?? renderResumeText(content), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${filename}.txt`)}`, "Cache-Control": "private, no-store" } });
}
