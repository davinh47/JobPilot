import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { queryBatch } from "@/db/batch";
import { getCurrentUser } from "@/lib/current-user";
import { applications, applicationStatuses, jobs } from "@/db/schema";
import { PipelineWorkspace } from "@/components/pipeline-workspace";
import { formatLocaleDate, getLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function dateInputValue(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}

export default async function PipelinePage() {
  const locale = await getLocale();
  const user = await getCurrentUser();
  const [rows, statuses] = user ? await queryBatch([
    db.select({ application: applications, job: jobs }).from(applications).innerJoin(jobs, eq(applications.jobId, jobs.id)).where(and(eq(applications.userId, user.id), eq(jobs.ownerUserId, user.id))),
    db.select().from(applicationStatuses).where(eq(applicationStatuses.userId, user.id)).orderBy(asc(applicationStatuses.position)),
  ]) : [[], []];
  return <PipelineWorkspace
    locale={locale}
    rows={rows.map(({ application, job }) => ({
      applicationId: application.id,
      status: application.status,
      companyName: job.companyName,
      title: job.title,
      jobId: job.id,
      url: job.canonicalUrl,
      location: job.location,
      deadline: formatLocaleDate(job.applicationDeadline, locale),
      deadlineValue: dateInputValue(job.applicationDeadline),
      appliedAt: formatLocaleDate(application.appliedAt, locale),
      appliedAtValue: dateInputValue(application.appliedAt),
      nextAction: application.nextAction ?? "",
    }))}
    statuses={statuses.map((status) => ({ id: status.id, slug: status.slug, label: locale === "zh" ? status.labelZh : status.labelEn, labelZh: status.labelZh, labelEn: status.labelEn, color: status.color }))}
  />;
}
