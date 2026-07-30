type LatestSearchJob = {
  status: string;
  updatedAt: Date;
} | null | undefined;

export function shouldScheduleWebSearch({
  now,
  frequencyMinutes,
  lastSearchAt,
  latestJob,
}: {
  now: Date;
  frequencyMinutes: number;
  lastSearchAt: Date | null | undefined;
  latestJob: LatestSearchJob;
}) {
  const intervalMs = frequencyMinutes * 60_000;
  const dueAt = now.getTime() - intervalMs;
  if (lastSearchAt && lastSearchAt.getTime() > dueAt) return false;
  if (latestJob?.status === "queued" || latestJob?.status === "running") return false;
  if (latestJob?.status === "failed" && latestJob.updatedAt.getTime() > dueAt) return false;
  return true;
}
