import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { client, db } from "./index";
import { backgroundJobs, resumes, resumeVersions } from "./schema";
import { extractResumeText } from "../lib/resume-extract";
import { parseResumeText, renderResumeText } from "../lib/resume-format";
import { appendResumeVersionTx } from "../lib/resume-versions";

async function main() {
  const allResumes = await db.select().from(resumes).all();
  let converted = 0;
  for (const resume of allResumes) {
    const version = await db.select().from(resumeVersions).where(eq(resumeVersions.resumeId, resume.id)).limit(1).get();
    if (version) continue;
    let text = resume.originalText ?? "";
    if (!text && resume.originalStoragePath) {
      const bytes = await readFile(resume.originalStoragePath);
      text = await extractResumeText(bytes, resume.sourceType as "pdf" | "docx" | "txt");
    }
    if (!text.trim()) continue;
    const structured = parseResumeText(text);
    await db.transaction(async (tx) => {
      await appendResumeVersionTx(tx, {
        resumeId: resume.id,
        expectedVersionId: null,
        versionType: "base",
        title: resume.title,
        structuredContentJson: structured,
        renderedText: renderResumeText(structured),
        factCheckStatus: "needs_review",
        createdBy: "user",
        resumeUpdates: { originalText: text.trim() },
      });
      await tx.delete(backgroundJobs).where(eq(backgroundJobs.jobType, "resume_parse")).run();
    });
    converted += 1;
  }
  console.log(`Converted ${converted} imported resume(s) to JobPilot format.`);
  client.close();
}

void main();
