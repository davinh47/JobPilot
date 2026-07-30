import { extname } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { getCurrentUser } from "@/lib/current-user";
import { readResumeSource } from "@/lib/file-storage";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain; charset=utf-8",
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const resume = await db.select().from(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, user.id))).get();
  if (!resume?.originalStoragePath || !resume.originalFilename) return new Response("Original resume not found", { status: 404 });
  const extension = extname(resume.originalFilename).toLowerCase();
  const inline = new URL(request.url).searchParams.get("preview") === "1" && extension === ".pdf";
  const filename = resume.originalFilename.replace(/[\r\n"]/g, "_");
  try {
    const body = await readResumeSource(resume.originalStoragePath);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": contentTypes[extension] ?? "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "private, no-store" } });
  } catch {
    return new Response("Original resume file is unavailable", { status: 404 });
  }
}
