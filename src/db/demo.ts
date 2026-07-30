import { and, eq } from "drizzle-orm";
import { client, db } from "./index";
import { applications, careerPreferences, jobSources, jobs, resumes, resumeVersions, users } from "./schema";
import { createDefaultPlatformResume, renderResumeText } from "@/lib/resume-format";
import { resumeVersionContentHash } from "@/lib/resume-versions";

async function main() {
  const user = await db.select().from(users).where(eq(users.displayName, "JobPilot User")).get();
  if (!user) throw new Error("Run npm run db:setup before loading demo data.");
  const canonicalKey = "jobpilot-demo-product-engineer";
  const existingJob = await db.select().from(jobs).where(and(eq(jobs.ownerUserId, user.id), eq(jobs.canonicalKey, canonicalKey))).get();
  if (existingJob) {
    console.log("JobPilot demo data already exists.");
    return;
  }
  const content = createDefaultPlatformResume("en");
  content.basics = { ...content.basics, fullName: "Taylor Chen", headline: "Product Engineer", location: "Singapore" };
  content.summary = "Product engineer focused on reliable AI-assisted workflows and measurable user outcomes.";
  const experience = content.sections.find((section) => section.type === "experience_projects")?.entries?.[0];
  if (experience) {
    experience.position = "Product Engineer";
    experience.organization = "Example Labs";
    experience.startDate = "2022";
    experience.current = true;
    experience.highlights = ["Built a human-in-the-loop review workflow.", "Reduced task completion time by 30% through product instrumentation."];
    experience.skills = ["TypeScript", "React", "LLM evaluation"];
  }
  const renderedText = renderResumeText(content);
  await db.transaction(async (tx) => {
    const resume = await tx.insert(resumes).values({
      userId: user.id,
      title: "[Demo] Product Engineer Resume",
      language: "en",
      sourceType: "editor",
      originalText: renderedText,
      contentHash: resumeVersionContentHash(content, renderedText),
      isPrimary: true,
    }).returning().get();
    const version = await tx.insert(resumeVersions).values({
      resumeId: resume.id,
      versionNumber: 1,
      versionType: "base",
      title: resume.title,
      structuredContentJson: content,
      renderedText,
      contentHash: resumeVersionContentHash(content, renderedText),
      changeSummary: "Safe synthetic demo resume",
      factCheckStatus: "passed",
      createdBy: "user",
    }).returning().get();
    await tx.update(resumes).set({ currentVersionId: version.id }).where(eq(resumes.id, resume.id)).run();
    const job = await tx.insert(jobs).values({
      ownerUserId: user.id,
      companyName: "Northstar Demo",
      title: "Product Engineer, AI Workflows",
      location: "Singapore / Remote",
      workplaceType: "hybrid",
      employmentType: "Full-time",
      descriptionText: "Build reliable AI-assisted product workflows. Partner with design and engineering, define evaluation criteria, instrument quality and latency, and ship human-in-the-loop experiences. Required: TypeScript, React, product judgment, and experience evaluating LLM output.",
      canonicalKey,
      listingStatus: "active",
    }).returning().get();
    await tx.insert(jobSources).values({ jobId: job.id, sourceType: "manual", sourceName: "Synthetic demo data" }).run();
    await tx.insert(applications).values({ userId: user.id, jobId: job.id, status: "to_apply", selectedResumeVersionId: version.id, nextAction: "Review the demo role and try resume tailoring." }).run();
    await tx.update(careerPreferences).set({
      targetTitlesJson: ["Product Engineer"],
      seniorityLevelsJson: ["mid"],
      locationsJson: ["Singapore"],
      remotePreference: "hybrid",
      updatedAt: new Date(),
    }).where(eq(careerPreferences.userId, user.id)).run();
  });
  console.log("Loaded a synthetic resume, job, and pipeline application.");
}

main().finally(() => client.close());
