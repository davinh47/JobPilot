import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  agentRuns,
  aiUsageEvents,
  applicationEvents,
  applications,
  applicationStatuses,
  appSettings,
  assistantContexts,
  candidateProfiles,
  careerPreferences,
  companyRecommendations,
  experienceEvidence,
  ignoredJobs,
  interviewQuestions,
  interviews,
  jobMatches,
  jobSearchTargets,
  jobSnapshots,
  jobSources,
  jobs,
  materials,
  memories,
  notifications,
  resumes,
  resumeVersions,
  searchChecklistItems,
  searchPlans,
  skills,
  sourceConnectors,
  users,
  watchRules,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return new Response("Unauthorized", { status: 401 });
  const userId = currentUser.id;
  const [user, settings, assistantContext, statuses, profile, preferences, targets, skillRows, resumeRows, jobRows, applicationRows, ignored, evidence, memoryRows, runRows, usageRows, watchRows, connectorRows, companyRows, planRows, notificationRows] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).get(),
    db.select().from(appSettings).where(eq(appSettings.userId, userId)).get(),
    db.select().from(assistantContexts).where(eq(assistantContexts.userId, userId)).get(),
    db.select().from(applicationStatuses).where(eq(applicationStatuses.userId, userId)).all(),
    db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId)).get(),
    db.select().from(careerPreferences).where(eq(careerPreferences.userId, userId)).get(),
    db.select().from(jobSearchTargets).where(eq(jobSearchTargets.userId, userId)).all(),
    db.select().from(skills).where(eq(skills.userId, userId)).all(),
    db.select().from(resumes).where(eq(resumes.userId, userId)).all(),
    db.select().from(jobs).where(eq(jobs.ownerUserId, userId)).all(),
    db.select().from(applications).where(eq(applications.userId, userId)).all(),
    db.select().from(ignoredJobs).where(eq(ignoredJobs.userId, userId)).all(),
    db.select().from(experienceEvidence).where(eq(experienceEvidence.userId, userId)).all(),
    db.select().from(memories).where(eq(memories.userId, userId)).all(),
    db.select().from(agentRuns).where(eq(agentRuns.userId, userId)).all(),
    db.select().from(aiUsageEvents).where(eq(aiUsageEvents.userId, userId)).all(),
    db.select().from(watchRules).where(eq(watchRules.userId, userId)).all(),
    db.select().from(sourceConnectors).where(eq(sourceConnectors.userId, userId)).all(),
    db.select().from(companyRecommendations).where(eq(companyRecommendations.userId, userId)).all(),
    db.select().from(searchPlans).where(eq(searchPlans.userId, userId)).all(),
    db.select().from(notifications).where(eq(notifications.userId, userId)).all(),
  ]);
  const resumeIds = resumeRows.map((row) => row.id);
  const jobIds = jobRows.map((row) => row.id);
  const applicationIds = applicationRows.map((row) => row.id);
  const planIds = planRows.map((row) => row.id);
  const [versions, sources, snapshots, matches, events, materialRows, interviewRows, questionRows, checklistRows] = await Promise.all([
    resumeIds.length ? db.select().from(resumeVersions).where(inArray(resumeVersions.resumeId, resumeIds)).all() : [],
    jobIds.length ? db.select().from(jobSources).where(inArray(jobSources.jobId, jobIds)).all() : [],
    jobIds.length ? db.select().from(jobSnapshots).where(inArray(jobSnapshots.jobId, jobIds)).all() : [],
    db.select().from(jobMatches).where(eq(jobMatches.userId, userId)).all(),
    applicationIds.length ? db.select().from(applicationEvents).where(inArray(applicationEvents.applicationId, applicationIds)).all() : [],
    applicationIds.length ? db.select().from(materials).where(inArray(materials.applicationId, applicationIds)).all() : [],
    applicationIds.length ? db.select().from(interviews).where(inArray(interviews.applicationId, applicationIds)).all() : [],
    applicationIds.length ? db.select().from(interviewQuestions).where(inArray(interviewQuestions.applicationId, applicationIds)).all() : [],
    planIds.length ? db.select().from(searchChecklistItems).where(inArray(searchChecklistItems.searchPlanId, planIds)).all() : [],
  ]);
  const exportedAt = new Date().toISOString();
  const body = JSON.stringify({
    format: "jobpilot-user-export",
    version: 1,
    exportedAt,
    notice: "API keys, extension pairing tokens, rate-limit state, search indexes, and queued jobs are intentionally excluded.",
    data: {
      user, settings, assistantContext, applicationStatuses: statuses, candidateProfile: profile, careerPreferences: preferences,
      jobSearchTargets: targets, skills: skillRows, resumes: resumeRows, resumeVersions: versions,
      jobs: jobRows, jobSources: sources, jobSnapshots: snapshots, ignoredJobs: ignored, experienceEvidence: evidence,
      applications: applicationRows, applicationEvents: events, jobMatches: matches, materials: materialRows,
      interviews: interviewRows, interviewQuestions: questionRows, memories: memoryRows, agentRuns: runRows,
      aiUsageEvents: usageRows, watchRules: watchRows, sourceConnectors: connectorRows,
      companyRecommendations: companyRows, searchPlans: planRows, searchChecklistItems: checklistRows,
      notifications: notificationRows,
    },
  }, null, 2);
  const day = exportedAt.slice(0, 10);
  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="jobpilot-export-${day}.json"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
